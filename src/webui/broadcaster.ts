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
import { getPersist, hasLiveParent } from '../web/player-runtime.js';
import { logger } from '../utils/logger.js';

/**
 * Minimum gap between consecutive broadcasts triggered by mpv property
 * changes. mpv emits property events at high frequency in two cases:
 *   - `time-pos` ticks ~every 250ms during playback.
 *   - `playlist-count` / `playlist-pos` / `metadata` burst-fire during a bulk
 *     `loadfile` sequence (one event per loaded track — hundreds, for a
 *     "play 500 starred albums" stress test).
 *
 * Without coalescing, each event would trigger a full `buildSnapshot` that
 * runs `getPlayQueue` against a *growing* playlist on every step of a bulk
 * load — gratuitous CPU/IPC churn, and historically the proximate trigger
 * of the 64KB mpv-IPC buffer overflow.
 *
 * 1000ms (1Hz) is fine for the progress bar (the UI interpolates between
 * server values), and is the right ceiling for bulk-load coalescing too.
 *
 * `kind: 'queue'` events (the explicit post-enqueue emit) are NOT throttled
 * — those mark "the user-facing operation is done, the UI should reflect
 * it now." Same for `kind: 'station'` (radio start/stop) and any future
 * non-property kinds.
 */
const BROADCAST_THROTTLE_MS = 1000;

/**
 * EventSource reconnect interval the server advertises on connect. Browsers
 * respect this verbatim, so a value here is what determines how often a phone
 * laid down on a desk silently re-tries after the server restarts or the
 * Wi-Fi drops. 10s mirrors what the user requested.
 */
const SSE_RETRY_MS = 10_000;

/**
 * Broadcasts engine state snapshots to a set of SSE clients.
 *
 * Lifecycle:
 *   - `start()` subscribes to the playback engine's onStateChange events.
 *   - `addClient(res)` registers a new SSE response, sends the retry directive,
 *     and pushes an initial snapshot so the UI never sits on a blank frame.
 *   - On disconnect, the response is removed from the active set.
 *   - `stop()` unsubscribes and ends every active SSE response cleanly.
 *
 * Throttling: all property-change events are debounced (leading + trailing)
 * to at most one broadcast per `BROADCAST_THROTTLE_MS`. Non-property events
 * (queue mutations, station start/stop) flush immediately so user-actioned
 * boundaries land in the UI within one frame.
 *
 * Snapshot construction reuses the existing `nowPlaying`, `getPlayQueue`,
 * and `playbackStatus` tool impl functions so the web UI sees byte-identical
 * shapes to what an MCP client would see. Each read is independently
 * resilient via `Promise.allSettled` — one failed read leaves a `null` field
 * on the wire rather than blanking the whole snapshot.
 */
export class SseBroadcaster {
  private readonly clients = new Set<ServerResponse>();
  private lastBroadcastMs = 0;
  private pendingBroadcastTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly client: NavidromeClient) {}

  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = playbackEngine.onStateChange((evt) => this.handleEvent(evt));
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
    for (const res of this.clients) {
      try { res.end(); } catch { /* client already gone */ }
    }
    this.clients.clear();
  }

  /**
   * Register an SSE response. Writes the retry directive immediately so the
   * browser learns the reconnect interval even if the connection drops
   * before the first snapshot arrives, then attempts an initial snapshot
   * push so the UI has data the moment it connects.
   */
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

    const snapshot = await this.buildSnapshot();
    // Re-check membership: the client may have disconnected during the await
    // (the 'close' handler above already removed it). Writing to a socket
    // that's gone is harmless but pointless; gating on `clients.has(res)`
    // also avoids racing a concurrent broadcast() that snapshotted the set
    // while this client was half-closed.
    if (snapshot !== null && this.clients.has(res)) this.writeToClient(res, snapshot);
  }

  /** Number of currently-connected SSE clients. Used for diagnostics. */
  clientCount(): number {
    return this.clients.size;
  }

  private handleEvent(evt: StateChangeEvent): void {
    // All property-change events go through the throttle (leading +
    // trailing edge). This covers high-frequency time-pos ticks AND the
    // burst of playlist-count/metadata events that fires during a bulk
    // loadfile sequence — without coalescing, both would trigger a full
    // buildSnapshot per event.
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

    // Non-property events (queue mutations, station start/stop, etc.):
    // immediate fan-out — these mark user-facing operation boundaries and
    // the UI should reflect them within one frame. Also reset the
    // trailing-edge timer's deadline since the snapshot we're about to
    // send is fresher than any queued throttled broadcast.
    this.lastBroadcastMs = Date.now();
    if (this.pendingBroadcastTimer !== null) {
      clearTimeout(this.pendingBroadcastTimer);
      this.pendingBroadcastTimer = null;
    }
    void this.broadcast();
  }

  private async broadcast(): Promise<void> {
    if (this.clients.size === 0) return;
    const snapshot = await this.buildSnapshot();
    if (snapshot === null) return;
    for (const res of this.clients) {
      this.writeToClient(res, snapshot);
    }
  }

  private writeToClient(res: ServerResponse, snapshotJson: string): void {
    try {
      res.write(`event: snapshot\ndata: ${snapshotJson}\n\n`);
    } catch (err) {
      // Pipe broken or client gone. The 'close' handler will clean up the
      // entry from the active set; here we just suppress the throw so other
      // clients still get their event.
      logger.debug(
        `webui: SSE write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async buildSnapshot(): Promise<string | null> {
    // Status carries volume + engine running flag; the now-playing and
    // queue shapes don't include volume so the web UI has no other path
    // to seed the slider. Three reads are kept parallel for latency on
    // first-paint; they all hit local caches after the first sample.
    //
    // allSettled (not all) so a single failed read doesn't blank the
    // entire snapshot. The web UI already tolerates null for any of the
    // three fields — better to ship "engine alive but queue temporarily
    // unavailable" than to fall silent and leave the user wondering if
    // the MCP server has died.
    const [npResult, queueResult, statusResult] = await Promise.allSettled([
      // Pass the client so now_playing can resolve title/artist/album by songId
      // after an MCP restart (empty engine cache) — same enrichment the MCP
      // tool path gets — instead of leaving the web UI's card blank.
      nowPlaying({}, this.client),
      getPlayQueue(this.client, {}),
      playbackStatus({}),
    ]);

    const np = settled(npResult, 'nowPlaying');
    const queue = settled(queueResult, 'queue');
    const status = settled(statusResult, 'status');

    // If every read failed, there's nothing useful to broadcast.
    // Returning null skips the SSE write — clients keep their last
    // snapshot rather than seeing a triple-null frame.
    if (np === null && queue === null && status === null) {
      return null;
    }

    // `player` carries process-global lifecycle state so the frontend can
    // recompute the power-button visibility live (it flips the instant MCP
    // disconnects or persist is toggled). It is NOT per-peer — the client
    // combines this with its own `isLocal` (one-time /api/player-state fetch).
    const player = { hasLiveParent: hasLiveParent(), persist: getPersist() };
    return JSON.stringify({ nowPlaying: np, queue, status, player });
  }
}

/**
 * Unwrap a settled promise result, logging at debug on rejection and
 * returning null so the caller can ship a partial snapshot. The `field`
 * label is included in the log so a recurring failure is identifiable
 * without ambiguity about which read broke.
 */
function settled<T>(result: PromiseSettledResult<T>, field: string): T | null {
  if (result.status === 'fulfilled') return result.value;
  const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
  logger.debug(`webui: buildSnapshot ${field} read failed: ${reason}`);
  return null;
}
