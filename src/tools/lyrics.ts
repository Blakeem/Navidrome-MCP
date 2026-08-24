/**
 * Navidrome MCP Server - Lyrics Tools
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

import type { z } from 'zod';
import type {
  LyricsCandidateDTO,
  LyricsDTO,
  LyricsLine,
  LyricsSearchDTO,
} from '../types/index.js';
import type { Config } from '../config.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from '../utils/fetch-with-timeout.js';
import { DEFAULT_USER_AGENT } from '../constants/defaults.js';
import {
  GetLyricsIdentitySchema,
  GetLyricsSchema,
  SearchLyricsSchema,
} from '../schemas/index.js';
import { searchSongs } from './search/index.js';

type GetLyricsParams = z.infer<typeof GetLyricsSchema>;

/**
 * How long the final synced line is held when neither a later marker nor a
 * track duration bounds it. `endMs` is required, so some bound must exist.
 */
export const LAST_LINE_FALLBACK_MS = 5000;

/** A lone short line in a file's lyrics tag is a tagger watermark, not lyrics. */
const WATERMARK_MAX_LENGTH = 40;

/** LRCLIB search answers with dozens of rows, so a candidate list is capped to
 *  keep the tool result inside a sane context budget. */
const MAX_LYRICS_CANDIDATES = 10;

/** How many library rows the local match scans before giving up. */
const LIBRARY_MATCH_LIMIT = 20;

/** Stands in for a track field that neither the song row nor LRCLIB supplied. */
const UNKNOWN_TRACK_FIELD = 'Unknown';

const GET_PATH = '/api/get';
const SEARCH_PATH = '/api/search';

/**
 * LRCLIB API response interface
 */
