/**
 * Navidrome MCP Server - Visualizer level hub
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
import { SSE_HEARTBEAT_MS, VISUALIZER_FEED_GRACE_MS } from '../constants/timeouts.js';
import type { LevelRecord } from '../services/playback/visualizer-log.js';
import { openSseStream } from './http-helpers.js';
import { VisualizerFeed } from './visualizer-feed.js';

// Measurements arrive about 0.28 s before the audio plays, so ten batches a second keep the browser ahead.
const FLUSH_INTERVAL_MS = 100;
const SSE_RETRY_MS = 5000;

interface LevelFeed {
  start(): void;
  stop(): void;
}

/** Fans the level feed out to every open visualizer, and runs the feed only while one is open. */
export class VisualizerHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly feed: LevelFeed;
  private batch: LevelRecord[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  private lastWriteMs = 0;
  // Ending the streams in stop() fires their close handlers, which must not schedule a new grace timer.
  private stopped = false;

  constructor(
    createFeed: (onRecord: (record: LevelRecord) => void) => LevelFeed = (onRecord) => new VisualizerFeed(onRecord),
  ) {
    this.feed = createFeed((record) => {
      if (this.clients.size > 0) this.batch.push(record);
    });
  }

  // GET /api/visualizer. The stream stays open after this returns, until the client disconnects.
  addClient(res: ServerResponse): void {
    openSseStream(res, SSE_RETRY_MS);
    this.clients.add(res);
    res.on('close', () => { this.removeClient(res); });
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    this.feed.start();
    if (this.flushTimer === null) {
      this.lastWriteMs = Date.now();
      this.flushTimer = setInterval(() => { this.flush(); }, FLUSH_INTERVAL_MS);
      this.flushTimer.unref();
    }
  }

  stop(): void {
    this.stopped = true;
    this.stopTimers();
    this.feed.stop();
    for (const res of this.clients) {
      try { res.end(); } catch { /* client already gone */ }
    }
    this.clients.clear();
    this.batch = [];
  }

  private removeClient(res: ServerResponse): void {
    this.clients.delete(res);
    if (this.stopped || this.clients.size > 0) return;
    this.stopTimers();
    this.batch = [];
    // A page reload reconnects within the grace, so the feed keeps its mpv connection through it.
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.feed.stop();
    }, VISUALIZER_FEED_GRACE_MS);
    this.stopTimer.unref();
  }

  private stopTimers(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  // A backed-up viewer skips the batch, since the next batch replaces it and old levels have no use.
  private flush(): void {
    const now = Date.now();
    let payload: string | null = null;
    if (this.batch.length > 0) {
      const frames = this.batch.map((record) => [record.segment, Math.round(record.ptsSeconds * 1000), ...record.levels]);
      this.batch = [];
      payload = `event: levels\ndata: ${JSON.stringify({ frames })}\n\n`;
    } else if (now - this.lastWriteMs >= SSE_HEARTBEAT_MS) {
      // Paused or idle playback sends no levels, and a proxy may close a stream that stays quiet.
      payload = ': ping\n\n';
    }
    if (payload === null) return;
    this.lastWriteMs = now;
    for (const res of this.clients) {
      if (res.destroyed || res.writableEnded) {
        this.clients.delete(res);
        continue;
      }
      if (!res.writableNeedDrain) res.write(payload);
    }
  }
}
