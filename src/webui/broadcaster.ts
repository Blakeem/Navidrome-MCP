/**
 * Navidrome MCP Server - Web UI Snapshot Broadcaster
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import type { NavidromeClient } from '../client/navidrome-client.js';
import {
  playbackEngine,
  type PlaybackStatus,
  type StateChangeEvent,
} from '../services/playback/playback-engine.js';
import { SSE_HEARTBEAT_MS } from '../constants/timeouts.js';
import { getPlayQueue, nowPlaying, playbackStatus } from '../tools/playback.js';
import { getTheme, getVisualizer } from '../web/player-runtime.js';
import { logger } from '../utils/logger.js';
import { openSseStream } from './http-helpers.js';

// mpv fires time-pos every 250 ms and a bulk loadfile fires one playlist-count change per track.
const BROADCAST_THROTTLE_MS = 1000;

// EventSource waits this long before each reconnect, so it bounds how often an idle phone retries.
const SSE_RETRY_MS = 10_000;

/** Queue and visualizer events skip the property throttle, so a user action shows at once. */
export class SseBroadcaster {
  private readonly clients = new Set<ServerResponse>();
  // A snapshot carries the full state, so a client still flushing its last write keeps only the
  // newest one for its 'drain'.
  private readonly heldSnapshots = new WeakMap<ServerResponse, string>();
  private readonly backloggedAtHeartbeat = new WeakSet<ServerResponse>();
  private lastBroadcastMs = 0;
  private pendingBroadcastTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private buildInFlight = false;
  private rebuildRequested = false;

  constructor(private readonly client: NavidromeClient) {}

  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = playbackEngine.onStateChange((evt) => this.handleEvent(evt));
    this.heartbeatTimer = setInterval(() => { this.sendHeartbeat(); }, SSE_HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  stop(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.pendingBroadcastTimer !== null) {
      clearTimeout(this.pendingBroadcastTimer);
      this.pendingBroadcastTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const res of this.clients) {
      try { res.end(); } catch { /* client already gone */ }
    }
    this.clients.clear();
  }

