/**
 * Navidrome MCP Server - Web UI Snapshot Broadcaster
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { ServerResponse } from 'node:http';
import type { NavidromeClient } from '../client/navidrome-client.js';
import {
  playbackEngine,
  type StateChangeEvent,
} from '../services/playback/playback-engine.js';
import { getPlayQueue, nowPlaying, playbackStatus } from '../tools/playback.js';
import { getTheme } from '../web/player-runtime.js';
import { logger } from '../utils/logger.js';

// mpv fires time-pos every 250 ms and a bulk loadfile fires one playlist-count change per track, so property events are throttled.
const BROADCAST_THROTTLE_MS = 1000;

// Browsers retry at this interval verbatim, so it sets how soon an idle phone reconnects without polling the server hard.
const SSE_RETRY_MS = 10_000;

// Stays under common reverse-proxy idle timeouts (nginx proxy_read_timeout is 60s) and bounds dead-client reaping latency.
const SSE_HEARTBEAT_MS = 10_000;

/**
 * Pushes engine snapshots to every SSE remote. Property events are throttled to one broadcast per
 * BROADCAST_THROTTLE_MS, and queue events flush at once so a user action shows within one frame.
 */
export class SseBroadcaster {
  private readonly clients = new Set<ServerResponse>();
  // A snapshot carries the full state, so a client still flushing its last write keeps only the newest one for its 'drain'.
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

  // Also the reaper for peers that vanish without a 'close' event, since it runs while playback is idle.
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

  // The retry directive goes first, so the browser learns the reconnect interval even if the stream drops before a snapshot.
  async addClient(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Hint to reverse proxies (nginx in particular) not to buffer the
      // stream. Harmless when no proxy is in the loop.
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${SSE_RETRY_MS}\n\n`);

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
        // Don't keep the event loop alive solely for a pending broadcast.
        this.pendingBroadcastTimer.unref();
      }
      return;
    }
    // The engine is not yet usable at the attach event, and the snapshot burst after it broadcasts.
    if (evt.kind === 'attach') return;

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

  // One build at a time, so a slow build never overwrites a newer snapshot and requests during a build coalesce into one rebuild.
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
        // A broadcast() call during the await above set this flag.
        rebuild = this.rebuildRequested;
      }
    } finally {
      this.buildInFlight = false;
    }
  }

  // A peer that stops reading never errors, so a backlog with no 'drain' across a whole heartbeat interval marks it stalled.
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

  /** Returns false if the client is closed or the write failed, so the caller can reap it. */
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

  // allSettled, so one failed read ships a null field instead of blanking the whole snapshot.
  private async buildSnapshot(): Promise<string | null> {
    const [npResult, queueResult, statusResult] = await Promise.allSettled([
      // The client lets now_playing resolve title, artist and album by songId after an MCP restart empties the engine cache.
      nowPlaying({}, this.client),
      getPlayQueue(this.client, {}),
      playbackStatus({}),
    ]);

    const np = settled(npResult, 'nowPlaying');
    const queue = settled(queueResult, 'queue');
    const status = settled(statusResult, 'status');

    // Clients keep their last snapshot rather than receive a frame of three nulls.
    if (np === null && queue === null && status === null) {
      return null;
    }

    // `player` carries process-global state, so every open remote follows a theme change.
    const player = { theme: getTheme() };
    return JSON.stringify({ nowPlaying: np, queue, status, player });
  }
}

// A dead peer does not make res.write() throw, so liveness is read from the stream flags.
function isClosed(res: ServerResponse): boolean {
  return res.destroyed || res.writableEnded;
}

/** The `field` label names which read broke, so a recurring failure is identifiable in the log. */
function settled<T>(result: PromiseSettledResult<T>, field: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
  logger.debug(`webui: buildSnapshot ${field} read failed: ${reason}`);
  return null;
}
