/**
 * Navidrome MCP Server - Visualizer log parser
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

import { VISUALIZER_BAND_COUNT } from './visualizer-filter.js';

/** One measurement of every band. `segment` changes when timestamps restart, which marks a new file. */
export interface LevelRecord {
  segment: number;
  ptsSeconds: number;
  /** Whole decibels per band, lowest band first, clamped to the floor and 0. */
  levels: number[];
}

/** The fields of an mpv `log-message` event that the parser reads. */
interface LogMessage {
  prefix: unknown;
  text: unknown;
}

// mpv's IPC docs warn that log text may change between releases, so anything unmatched is skipped, never fatal.
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
 * Groups the visualizer filter's log lines into records. Other FFmpeg lines can land between a
 * frame line and its band lines, so band lines join the pending record only from the same filter instance.
 */
export class VisualizerLogParser {
  private pending: PendingRecord | null = null;
  private segment = 0;
  private lastPts = Number.POSITIVE_INFINITY;

  push(message: LogMessage): LevelRecord | null {
    // mpv drops the oldest lines when a reader falls behind, which can split a record.
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
