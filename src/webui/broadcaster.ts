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
import { logger } from '../utils/logger.js';

/**
 * Minimum gap between consecutive `time-pos` driven broadcasts. mpv emits the
 * time-pos property change roughly every 250ms while playing — broadcasting
 * the full now-playing + queue snapshot at that cadence wastes CPU on every
 * connected client, and the UI is happy interpolating between 1-second-spaced
 * server values for a smooth progress bar. Other events (pause, volume,
 * playlist-pos, queue mutations) bypass the throttle so they're reflected
 * immediately — those are the ones the user feels as latency.
 */
const POSITION_THROTTLE_MS = 1000;

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
 * Throttling: `time-pos` events are debounced (leading + trailing) to at
 * most one broadcast per second. All other events flush immediately.
 *
 * Snapshot construction reuses the existing `nowPlaying` and `getPlayQueue`
 * tool impl functions so the web UI sees byte-identical shapes to what an
 * MCP client would see. Failures (e.g. mpv momentarily unreachable) are
 * swallowed at debug level — the next event will produce a fresh attempt.
 */
export class SseBroadcaster {
  private readonly clients = new Set<ServerResponse>();
  private lastPositionEmitMs = 0;
  private pendingPositionTimer: NodeJS.Timeout | null = null;
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
    if (this.pendingPositionTimer !== null) {
      clearTimeout(this.pendingPositionTimer);
      this.pendingPositionTimer = null;
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
    if (snapshot !== null) this.writeToClient(res, snapshot);
  }

  /** Number of currently-connected SSE clients. Used for diagnostics. */
  clientCount(): number {
    return this.clients.size;
  }

  private handleEvent(evt: StateChangeEvent): void {
    // time-pos is the only high-frequency property; everything else fires on
    // discrete user actions or track boundaries. Throttle time-pos to ~1Hz
    // (leading edge fires immediately, trailing edge ensures the final
    // post-pause value is delivered).
    if (evt.kind === 'property' && evt.name === 'time-pos') {
      const now = Date.now();
      const elapsed = now - this.lastPositionEmitMs;
      if (elapsed >= POSITION_THROTTLE_MS) {
        this.lastPositionEmitMs = now;
        void this.broadcast();
      } else if (this.pendingPositionTimer === null) {
        const delay = POSITION_THROTTLE_MS - elapsed;
        this.pendingPositionTimer = setTimeout(() => {
          this.pendingPositionTimer = null;
          this.lastPositionEmitMs = Date.now();
          void this.broadcast();
        }, delay);
        // Don't keep the event loop alive solely for a pending broadcast.
        this.pendingPositionTimer.unref();
      }
      return;
    }

    // All other events: immediate fan-out. Also reset the trailing-edge
    // timer's deadline by stamping lastPositionEmitMs — the snapshot we're
    // about to send is fresher than any queued time-pos broadcast.
    this.lastPositionEmitMs = Date.now();
    if (this.pendingPositionTimer !== null) {
      clearTimeout(this.pendingPositionTimer);
      this.pendingPositionTimer = null;
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
    try {
      // Status carries volume + engine running flag; the now-playing and
      // queue shapes don't include volume so the web UI has no other path
      // to seed the slider. Three reads are kept parallel for latency on
      // first-paint; they all hit local caches after the first sample.
      const [np, queue, status] = await Promise.all([
        nowPlaying({}),
        getPlayQueue(this.client, {}),
        playbackStatus({}),
      ]);
      return JSON.stringify({ nowPlaying: np, queue, status });
    } catch (err) {
      logger.debug(
        `webui: buildSnapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
