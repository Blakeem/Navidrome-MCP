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
  type QueueEntry,
  type StateChangeEvent,
} from '../services/playback/playback-engine.js';
import { SSE_HEARTBEAT_MS } from '../constants/timeouts.js';
import { getPlayQueueEntries, nowPlaying, playbackStatus, toPlayQueueResult } from '../tools/playback.js';
import { getTheme, getVisualizer } from '../web/player-runtime.js';
import { logger } from '../utils/logger.js';
import type { GuestJukebox } from './auth/auth-service.js';
import { toGuestNowPlaying, toGuestQueue, type GuestJukeboxView, type GuestSnapshot } from './guest-snapshot.js';
import { openSseStream } from './http-helpers.js';
import type { GuestLedger } from './jukebox/guest-ledger.js';
import type { GuestQueue } from './jukebox/guest-queue.js';
import { StallReaper } from './stall-reaper.js';

// mpv fires time-pos every 250 ms and a bulk loadfile fires one playlist-count change per track.
const BROADCAST_THROTTLE_MS = 1000;

// EventSource waits this long before each reconnect, so it bounds how often an idle phone retries.
const SSE_RETRY_MS = 10_000;

/** A guest client reads its own `jukebox` field at each snapshot, and null means its session ended. */
type ClientView = { kind: 'host' } | { kind: 'guest'; sessionId: string; jukebox: () => GuestJukebox | null };

const HOST_VIEW: ClientView = { kind: 'host' };

const NO_GUEST_SONGS: ReadonlySet<number> = new Set();

// `guestQueueIdentity` names the guest queue the frame carries, or is null for a frame without one.
interface HeldFrame {
  json: string;
  guestQueueIdentity: string | null;
}

type GuestSongs = Pick<GuestQueue, 'counts' | 'ledger'>;

interface Snapshot {
  nowPlaying: Awaited<ReturnType<typeof nowPlaying>> | null;
  queueEntries: QueueEntry[] | null;
  status: ReturnType<typeof snapshotStatus> | null;
}

/**
 * Queue and visualizer events skip the property throttle, so a user action shows at once. Host and
 * guest clients share one build, and each guest client gets the reduced guest snapshot.
 */
export class SseBroadcaster {
  private readonly clients = new Map<ServerResponse, ClientView>();
  // A frame carries the full state, or a guest frame resends any queue its client has not received,
  // so a client still flushing its last write keeps only the newest frame for its 'drain'.
  private readonly heldSnapshots = new WeakMap<ServerResponse, HeldFrame>();
  // A guest queue can hold thousands of entries, so a guest frame carries it only when the queue
  // version or the guest's own songs differ from the ones its client last received.
  private readonly sentGuestQueues = new WeakMap<ServerResponse, string>();
  private guestQueueJson = 'null';
  private guestQueueVersion = 0;
  private readonly stalls = new StallReaper();
  private lastBroadcastMs = 0;
  private pendingBroadcastTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private buildInFlight = false;
  private rebuildRequested = false;
  private readonly heartbeatTasks: Array<() => void> = [];

