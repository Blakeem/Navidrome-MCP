/**
 * Navidrome MCP Server - Local Lyrics Tag Parser
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

// A leaf module, so the song transformer reads the lyrics tag without importing the LRCLIB tool.

import type { LyricsLine } from '../types/index.js';

/**
 * How long the final synced line is held when neither a later marker nor a
 * track duration bounds it. `endMs` is required, so some bound must exist.
 */
export const LAST_LINE_FALLBACK_MS = 5000;

/** A lone short line in a file's lyrics tag is a tagger watermark, not lyrics. */
const WATERMARK_MAX_LENGTH = 40;

/** A timestamp with its text. Empty text marks a boundary rather than a line. */
export interface TimedMarker {
  readonly timeMs: number;
  readonly text: string;
}

/** One line of a Navidrome file lyrics entry. `start` is absent on unsynced entries. */
interface LocalLyricsLine {
  readonly start?: number;
  readonly value: string;
}

/** One language variant inside a Navidrome file lyrics tag. */
interface LocalLyricsEntry {
  readonly lang: string;
  readonly synced: boolean;
  readonly lines: readonly LocalLyricsLine[];
}

/** Normalized lyrics read from the audio file's own tag. */
export interface LocalLyricsResult {
  readonly hasSynced: boolean;
  readonly synced?: LyricsLine[];
  readonly unsynced?: string;
}

/**
 * Turn ordered markers into lines, consuming empty-text markers as end
 * boundaries. The final line falls back to the track duration and then to a
 * fixed hold, because `endMs` is required.
 */
export function buildTimedLines(markers: readonly TimedMarker[], durationMs?: number): LyricsLine[] {
  const ordered = [...markers].sort((a, b) => a.timeMs - b.timeMs);
  const lines: LyricsLine[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const marker = ordered[index];
    if (marker === undefined || marker.text === '') continue;

    const next = ordered[index + 1];
    let endMs: number;
    if (next !== undefined) {
      endMs = next.timeMs;
    } else if (durationMs !== undefined && durationMs > marker.timeMs) {
      // A duration at or before the line start would produce an end before its
      // own start, which no consumer can display.
      endMs = durationMs;
    } else {
      endMs = marker.timeMs + LAST_LINE_FALLBACK_MS;
    }

    lines.push({ timeMs: marker.timeMs, endMs, text: marker.text });
  }

  return lines;
}

function parseJsonPayload(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed;
  } catch {
    // The tag is copied through from the file verbatim, so anything unparseable
    // has to read as "no lyrics" rather than fail the whole lookup.
    return null;
  }
}

function toLyricsEntry(candidate: unknown): LocalLyricsEntry | null {
  if (candidate === null || typeof candidate !== 'object') return null;

  const record = candidate as Record<string, unknown>;
  const rawLines = record['line'];
  if (!Array.isArray(rawLines)) return null;

  const lines: LocalLyricsLine[] = [];
  for (const rawLine of rawLines as readonly unknown[]) {
    if (rawLine === null || typeof rawLine !== 'object') continue;

    const lineRecord = rawLine as Record<string, unknown>;
    const rawValue = lineRecord['value'];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    const start = lineRecord['start'];
    lines.push(
      typeof start === 'number' && Number.isFinite(start)
        ? { start: Math.max(0, Math.round(start)), value }
        : { value },
    );
  }

  if (lines.length === 0) return null;

  const only = lines.length === 1 ? lines[0] : undefined;
  if (only !== undefined && only.value.length < WATERMARK_MAX_LENGTH) return null;

  return {
    lang: typeof record['lang'] === 'string' ? record['lang'] : '',
    synced: record['synced'] === true,
    lines,
  };
}

function isRealLanguage(lang: string): boolean {
  return lang !== '' && lang.toLowerCase() !== 'xxx';
}

function compareLyricsEntries(a: LocalLyricsEntry, b: LocalLyricsEntry): number {
  if (a.synced !== b.synced) return a.synced ? -1 : 1;

  const aReal = isRealLanguage(a.lang);
  const bReal = isRealLanguage(b.lang);
  if (aReal !== bReal) return aReal ? -1 : 1;

  return b.lines.length - a.lines.length;
}

function selectLyricsEntry(raw: unknown): LocalLyricsEntry | null {
  const payload = parseJsonPayload(raw);
  if (!Array.isArray(payload)) return null;

  let best: LocalLyricsEntry | null = null;
  for (const candidate of payload as readonly unknown[]) {
    const entry = toLyricsEntry(candidate);
    if (entry === null) continue;
    if (best === null || compareLyricsEntries(entry, best) < 0) best = entry;
  }

  return best;
}

/**
 * Normalize a Navidrome song row's `lyrics` tag. Every malformed shape yields
 * null so a bad tag on one row can never fail a listing or a lookup.
 */
export function parseLocalLyrics(raw: unknown, durationMs?: number): LocalLyricsResult | null {
  // INPUT
  const entry = selectLyricsEntry(raw);
  if (entry === null) return null;

  // PROCESS
  const markers: TimedMarker[] = [];
  for (const line of entry.lines) {
    if (line.start !== undefined) markers.push({ timeMs: line.start, text: line.value });
  }

  const synced = entry.synced ? buildTimedLines(markers, durationMs) : [];
  const unsynced = entry.lines.map((line) => line.value).join('\n').trim();

  // OUTPUT
  if (synced.length === 0 && unsynced === '') return null;

  return {
    hasSynced: synced.length > 0,
    ...(synced.length > 0 ? { synced } : {}),
    ...(unsynced !== '' ? { unsynced } : {}),
  };
}