interface LRCLIBResponse {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

/** One LRCLIB ladder rung. The path plus the serialized query is its dedup key. */
interface LrclibRung {
  readonly kind: 'get' | 'search';
  readonly path: string;
  readonly query: URLSearchParams;
}

/** A timestamp with its text. Empty text marks a boundary rather than a line. */
interface TimedMarker {
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
interface LocalLyricsResult {
  readonly hasSynced: boolean;
  readonly synced?: LyricsLine[];
  readonly unsynced?: string;
}

/** Track fields used to fill a DTO where an LRCLIB record omits its own. */
interface TrackFallback {
  readonly title: string;
  readonly artist: string;
  readonly album?: string | undefined;
  readonly durationMs?: number | undefined;
}

/** Source selection for the resolver. Omitting it keeps the LRCLIB-only behavior. */
interface GetLyricsOptions {
  readonly client?: NavidromeClient;
  readonly songId?: string;
  readonly allowLrclib?: boolean;
}

// ---------------------------------------------------------------------------
// Shared parsing
// ---------------------------------------------------------------------------

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Turn ordered markers into lines, consuming empty-text markers as end
 * boundaries. The final line falls back to the track duration and then to a
 * fixed hold, because `endMs` is required.
 */
function buildTimedLines(markers: readonly TimedMarker[], durationMs?: number): LyricsLine[] {
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

/**
 * Parse LRC format synced lyrics into structured format
 */
function parseSyncedLyrics(lrcText: string, durationMs?: number): LyricsLine[] {
  const markers: TimedMarker[] = [];
  // Anchored tag matcher: LRC lines legally group multiple timestamps for a
  // repeated section (e.g. `[01:02.34][01:15.67]lyric`). Extract each leading
  // tag in turn rather than greedily swallowing later tags into the text.
  const tagRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const rawLine of lrcText.split('\n')) {
    // Trim leading whitespace before anchoring: community-sourced LRC text may
    // carry a leading space, a stray `\r` (from `\r\n` split), a BOM, or hand
    // indentation. Without this the anchored regex misses the tag and the whole
    // line — timestamp AND lyric — is silently dropped.
    let rest = rawLine.trimStart();
    const timestamps: number[] = [];

    let tag = tagRegex.exec(rest);
    while (tag !== null) {
      const [, minutesStr = '', secondsStr = '', fractionStr = ''] = tag;

      const minutes = parseInt(minutesStr, 10);
      const seconds = parseInt(secondsStr, 10);
      const fraction = parseInt(fractionStr, 10);
      // 3-digit groups are milliseconds; 2-digit groups are centiseconds (×10).
      const fractionMs = fractionStr.length === 3 ? fraction : fraction * 10;
      timestamps.push((minutes * 60 + seconds) * 1000 + fractionMs);

      // trimStart again so whitespace between grouped tags (`[..] [..]lyric`)
      // doesn't stop the loop and leak the next tag's brackets into the text.
      rest = rest.slice(tag[0].length).trimStart();
      tag = tagRegex.exec(rest);
    }

    // An untimed line is an LRC metadata tag (`[ar:...]`) or stray text.
    if (timestamps.length === 0) continue;

    const text = rest.trim();
    for (const timeMs of timestamps) {
      markers.push({ timeMs, text });
    }
  }

  return buildTimedLines(markers, durationMs);
}

// ---------------------------------------------------------------------------
// Local file source
// ---------------------------------------------------------------------------

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

async function fetchSongRow(
  client: NavidromeClient,
  songId: string,
): Promise<Record<string, unknown> | null> {
  const row = await client.requestWithLibraryFilter<unknown>(`/song/${encodeURIComponent(songId)}`);
  if (row === null || typeof row !== 'object') return null;

  return row as Record<string, unknown>;
}

function readRowText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchLocalLyrics(
  client: NavidromeClient,
  songId: string,
  durationMs?: number,
): Promise<LocalLyricsResult | null> {
  const row = await fetchSongRow(client, songId);
  if (row === null) return null;

  return parseLocalLyrics(row['lyrics'], durationMs);
}

// ---------------------------------------------------------------------------
// LRCLIB source
// ---------------------------------------------------------------------------

function buildGetQuery(
  params: GetLyricsParams,
  album: string | undefined,
  durationSec: string | undefined,
): URLSearchParams {
  const query = new URLSearchParams();
  query.set('track_name', params.title);
  query.set('artist_name', params.artist);
  if (album !== undefined) query.set('album_name', album);
  if (durationSec !== undefined) query.set('duration', durationSec);
  return query;
}

/**
 * Ordered ladder: narrowest exact lookup first, structured search last.
 * Rungs that serialize identically are dropped by `dedupeRungs`, so a bare
 * title+artist lookup costs one `/api/get` rather than three.
 */
function buildLrclibRungs(params: GetLyricsParams): LrclibRung[] {
  const rungs: LrclibRung[] = [];
  const album = params.album !== undefined && params.album !== '' ? params.album : undefined;
  const durationSec =
    params.durationMs !== undefined ? String(Math.round(params.durationMs / 1000)) : undefined;

  // A known record id is looked up as a path segment. LRCLIB answers 400, not
  // 404, to `/api/get?id=`, which the error contract turns into a hard throw.
  if (params.id !== undefined && params.id !== '') {
    const path = `/api/get/${encodeURIComponent(params.id)}`;
    rungs.push({ kind: 'get', path, query: new URLSearchParams() });
  }

  rungs.push({ kind: 'get', path: GET_PATH, query: buildGetQuery(params, album, durationSec) });
  rungs.push({ kind: 'get', path: GET_PATH, query: buildGetQuery(params, album, undefined) });
  rungs.push({ kind: 'get', path: GET_PATH, query: buildGetQuery(params, undefined, undefined) });

  const search = new URLSearchParams();
  search.set('track_name', params.title);
  search.set('artist_name', params.artist);
  rungs.push({ kind: 'search', path: SEARCH_PATH, query: search });

  return rungs;
}

function dedupeRungs(rungs: readonly LrclibRung[]): LrclibRung[] {
  const seen = new Set<string>();
  const unique: LrclibRung[] = [];

  for (const rung of rungs) {
    const key = `${rung.path}?${rung.query.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(rung);
  }

  return unique;
}

/**
 * Rank one search hit on title, artist and duration proximity. Duration is only
 * a ranking signal here; it filters on the first ladder rung instead.
 */
function scoreSearchResult(result: LRCLIBResponse, wanted: TrackFallback): number {
  const titleLower = wanted.title.toLowerCase();
  const artistLower = wanted.artist.toLowerCase();
  const durationSec = wanted.durationMs !== undefined ? wanted.durationMs / 1000 : undefined;
  let score = 0;

  if (result.trackName?.toLowerCase() === titleLower) {
    score += 10;
  } else if (result.trackName?.toLowerCase().includes(titleLower) === true) {
    score += 5;
  }

  if (result.artistName?.toLowerCase() === artistLower) {
    score += 10;
  } else if (result.artistName?.toLowerCase().includes(artistLower) === true) {
    score += 5;
  }

  if (durationSec !== undefined && result.duration !== undefined) {
    const tolerance = durationSec * 0.03;
    const diff = Math.abs(result.duration - durationSec);
    if (diff <= tolerance) {
      score += 5;
    }
  }

  return score;
}

function pickBestSearchResult(body: unknown, wanted: TrackFallback): LRCLIBResponse | null {
  // LRCLIB is an external API: a 200 that isn't a JSON array (object, null, or
  // an error payload) must degrade to "no lyrics found", not throw on a
  // non-iterable value.
  if (!Array.isArray(body)) return null;

  const results = body as readonly LRCLIBResponse[];
  let bestMatch: LRCLIBResponse | null = null;
  let bestScore = -1;

  for (const result of results) {
    const score = scoreSearchResult(result, wanted);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

/**
 * Single transport site for every LRCLIB call. A 404 means "not in LRCLIB" and
 * yields null. Every other non-ok status throws, so a downed or rate-limiting
 * LRCLIB never reads as "no lyrics".
 */
async function fetchLrclibBody(rung: LrclibRung, config: Config): Promise<unknown> {
  const url = new URL(rung.path, config.lrclibBase);
  url.search = rung.query.toString();
  const label = rung.kind === 'get' ? `LRCLIB ${GET_PATH}` : `LRCLIB ${SEARCH_PATH}`;

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        'User-Agent': config.lrclibUserAgent ?? DEFAULT_USER_AGENT,
        'Accept': 'application/json',
      },
    },
    {
      timeoutMs: getExternalApiTimeoutMs(),
      retryPolicy: 'safe',
      operationLabel: label,
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(ErrorFormatter.httpRequest(label, response));
  }

  const body: unknown = await response.json();
  return body;
}

async function fetchLrclib(
  rung: LrclibRung,
  wanted: TrackFallback,
  config: Config,
): Promise<LRCLIBResponse | null> {
  const body = await fetchLrclibBody(rung, config);

  if (rung.kind === 'search') {
    return pickBestSearchResult(body, wanted);
  }

  return body as LRCLIBResponse | null;
}

/** Walk the deduplicated ladder, stopping at the first synced hit. */
async function resolveFromLrclib(
  params: GetLyricsParams,
  config: Config,
): Promise<LRCLIBResponse | null> {
  const rungs = dedupeRungs(buildLrclibRungs(params));
  let bestPlain: LRCLIBResponse | null = null;

  for (const rung of rungs) {
    const hit = await fetchLrclib(rung, params, config);
    if (hit === null) continue;
    if (hasText(hit.syncedLyrics)) return hit;
    if (bestPlain === null || (!hasText(bestPlain.plainLyrics) && hasText(hit.plainLyrics))) {
      bestPlain = hit;
    }
  }

  return bestPlain;
}

// ---------------------------------------------------------------------------
// Result assembly
// ---------------------------------------------------------------------------

/**
 * Attribution points at the data source actually queried (which may be a
 * self-hosted mirror), never at credentials embedded in the configured URL.
 */
function resolveOrigin(base: string, fallback: string): string {
  try {
    return new URL(base).origin;
  } catch {
    return fallback;
  }
}

function buildTrack(fallback: TrackFallback): LyricsDTO['track'] {
  const track: LyricsDTO['track'] = { title: fallback.title, artist: fallback.artist };
  if (fallback.album !== undefined && fallback.album !== '') track.album = fallback.album;
  if (fallback.durationMs !== undefined) track.durationMs = fallback.durationMs;
  return track;
}

function buildLocalDto(
  fallback: TrackFallback,
  local: LocalLyricsResult,
  attribution: LyricsDTO['attribution'],
): LyricsDTO {
  const dto: LyricsDTO = {
    track: buildTrack(fallback),
    hasSynced: local.hasSynced,
    isInstrumental: false,
    provider: 'local',
    attribution,
  };

  if (local.synced !== undefined) dto.synced = local.synced;
  if (local.unsynced !== undefined) dto.unsynced = local.unsynced;

  return dto;
}

function buildRemoteDto(
  fallback: TrackFallback,
  data: LRCLIBResponse,
  attribution: LyricsDTO['attribution'],
): LyricsDTO {
  const durationMs =
    typeof data.duration === 'number' && Number.isFinite(data.duration)
      ? data.duration * 1000
      : fallback.durationMs;
  const synced = hasText(data.syncedLyrics) ? parseSyncedLyrics(data.syncedLyrics, durationMs) : [];

  const track: LyricsDTO['track'] = {
    title: hasText(data.trackName) ? data.trackName : fallback.title,
    artist: hasText(data.artistName) ? data.artistName : fallback.artist,
  };
  const album = hasText(data.albumName) ? data.albumName : fallback.album;
  if (album !== undefined && album !== '') track.album = album;
  if (durationMs !== undefined) track.durationMs = durationMs;

  const dto: LyricsDTO = {
    track,
    hasSynced: synced.length > 0,
    isInstrumental: Boolean(data.instrumental),
    provider: 'lrclib',
    attribution,
  };

  if (synced.length > 0) dto.synced = synced;
  if (hasText(data.plainLyrics)) dto.unsynced = data.plainLyrics;

  return dto;
}

function buildEmptyDto(
  fallback: TrackFallback,
  attribution: LyricsDTO['attribution'],
): LyricsDTO {
  return {
    track: buildTrack(fallback),
    hasSynced: false,
    isInstrumental: false,
    provider: 'lrclib',
    attribution,
  };
}

/**
 * Get lyrics for a song from the audio file's own tag and/or LRCLIB.
 * Precedence: local synced, LRCLIB synced, local plain, LRCLIB plain.
 */
export async function getLyrics(
  config: Config,
  args: unknown,
  opts?: GetLyricsOptions,
): Promise<LyricsDTO> {
  // INPUT
  const params = GetLyricsSchema.parse(args);
  const client = opts?.client;
  const songId = opts?.songId;
  const allowLrclib = opts?.allowLrclib ?? true;
  const lrclibAttribution: LyricsDTO['attribution'] = {
    url: resolveOrigin(config.lrclibBase, 'https://lrclib.net'),
    license: 'community-sourced',
  };
  const localAttribution: LyricsDTO['attribution'] = {
    url: resolveOrigin(config.navidromeUrl, 'https://www.navidrome.org'),
    license: 'embedded file metadata',
  };

  logger.debug('Tool getLyrics called with args:', params);

  try {
    // PROCESS
    let local: LocalLyricsResult | null = null;
    if (songId !== undefined && songId !== '') {
      if (client === undefined) {
        logger.warn('getLyrics: songId supplied without a client, skipping local file lyrics');
      } else {
        try {
          local = await fetchLocalLyrics(client, songId, params.durationMs);
        } catch (error) {
          // The file tag is one source among several, so an unreadable song row
          // must not strand a lookup that LRCLIB can still answer.
          logger.warn(
            'getLyrics: local file lyrics unavailable, continuing with LRCLIB:',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }

    if (local?.hasSynced === true) {
      return buildLocalDto(params, local, localAttribution);
    }

    const remote = allowLrclib ? await resolveFromLrclib(params, config) : null;
    const remoteDto = remote !== null ? buildRemoteDto(params, remote, lrclibAttribution) : null;

    // OUTPUT
    if (remoteDto?.hasSynced === true) return remoteDto;
    if (local !== null) return buildLocalDto(params, local, localAttribution);
    if (remoteDto !== null) return remoteDto;

    return buildEmptyDto(params, lrclibAttribution);
  } catch (error) {
    // Transport errors (5xx, 429, network failures) are re-thrown with context so
    // callers can distinguish config/network problems from "song not in LRCLIB".
    logger.warn(
      'getLyrics: lookup failed (transport/config error, not a missing track):',
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(ErrorFormatter.toolExecution('getLyrics', error));
  }
}

// ---------------------------------------------------------------------------
// Identity lookup (get_lyrics)
// ---------------------------------------------------------------------------

async function resolveByLrclibId(config: Config, lrclibId: string): Promise<LyricsDTO> {
  const rung: LrclibRung = {
    kind: 'get',
    path: `${GET_PATH}/${encodeURIComponent(lrclibId)}`,
    query: new URLSearchParams(),
  };
  const fallback: TrackFallback = { title: UNKNOWN_TRACK_FIELD, artist: UNKNOWN_TRACK_FIELD };
  const attribution: LyricsDTO['attribution'] = {
    url: resolveOrigin(config.lrclibBase, 'https://lrclib.net'),
    license: 'community-sourced',
  };

  const record = await fetchLrclib(rung, fallback, config);
  // The caller named this record, so an empty result is a wrong id rather than
  // a song LRCLIB happens not to carry.
  if (record === null) {
    throw new Error(`LRCLIB has no record with id ${lrclibId}`);
  }

  return buildRemoteDto(fallback, record, attribution);
}

async function resolveBySongId(
  config: Config,
  client: NavidromeClient,
  songId: string,
  allowLrclib: boolean,
): Promise<LyricsDTO> {
  const row = await fetchSongRow(client, songId);
  if (row === null) {
    throw new Error(`Song ${songId} was not found in the library`);
  }

  const title = readRowText(row, 'title');
  const artist = readRowText(row, 'artist');
  const album = readRowText(row, 'album');
  const duration = row['duration'];
  const durationMs =
    typeof duration === 'number' && Number.isFinite(duration)
      ? Math.round(duration * 1000)
      : undefined;

  const metadata = {
    title: title !== '' ? title : UNKNOWN_TRACK_FIELD,
    artist: artist !== '' ? artist : UNKNOWN_TRACK_FIELD,
    ...(album !== '' ? { album } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };

  // An untagged title or artist matches nothing in LRCLIB, so the placeholders
  // above only ever reach the returned DTO, never a query.
  const searchable = allowLrclib && title !== '' && artist !== '';

  return await getLyrics(config, metadata, { client, songId, allowLrclib: searchable });
}

/**
 * Lyrics for one identified song or one identified LRCLIB record. The metadata
 * search that `getLyrics` performs is reached through `searchLyricsCandidates`.
 */
export async function getLyricsByIdentity(
  config: Config,
  client: NavidromeClient,
  args: unknown,
): Promise<LyricsDTO> {
  // INPUT
  const params = GetLyricsIdentitySchema.parse(args);
  const allowLrclib = config.features.lyrics;

  logger.debug('Tool getLyricsByIdentity called with args:', params);

  try {
    // PROCESS + OUTPUT
    if (params.songId !== undefined) {
      return await resolveBySongId(config, client, params.songId, allowLrclib);
    }

    if (params.lrclibId !== undefined) {
      if (!allowLrclib) {
        throw new Error(ErrorFormatter.configMissing('LRCLIB lyrics', 'features.lyricsProvider'));
      }
      return await resolveByLrclibId(config, params.lrclibId);
    }

    throw new Error(
      'Either songId (a Navidrome song ID) or lrclibId (an LRCLIB record ID) is required',
    );
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_lyrics', error));
  }
}

// ---------------------------------------------------------------------------
// Candidate search (search_lyrics)
// ---------------------------------------------------------------------------

function toCandidate(result: LRCLIBResponse): LyricsCandidateDTO | null {
  // A record with no id cannot be fetched back by get_lyrics, so offering it
  // would be a dead end.
  if (typeof result.id !== 'number' || !Number.isFinite(result.id)) return null;

  const durationMs =
    typeof result.duration === 'number' && Number.isFinite(result.duration)
      ? Math.round(result.duration * 1000)
      : undefined;

  return {
    lrclibId: String(result.id),
    trackName: hasText(result.trackName) ? result.trackName : UNKNOWN_TRACK_FIELD,
    artistName: hasText(result.artistName) ? result.artistName : UNKNOWN_TRACK_FIELD,
    ...(hasText(result.albumName) ? { albumName: result.albumName } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    hasSynced: hasText(result.syncedLyrics),
  };
}

function toCandidates(body: unknown, wanted: TrackFallback): LyricsCandidateDTO[] {
  if (!Array.isArray(body)) return [];

  const ranked: { candidate: LyricsCandidateDTO; score: number }[] = [];
  for (const row of body as readonly unknown[]) {
    if (row === null || typeof row !== 'object') continue;

    const result = row as LRCLIBResponse;
    const candidate = toCandidate(result);
    if (candidate === null) continue;

    ranked.push({ candidate, score: scoreSearchResult(result, wanted) });
  }

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, MAX_LYRICS_CANDIDATES).map((entry) => entry.candidate);
}

function matchesLoosely(value: string, wanted: string): boolean {
  const left = value.trim().toLowerCase();
  const right = wanted.trim().toLowerCase();
  if (left === '' || right === '') return false;

  return left === right || left.includes(right) || right.includes(left);
}

async function findLibrarySong(
  client: NavidromeClient,
  config: Config,
  wanted: TrackFallback,
): Promise<NonNullable<LyricsSearchDTO['librarySong']> | null> {
  try {
    const { songs } = await searchSongs(client, config, {
      query: wanted.title,
      limit: LIBRARY_MATCH_LIMIT,
    });

    for (const song of songs) {
      if (!matchesLoosely(song.title, wanted.title)) continue;
      if (!matchesLoosely(song.artist, wanted.artist)) continue;

      return {
        songId: song.id,
        ...(song.lyrics !== undefined ? { lyrics: song.lyrics } : {}),
      };
    }

    return null;
  } catch (error) {
    // The library match rides along with the LRCLIB answer, so a failed search
    // must not sink the whole lookup.
    logger.warn(
      'searchLyricsCandidates: library lookup failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Search LRCLIB by track metadata and report the matching library song beside
 * the candidates, so choosing a source costs one call rather than two.
 */
export async function searchLyricsCandidates(
  config: Config,
  client: NavidromeClient,
  args: unknown,
): Promise<LyricsSearchDTO> {
  // INPUT
  const params = SearchLyricsSchema.parse(args);
  const query = new URLSearchParams();
  query.set('track_name', params.title);
  query.set('artist_name', params.artist);
  const rung: LrclibRung = { kind: 'search', path: SEARCH_PATH, query };

  logger.debug('Tool searchLyricsCandidates called with args:', params);

  try {
    // PROCESS
    const [body, librarySong] = await Promise.all([
      fetchLrclibBody(rung, config),
      findLibrarySong(client, config, params),
    ]);

    // OUTPUT
    return {
      candidates: toCandidates(body, params),
      ...(librarySong !== null ? { librarySong } : {}),
    };
  } catch (error) {
    // Transport errors (5xx, 429, network failures) are re-thrown with context so
    // callers can distinguish config/network problems from "nothing matched".
    logger.warn(
      'searchLyricsCandidates: LRCLIB search failed (transport/config error):',
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(ErrorFormatter.toolExecution('search_lyrics', error));
  }
}
