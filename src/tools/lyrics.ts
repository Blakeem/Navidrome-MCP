/**
 * Navidrome MCP Server - Lyrics Tools
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
import { DEFAULT_LRCLIB_BASE, DEFAULT_USER_AGENT } from '../constants/defaults.js';
import {
  LyricsIdentitySchema,
  LyricsMetadataSchema,
} from '../schemas/index.js';
import {
  buildTimedLines,
  parseLocalLyrics,
  type LocalLyricsResult,
  type TimedMarker,
} from '../transformers/lyrics-tag.js';
import { normTitle } from '../utils/normalize-title.js';
import { searchSongs } from './search/index.js';

type LyricsMetadataParams = z.infer<typeof LyricsMetadataSchema>;

/** Both settings gate LRCLIB, so a missing-config error names both. */
export const LRCLIB_CONFIG_KEYS = 'features.lyricsProvider and features.lrclibUserAgent';

/** LRCLIB search answers with dozens of rows, so the candidate list is capped to bound context. */
const MAX_LYRICS_CANDIDATES = 10;

const LIBRARY_MATCH_LIMIT = 20;

const UNKNOWN_TRACK_FIELD = 'Unknown';

// Navidrome fills untagged fields with these, and LRCLIB holds junk records under the same names.
const NAVIDROME_UNKNOWN_ARTIST = '[Unknown Artist]';
const NAVIDROME_UNKNOWN_ALBUM = '[Unknown Album]';

const GET_PATH = '/api/get';
const SEARCH_PATH = '/api/search';

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

interface LrclibRung {
  readonly kind: 'get' | 'search';
  readonly path: string;
  readonly query: URLSearchParams;
}

/** Track fields used to fill a DTO where an LRCLIB record omits its own. */
interface TrackFallback {
  readonly title: string;
  readonly artist: string;
  readonly album?: string | undefined;
  readonly durationMs?: number | undefined;
}

type LocalLyricsSource =
  | { readonly client: NavidromeClient; readonly songId: string }
  | { readonly lyrics: LocalLyricsResult | null };