  // Also reaps peers that vanish without a 'close' event, since it runs while playback is idle.
  private sendHeartbeat(): void {
    for (const res of this.clients) {
      if (isClosed(res) || this.reapIfStalled(res)) {
        this.clients.delete(res);
        continue;
      }
      try {
        res.write(': ping\n\n');
      } catch (err) {
        this.clients.delete(res);
        logger.debug(
          `webui: SSE heartbeat failed, dropping client: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async addClient(res: ServerResponse): Promise<void> {
    openSseStream(res, SSE_RETRY_MS);

    this.clients.add(res);
    res.on('close', () => { this.clients.delete(res); });
    res.on('drain', () => { this.handleDrain(res); });

    await this.broadcast();
  }

  private handleEvent(evt: StateChangeEvent): void {
    if (evt.kind === 'property') {
      const now = Date.now();
      const elapsed = now - this.lastBroadcastMs;
      if (elapsed >= BROADCAST_THROTTLE_MS) {
        this.lastBroadcastMs = now;
        void this.broadcast();
      } else if (this.pendingBroadcastTimer === null) {
        const delay = BROADCAST_THROTTLE_MS - elapsed;
        this.pendingBroadcastTimer = setTimeout(() => {
          this.pendingBroadcastTimer = null;
          this.lastBroadcastMs = Date.now();
          void this.broadcast();
        }, delay);
        this.pendingBroadcastTimer.unref();
      }
      return;
    }
    // The property events that follow an attach event broadcast the new mpv's state. A message
    // carries no player state.
    if (evt.kind === 'attach' || evt.kind === 'message') return;

    this.broadcastNow();
  }

  /** Immediate fan-out, also used by a player-settings change that no engine event announces. */
  broadcastNow(): void {
    this.lastBroadcastMs = Date.now();
    if (this.pendingBroadcastTimer !== null) {
      clearTimeout(this.pendingBroadcastTimer);
      this.pendingBroadcastTimer = null;
    }
    void this.broadcast();
  }

  // One build at a time, so a slow build never overwrites a newer snapshot, and requests during a
  // build coalesce into one rebuild.
  private async broadcast(): Promise<void> {
    if (this.clients.size === 0) return;
    if (this.buildInFlight) {
      this.rebuildRequested = true;
      return;
    }
    this.buildInFlight = true;
    try {
      let rebuild = true;
      while (rebuild) {
        this.rebuildRequested = false;
        const snapshot = await this.buildSnapshot();
        if (snapshot !== null) {
          for (const res of this.clients) {
            if (!this.writeToClient(res, snapshot)) this.clients.delete(res);
          }
        }
        rebuild = this.rebuildRequested;
      }
    } finally {
      this.buildInFlight = false;
    }
  }

  // A peer that stops reading never errors, so a backlog with no 'drain' across an entire heartbeat
  // interval marks it stalled.
  private reapIfStalled(res: ServerResponse): boolean {
    if (!res.writableNeedDrain) {
      this.backloggedAtHeartbeat.delete(res);
      return false;
    }
    if (!this.backloggedAtHeartbeat.has(res)) {
      this.backloggedAtHeartbeat.add(res);
      return false;
    }
    logger.debug('webui: SSE client drained nothing for a heartbeat interval, dropping it');
    res.destroy();
    return true;
  }

  private handleDrain(res: ServerResponse): void {
    this.backloggedAtHeartbeat.delete(res);
    const held = this.heldSnapshots.get(res);
    if (held === undefined || !this.clients.has(res)) return;
    this.heldSnapshots.delete(res);
    if (!this.writeToClient(res, held)) this.clients.delete(res);
  }

  private writeToClient(res: ServerResponse, snapshotJson: string): boolean {
    if (isClosed(res)) return false;
    if (res.writableNeedDrain) {
      this.heldSnapshots.set(res, snapshotJson);
      return true;
    }
    try {
      res.write(`event: snapshot\ndata: ${snapshotJson}\n\n`);
      return !res.destroyed;
    } catch (err) {
      logger.debug(
        `webui: SSE write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // allSettled, so one failed read ships a null field instead of blanking the entire snapshot.
  private async buildSnapshot(): Promise<string | null> {
    const [npResult, queueResult, statusResult] = await Promise.allSettled([
      // The client lets now_playing fill title, artist and album from Navidrome when the engine
      // cache lacks them.
      nowPlaying({}, this.client),
      getPlayQueue(this.client, {}),
      playbackStatus({}),
    ]);

    const np = settled(npResult, 'nowPlaying');
    const queue = settled(queueResult, 'queue');
    const fullStatus = settled(statusResult, 'status');
    const status = fullStatus === null ? null : snapshotStatus(fullStatus);

    // Clients keep their last snapshot rather than receive a frame of three nulls.
    if (np === null && queue === null && status === null) {
      return null;
    }

    // `player` carries process-global state, so every open remote follows a theme or visualizer
    // change.
    const player = { theme: getTheme(), visualizer: getVisualizer() && !playbackEngine.isVisualizerUnsupported() };
    return JSON.stringify({ nowPlaying: np, queue, status, player });
  }
}

// A dead peer does not make res.write() throw, so liveness is read from the stream flags.
function isClosed(res: ServerResponse): boolean {
  return res.destroyed || res.writableEnded;
}

// LAN peers read this stream, and mpvPath can name the OS user while mpvVersion fingerprints the host.
function snapshotStatus(status: PlaybackStatus): Pick<PlaybackStatus, 'engineRunning' | 'volume' | 'idle'> {
  return { engineRunning: status.engineRunning, volume: status.volume, idle: status.idle };
}

function settled<T>(result: PromiseSettledResult<T>, field: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
  logger.debug(`webui: buildSnapshot ${field} read failed: ${reason}`);
  return null;
}
