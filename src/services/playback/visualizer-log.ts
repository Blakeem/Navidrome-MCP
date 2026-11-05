/**
 * Navidrome MCP Server - Visualizer log parser
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { VISUALIZER_BAND_COUNT } from './visualizer-filter.js';

/** `segment` changes when timestamps restart, which marks a new file. */
export interface LevelRecord {
  segment: number;
  ptsSeconds: number;
  /** Integer decibels per band, lowest band first, clamped to FLOOR_DB and 0. */
  levels: number[];
}

interface LogMessage {
  prefix: unknown;
  text: unknown;
}

// mpv's IPC docs warn that log text may change between releases, so an unmatched line is skipped,
// never fatal.
const FRAME_LINE = /^(Parsed_ametadata_\d+): frame:(\d+)\s+pts:\S+\s+pts_time:(\S+)/;
const BAND_LINE = /^(Parsed_ametadata_\d+): lavfi\.astats\.(\d+)\.RMS_level=(\S+)/;
// astats prints -inf for a silent band, which Number() reads as NaN.
const FLOOR_DB = -100;

interface PendingRecord {
  filter: string;
  ptsSeconds: number;
  levels: Array<number | undefined>;
  received: number;
}

/**
 * Other FFmpeg lines can land between a frame line and its band lines, so a band line joins the
 * pending record only from the same filter instance.
 */
export class VisualizerLogParser {
  private pending: PendingRecord | null = null;
  private segment = 0;
  private lastPts = Number.POSITIVE_INFINITY;

  push(message: LogMessage): LevelRecord | null {
    // mpv drops lines when a reader falls behind, which can split a record.
    if (message.prefix === 'overflow') {
      this.pending = null;
      return null;
    }
    if (message.prefix !== 'ffmpeg' || typeof message.text !== 'string') return null;

    const frame = FRAME_LINE.exec(message.text);
    if (frame !== null) {
      this.startRecord(frame[1] ?? '', Number(frame[2]), Number(frame[3]));
      return null;
    }
    const band = BAND_LINE.exec(message.text);
    if (band === null) return null;
    return this.addBand(band[1] ?? '', Number(band[2]) - 1, Number(band[3]));
  }

  /** Drops a half-built record, so a reconnect never joins lines from both sides of the gap. */
  reset(): void {
    this.pending = null;
  }

  private startRecord(filter: string, frameNumber: number, ptsSeconds: number): void {
    this.pending = null;
    if (!Number.isFinite(ptsSeconds)) return;
    if (frameNumber === 0 || ptsSeconds < this.lastPts) this.segment += 1;
    this.lastPts = ptsSeconds;
    this.pending = { filter, ptsSeconds, levels: new Array<number | undefined>(VISUALIZER_BAND_COUNT), received: 0 };
  }

  private addBand(filter: string, index: number, db: number): LevelRecord | null {
    const pending = this.pending;
    if (pending === null || pending.filter !== filter || index < 0 || index >= VISUALIZER_BAND_COUNT) return null;
    if (pending.levels[index] === undefined) pending.received += 1;
    pending.levels[index] = toWholeDb(db);
    if (pending.received < VISUALIZER_BAND_COUNT) return null;
    this.pending = null;
    return { segment: this.segment, ptsSeconds: pending.ptsSeconds, levels: pending.levels.map((level) => level ?? FLOOR_DB) };
  }
}

function toWholeDb(db: number): number {
  if (Number.isNaN(db)) return FLOOR_DB;
  return Math.round(Math.min(0, Math.max(FLOOR_DB, db)));
}