/** Omitting the options gives LRCLIB-only resolution. */
interface ResolveLyricsOptions {
  readonly local?: LocalLyricsSource;
  readonly allowLrclib?: boolean;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseSyncedLyrics(lrcText: string, durationMs?: number): LyricsLine[] {
  const markers: TimedMarker[] = [];
  // The regex is anchored because an LRC line may group several timestamps for a repeated
  // section, such as `[01:02.34][01:15.67]lyric`.
  const tagRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const rawLine of lrcText.split('\n')) {
    // Community LRC text may lead with a space, `\r`, BOM, or indentation, which would make the
    // anchored regex miss the tag and drop the line.
    let rest = rawLine.trimStart();
    const timestamps: number[] = [];

    let tag = tagRegex.exec(rest);
    while (tag !== null) {
      const [, minutesStr = '', secondsStr = '', fractionStr = ''] = tag;

      const minutes = parseInt(minutesStr, 10);
      const seconds = parseInt(secondsStr, 10);
      const fraction = parseInt(fractionStr, 10);
      // 3-digit groups are milliseconds. 2-digit groups are centiseconds (×10).
      const fractionMs = fractionStr.length === 3 ? fraction : fraction * 10;
      timestamps.push((minutes * 60 + seconds) * 1000 + fractionMs);

      // Whitespace between grouped tags, such as `[..] [..]lyric`, would otherwise end the loop
      // and leak the next tag into the text.
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

async function readLocalLyrics(source: LocalLyricsSource, durationMs?: number): Promise<LocalLyricsResult | null> {
  if ('lyrics' in source) return source.lyrics;

  try {
    return await fetchLocalLyrics(source.client, source.songId, durationMs);
  } catch (error) {
    // The file tag is one source among several, so an unreadable song row must not fail a lookup
    // that LRCLIB can still answer.
    logger.warn(
      'resolveLyricsByMetadata: local file lyrics unavailable, continuing with LRCLIB:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function buildGetQuery(
  params: LyricsMetadataParams,
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
 * Rungs run from the narrowest exact lookup to search. `dedupeRungs` drops identical rungs, so a
 * bare title and artist lookup costs one `/api/get` instead of three.
 */
function buildLrclibRungs(params: LyricsMetadataParams): LrclibRung[] {
  const rungs: LrclibRung[] = [];
  const album = params.album !== undefined && params.album !== '' ? params.album : undefined;
  const durationSec =
    params.durationMs !== undefined ? String(Math.round(params.durationMs / 1000)) : undefined;

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

/** Search queries carry no duration, so duration proximity ranks hits instead of filtering them. */
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

  if (hasText(wanted.album) && result.albumName?.toLowerCase() === wanted.album.toLowerCase()) {
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

/** A non-array LRCLIB body or a non-object row degrades to no match instead of throwing. */
function toSearchRows(body: unknown): LRCLIBResponse[] {
  if (!Array.isArray(body)) return [];

  return (body as readonly unknown[]).filter(
    (row): row is LRCLIBResponse => row !== null && typeof row === 'object',
  );
}

function pickBestSearchResult(body: unknown, wanted: TrackFallback): LRCLIBResponse | null {
  let bestMatch: LRCLIBResponse | null = null;
  let bestScore = -1;

  for (const result of toSearchRows(body)) {
    const score = scoreSearchResult(result, wanted);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

/**
 * LRCLIB answers 404 for a missing record. Every other non-ok status throws, so an outage or rate
 * limit never reads as no lyrics.
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
      respectProxy: true,
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

/** A plain hit does not stop the walk, since a later rung may hold synced lyrics. */
async function resolveFromLrclib(
  params: LyricsMetadataParams,
  config: Config,
): Promise<LRCLIBResponse | null> {
  const rungs = dedupeRungs(buildLrclibRungs(params));
  let bestPlain: LRCLIBResponse | null = null;

  for (const rung of rungs) {
    let hit: LRCLIBResponse | null;
    try {
      hit = await fetchLrclib(rung, params, config);
    } catch (error) {
      // A plain hit in hand outranks a failed rung. Later rungs are skipped, since a timeout or
      // 429 would repeat.
      if (bestPlain === null) throw error;
      logger.warn(
        'resolveFromLrclib: LRCLIB failed after a plain hit, keeping it:',
        error instanceof Error ? error.message : String(error),
      );
      return bestPlain;
    }
    if (hit === null) continue;
    if (hasText(hit.syncedLyrics)) return hit;
    if (bestPlain === null || (!hasText(bestPlain.plainLyrics) && hasText(hit.plainLyrics))) {
      bestPlain = hit;
    }
  }

  return bestPlain;
}

/**
 * Attribution names the queried host, which may be a self-hosted mirror. `origin` drops any
 * credentials embedded in the configured URL.
 */
function resolveOrigin(base: string, fallback: string): string {
  try {
    return new URL(base).origin;
  } catch {
    return fallback;
  }
}

function buildLrclibAttribution(config: Config): LyricsDTO['attribution'] {
  return { url: resolveOrigin(config.lrclibBase, DEFAULT_LRCLIB_BASE), license: 'community-sourced' };
}

/** A zero or missing duration is unknown, and must never reach an LRCLIB query or a DTO. */
function secondsToMs(seconds: unknown): number | undefined {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : undefined;
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
  const durationMs = secondsToMs(data.duration) ?? fallback.durationMs;
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

/** An empty answer credits LRCLIB only when LRCLIB was queried. */
function buildEmptyDto(
  fallback: TrackFallback,
  lrclibConsulted: boolean,
  lrclibAttribution: LyricsDTO['attribution'],
  localAttribution: LyricsDTO['attribution'],
): LyricsDTO {
  return {
    track: buildTrack(fallback),
    hasSynced: false,
    isInstrumental: false,
    provider: lrclibConsulted ? 'lrclib' : 'local',
    attribution: lrclibConsulted ? lrclibAttribution : localAttribution,
  };
}

/** Precedence: local synced, LRCLIB synced, local plain, LRCLIB plain. */
export async function resolveLyricsByMetadata(
  config: Config,
  args: unknown,
  opts?: ResolveLyricsOptions,
): Promise<LyricsDTO> {
  const params = LyricsMetadataSchema.parse(args);
  const localSource = opts?.local;
  const allowLrclib = opts?.allowLrclib ?? true;
  const lrclibAttribution = buildLrclibAttribution(config);
  const localAttribution: LyricsDTO['attribution'] = {
    url: resolveOrigin(config.navidromeUrl, 'https://www.navidrome.org'),
    license: 'embedded file metadata',
  };

  logger.debug('resolveLyricsByMetadata called with args:', params);

  try {
    const local = localSource !== undefined ? await readLocalLyrics(localSource, params.durationMs) : null;

    if (local?.hasSynced === true) {
      return buildLocalDto(params, local, localAttribution);
    }

    let remote: LRCLIBResponse | null = null;
    if (allowLrclib) {
      try {
        remote = await resolveFromLrclib(params, config);
      } catch (error) {
        // File lyrics in hand still answer when LRCLIB is down. Without them the LRCLIB error
        // propagates.
        if (local === null) throw error;
        logger.warn(
          'resolveLyricsByMetadata: LRCLIB failed, returning the file lyrics:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const remoteDto = remote !== null ? buildRemoteDto(params, remote, lrclibAttribution) : null;

    if (remoteDto?.hasSynced === true) return remoteDto;
    if (local !== null) return buildLocalDto(params, local, localAttribution);
    if (remoteDto !== null) return remoteDto;

    return buildEmptyDto(params, allowLrclib, lrclibAttribution, localAttribution);
  } catch (error) {
    logger.warn(
      'resolveLyricsByMetadata: lookup failed (transport/config error, not a missing track):',
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(ErrorFormatter.toolExecution('resolveLyricsByMetadata', error));
  }
}

async function resolveByLrclibId(config: Config, lrclibId: string): Promise<LyricsDTO> {
  const rung: LrclibRung = {
    kind: 'get',
    path: `${GET_PATH}/${encodeURIComponent(lrclibId)}`,
    query: new URLSearchParams(),
  };
  const fallback: TrackFallback = { title: UNKNOWN_TRACK_FIELD, artist: UNKNOWN_TRACK_FIELD };
  const attribution = buildLrclibAttribution(config);

  const record = await fetchLrclib(rung, fallback, config);
  // The caller named this record, so an empty result means a wrong id, not a missing song.
  if (record === null) {
    throw new Error(`LRCLIB has no record with id ${lrclibId}`);
  }

  return buildRemoteDto(fallback, record, attribution);
}

/** `duration` is in seconds, as in Navidrome song rows and play-queue entries. */
interface LyricsTrackFields {
  readonly title: string | undefined;
  readonly artist: string | undefined;
  readonly album: string | undefined;
  readonly duration: unknown;
}

interface LyricsLookup {
  readonly metadata: LyricsMetadataParams;
  readonly searchable: boolean;
}

function withoutPlaceholder(value: string | undefined, placeholder: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed.toLowerCase() === placeholder.toLowerCase() ? '' : trimmed;
}

/**
 * LyricsMetadataSchema rejects an empty title or artist, so placeholders fill the gaps. Callers
 * must AND `searchable` into allowLrclib, since a placeholder matches unrelated LRCLIB records.
 */
export function buildLyricsLookup(fields: LyricsTrackFields): LyricsLookup {
  const title = fields.title?.trim() ?? '';
  const artist = withoutPlaceholder(fields.artist, NAVIDROME_UNKNOWN_ARTIST);
  const album = withoutPlaceholder(fields.album, NAVIDROME_UNKNOWN_ALBUM);
  const durationMs = secondsToMs(fields.duration);

  const metadata: LyricsMetadataParams = {
    title: title !== '' ? title : UNKNOWN_TRACK_FIELD,
    artist: artist !== '' ? artist : UNKNOWN_TRACK_FIELD,
    ...(album !== '' ? { album } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
  return { metadata, searchable: title !== '' && artist !== '' };
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

  const lookup = buildLyricsLookup({
    title: readRowText(row, 'title'),
    artist: readRowText(row, 'artist'),
    album: readRowText(row, 'album'),
    duration: row['duration'],
  });

  // The row is already in hand, so the resolver parses its tag instead of fetching the row again.
  return await resolveLyricsByMetadata(config, lookup.metadata, {
    local: { lyrics: parseLocalLyrics(row['lyrics'], lookup.metadata.durationMs) },
    allowLrclib: allowLrclib && lookup.searchable,
  });
}

/** Timed lines already carry the full text, so the plain copy would only double the payload. */
function withoutDuplicateText(dto: LyricsDTO): LyricsDTO {
  if (!dto.hasSynced) return dto;

  const trimmed = { ...dto };
  delete trimmed.unsynced;
  return trimmed;
}

/** Metadata lookup is search_lyrics, whose candidates carry the lrclibId this resolver fetches. */
export async function getLyricsByIdentity(
  config: Config,
  client: NavidromeClient,
  args: unknown,
): Promise<LyricsDTO> {
  const params = LyricsIdentitySchema.parse(args);
  const allowLrclib = config.features.lyrics;

  logger.debug('Tool getLyricsByIdentity called with args:', params);

  try {
    if (params.songId !== undefined) {
      return withoutDuplicateText(await resolveBySongId(config, client, params.songId, allowLrclib));
    }

    if (params.lrclibId !== undefined) {
      if (!allowLrclib) {
        throw new Error(ErrorFormatter.configMissing('LRCLIB lyrics', LRCLIB_CONFIG_KEYS));
      }
      return withoutDuplicateText(await resolveByLrclibId(config, params.lrclibId));
    }

    throw new Error(
      'Either songId (a Navidrome song ID) or lrclibId (an LRCLIB record ID) is required',
    );
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_lyrics', error));
  }
}

function toCandidate(result: LRCLIBResponse): LyricsCandidateDTO | null {
  // get_lyrics fetches a candidate by id, so a record without one is unusable.
  if (typeof result.id !== 'number' || !Number.isFinite(result.id)) return null;

  const durationMs = secondsToMs(result.duration);

  return {
    lrclibId: String(result.id),
    trackName: hasText(result.trackName) ? result.trackName : UNKNOWN_TRACK_FIELD,
    artistName: hasText(result.artistName) ? result.artistName : UNKNOWN_TRACK_FIELD,
    ...(hasText(result.albumName) ? { albumName: result.albumName } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    hasSynced: hasText(result.syncedLyrics),
    isInstrumental: result.instrumental === true,
  };
}

function toCandidates(body: unknown, wanted: TrackFallback): LyricsCandidateDTO[] {
  const ranked: { candidate: LyricsCandidateDTO; score: number }[] = [];
  for (const result of toSearchRows(body)) {
    const candidate = toCandidate(result);
    if (candidate === null) continue;

    ranked.push({ candidate, score: scoreSearchResult(result, wanted) });
  }

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, MAX_LYRICS_CANDIDATES).map((entry) => entry.candidate);
}

/** Artist containment in either direction lets "feat." credits match. */
function matchesLibrarySong(song: { title: string; artist: string }, wanted: TrackFallback): boolean {
  const songArtist = normTitle(song.artist);
  const wantedArtist = normTitle(wanted.artist);
  if (normTitle(song.title) !== normTitle(wanted.title)) return false;
  if (songArtist === '' || wantedArtist === '') return false;

  return songArtist.includes(wantedArtist) || wantedArtist.includes(songArtist);
}

async function findLibrarySong(
  client: NavidromeClient,
  wanted: TrackFallback,
): Promise<NonNullable<LyricsSearchDTO['librarySong']> | null> {
  try {
    // Full-text search ANDs the terms, so the artist keeps a common title inside the scan window.
    const { songs } = await searchSongs(client, {
      query: `${wanted.title} ${wanted.artist}`,
      limit: LIBRARY_MATCH_LIMIT,
    });

    const wantedTitle = wanted.title.trim().toLowerCase();
    const matches = songs.filter((song) => matchesLibrarySong(song, wanted));
    // normTitle drops (Instrumental), (Remix), and version groups, so an exact title beats a
    // variant.
    const song = matches.find((match) => match.title.trim().toLowerCase() === wantedTitle) ?? matches[0];
    if (song === undefined) return null;

    return {
      songId: song.id,
      ...(song.lyrics !== undefined ? { lyrics: song.lyrics } : {}),
    };
  } catch (error) {
    // The library match is secondary to the LRCLIB candidates, so a failed search must not fail
    // the entire lookup.
    logger.warn(
      'searchLyricsCandidates: library lookup failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * The matching library song is reported beside the LRCLIB candidates, so choosing a source costs
 * one call instead of two.
 */
export async function searchLyricsCandidates(
  config: Config,
  client: NavidromeClient,
  args: unknown,
): Promise<LyricsSearchDTO> {
  const params = LyricsMetadataSchema.parse(args);
  const query = new URLSearchParams();
  query.set('track_name', params.title);
  query.set('artist_name', params.artist);
  const rung: LrclibRung = { kind: 'search', path: SEARCH_PATH, query };

  logger.debug('Tool searchLyricsCandidates called with args:', params);

  try {
    const [body, librarySong] = await Promise.all([
      fetchLrclibBody(rung, config),
      findLibrarySong(client, params),
    ]);

    return {
      candidates: toCandidates(body, params),
      ...(librarySong !== null ? { librarySong } : {}),
    };
  } catch (error) {
    logger.warn(
      'searchLyricsCandidates: LRCLIB search failed (transport/config error):',
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(ErrorFormatter.toolExecution('search_lyrics', error));
  }
}
