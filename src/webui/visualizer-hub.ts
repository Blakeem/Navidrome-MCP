/**
 * Navidrome MCP Server - Visualizer level hub
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import { SSE_HEARTBEAT_MS, VISUALIZER_FEED_GRACE_MS } from '../constants/timeouts.js';
import type { LevelRecord } from '../services/playback/visualizer-log.js';
import { openSseStream } from './http-helpers.js';
import { StallReaper } from './stall-reaper.js';
import { VisualizerFeed } from './visualizer-feed.js';

// Measurements arrive about 0.28 s before the audio plays, so ten batches a second keep the browser
// ahead.
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
  private lastReapMs = 0;
  private readonly stalls = new StallReaper();
  // Ending the streams in stop() fires their close handlers, which must not schedule a grace timer.
  private stopped = false;

  constructor(
    createFeed: (onRecord: (record: LevelRecord) => void) => LevelFeed = (onRecord) => new VisualizerFeed(onRecord),
  ) {
    this.feed = createFeed((record) => {
      if (this.clients.size > 0) this.batch.push(record);
    });
  }

  addClient(res: ServerResponse): void {
    openSseStream(res, SSE_RETRY_MS);
    this.clients.add(res);
    res.on('close', () => { this.removeClient(res); });
    res.on('drain', () => { this.stalls.markDrained(res); });
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    this.feed.start();
    if (this.flushTimer === null) {
      this.lastWriteMs = Date.now();
      this.lastReapMs = this.lastWriteMs;
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

  // The flush tick also carries the stall check, since the hub has no heartbeat timer of its own.
  private reapStalledOnHeartbeat(now: number): void {
    if (now - this.lastReapMs < SSE_HEARTBEAT_MS) return;
    this.lastReapMs = now;
    for (const res of this.clients) {
      if (this.stalls.reapIfStalled(res)) this.clients.delete(res);
    }
  }

  // A backed-up viewer skips the batch, since the next batch replaces it.
  private flush(): void {
    const now = Date.now();
    this.reapStalledOnHeartbeat(now);
    let payload: string | null = null;
    if (this.batch.length > 0) {
      const frames = this.batch.map((record) => [record.segment, Math.round(record.ptsSeconds * 1000), ...record.levels]);
      this.batch = [];
      payload = `event: levels\ndata: ${JSON.stringify({ frames })}\n\n`;
    } else if (now - this.lastWriteMs >= SSE_HEARTBEAT_MS) {
      // Paused or idle playback sends no levels, so the stream needs its own heartbeat.
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