  constructor(
    private readonly client: NavidromeClient,
    private readonly guests: GuestSongs,
  ) {}

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
    for (const res of this.clients.keys()) {
      try { res.end(); } catch { /* client already gone */ }
    }
    this.clients.clear();
  }

  /** Session expiry rides this beat, so it runs while playback is idle and no client is open. */
  addHeartbeatTask(task: () => void): void {
    this.heartbeatTasks.push(task);
  }

  // Also reaps peers that vanish without a 'close' event, since it runs while playback is idle.
  private sendHeartbeat(): void {
    for (const task of this.heartbeatTasks) {
      try {
        task();
      } catch (err) {
        logger.warn('webui: heartbeat task failed:', err);
      }
    }
    for (const res of this.clients.keys()) {
      if (isClosed(res) || this.stalls.reapIfStalled(res)) {
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

  addClient(res: ServerResponse): Promise<void> {
    return this.attach(res, HOST_VIEW);
  }

  addGuestClient(res: ServerResponse, sessionId: string, jukebox: () => GuestJukebox | null): Promise<void> {
    return this.attach(res, { kind: 'guest', sessionId, jukebox });
  }

  private async attach(res: ServerResponse, view: ClientView): Promise<void> {
    openSseStream(res, SSE_RETRY_MS);

    this.clients.set(res, view);
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
        if (snapshot !== null) this.fanOut(snapshot);
        rebuild = this.rebuildRequested;
      }
    } finally {
      this.buildInFlight = false;
    }
  }

  // The host and guest forms are serialized once each, and the guest queue once per distinct set of a
  // guest's own songs. Per guest client only the `jukebox` field and the presence of the queue vary.
  private fanOut(snapshot: Snapshot): void {
    let hostJson: string | null = null;
    let guestBaseJson: string | null = null;
    const guestQueueJsonByMine = new Map<string, string>();
    for (const [res, view] of this.clients) {
      // A stream ended with a last event must not be destroyed here, since destroy discards its unflushed frames.
      if (isClosed(res)) {
        this.clients.delete(res);
        continue;
      }
      if (view.kind === 'host') {
        hostJson ??= hostSnapshotJson(snapshot, this.guests.ledger);
        if (!this.writeToClient(res, hostJson)) this.clients.delete(res);
        continue;
      }
      const jukebox = view.jukebox();
      if (jukebox === null) {
        res.destroy();
        this.clients.delete(res);
        continue;
      }
      if (guestBaseJson === null) {
        guestBaseJson = guestBaseSnapshotJson(snapshot);
        this.recordGuestQueue(snapshot);
      }
      const mine = this.guests.ledger.unplayedEntryIds(view.sessionId);
      const mineKey = mine.join(',');
      const queueIdentity = `${String(this.guestQueueVersion)}:${mineKey}`;
      let queueJson: string | null = null;
      if (this.sentGuestQueues.get(res) !== queueIdentity) {
        queueJson = guestQueueJsonByMine.get(mineKey) ?? this.guestQueueJsonFor(snapshot, mine);
        guestQueueJsonByMine.set(mineKey, queueJson);
      }
      const jukeboxView: GuestJukeboxView = { ...jukebox, ...this.guests.counts(view.sessionId) };
      const json = guestSnapshotJson(guestBaseJson, queueJson, jukeboxView);
      if (!this.writeToClient(res, json, queueJson === null ? null : queueIdentity)) this.clients.delete(res);
    }
  }

  // The version follows the queue with no guest's songs marked, which most guests receive.
  private recordGuestQueue(snapshot: Snapshot): void {
    const queueJson = JSON.stringify(toGuestQueue(snapshot.queueEntries, NO_GUEST_SONGS));
    if (queueJson === this.guestQueueJson) return;
    this.guestQueueJson = queueJson;
    this.guestQueueVersion += 1;
  }

  private guestQueueJsonFor(snapshot: Snapshot, mine: readonly number[]): string {
    return mine.length === 0 ? this.guestQueueJson : JSON.stringify(toGuestQueue(snapshot.queueEntries, new Set(mine)));
  }

  private handleDrain(res: ServerResponse): void {
    this.stalls.markDrained(res);
    const held = this.heldSnapshots.get(res);
    if (held === undefined || !this.clients.has(res)) return;
    this.heldSnapshots.delete(res);
    if (!this.writeToClient(res, held.json, held.guestQueueIdentity)) this.clients.delete(res);
  }

  // A guest queue counts as received only once its frame is written, so a held frame that a newer
  // frame replaces never loses a queue change.
  private writeToClient(res: ServerResponse, snapshotJson: string, guestQueueIdentity: string | null = null): boolean {
    if (isClosed(res)) return false;
    if (res.writableNeedDrain) {
      this.heldSnapshots.set(res, { json: snapshotJson, guestQueueIdentity });
      return true;
    }
    try {
      res.write(`event: snapshot\ndata: ${snapshotJson}\n\n`);
      if (guestQueueIdentity !== null) this.sentGuestQueues.set(res, guestQueueIdentity);
      return !res.destroyed;
    } catch (err) {
      logger.debug(
        `webui: SSE write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // allSettled, so one failed read ships a null field instead of blanking the entire snapshot.
  private async buildSnapshot(): Promise<Snapshot | null> {
    const [npResult, queueResult, statusResult] = await Promise.allSettled([
      // The client lets now_playing fill title, artist and album from Navidrome when the engine
      // cache lacks them.
      nowPlaying({}, this.client),
      getPlayQueueEntries(this.client),
      playbackStatus({}),
    ]);

    const np = settled(npResult, 'nowPlaying');
    const queueEntries = settled(queueResult, 'queue');
    const fullStatus = settled(statusResult, 'status');
    const status = fullStatus === null ? null : snapshotStatus(fullStatus);

    // Clients keep their last snapshot rather than receive a frame of three nulls.
    if (np === null && queueEntries === null && status === null) {
      return null;
    }
    return { nowPlaying: np, queueEntries, status };
  }
}

// `player` carries process-global state, so every open remote follows a theme or visualizer change.
function hostSnapshotJson(snapshot: Snapshot, ledger: GuestLedger): string {
  const queue = snapshot.queueEntries === null ? null : toHostQueue(snapshot.queueEntries, ledger);
  const player = { theme: getTheme(), visualizer: isVisualizerAvailable() };
  return JSON.stringify({ nowPlaying: snapshot.nowPlaying, queue, status: snapshot.status, player });
}

/**
 * The items keep the order of the entries, so each entry's mpv id names the guest who added its item.
 * `entryId` lets the page remove an item by id. `guestWaiting` marks a guest song that has not started.
 */
function toHostQueue(entries: QueueEntry[], ledger: GuestLedger): ReturnType<typeof toPlayQueueResult> {
  const result = toPlayQueueResult(entries);
  const items = result.items.map((item, i) => {
    const entryId = entries[i]?.entryId ?? null;
    const guestLabel = entryId === null ? null : ledger.guestLabelOf(entryId);
    if (entryId === null || guestLabel === null) return { ...item, entryId };
    return ledger.isStarted(entryId) ? { ...item, entryId, guestLabel } : { ...item, entryId, guestLabel, guestWaiting: true };
  });
  return { ...result, items };
}

function guestBaseSnapshotJson(snapshot: Snapshot): string {
  const base: Omit<GuestSnapshot, 'queue' | 'jukebox'> = {
    nowPlaying: toGuestNowPlaying(snapshot.nowPlaying),
    visualizer: isVisualizerAvailable(),
    theme: getTheme(),
  };
  return JSON.stringify(base);
}

// The base object always has fields, so its closing brace is the last character and a comma can follow.
function guestSnapshotJson(guestBaseJson: string, queueJson: string | null, jukebox: GuestJukeboxView): string {
  const queueField = queueJson === null ? '' : `,"queue":${queueJson}`;
  return `${guestBaseJson.slice(0, -1)}${queueField},"jukebox":${JSON.stringify(jukebox)}}`;
}

// The guest view reads this too, so a guest page never opens the visualizer feed the host turned off.
function isVisualizerAvailable(): boolean {
  return getVisualizer() && !playbackEngine.isVisualizerUnsupported();
}

// A dead peer does not make res.write() throw, so liveness is read from the stream flags.
function isClosed(res: ServerResponse): boolean {
  return res.destroyed || res.writableEnded;
}

// In mode `none` LAN peers read this stream with no login. mpvPath can name the host or its owner, and mpvVersion
// fingerprints the host. Device names stay on the device route, which answers only when asked.
function snapshotStatus(
  status: PlaybackStatus,
): Pick<PlaybackStatus, 'engineRunning' | 'volume' | 'idle' | 'audioOutputLost'> {
  return {
    engineRunning: status.engineRunning,
    volume: status.volume,
    idle: status.idle,
    audioOutputLost: status.audioOutputLost,
  };
}

function settled<T>(result: PromiseSettledResult<T>, field: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
  logger.debug(`webui: buildSnapshot ${field} read failed: ${reason}`);
  return null;
}
