/**
 * Navidrome MCP Server - MusicBrainz Web Service v2 client
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * MusicBrainz blocks a client that exceeds 1 request per second or sends a generic User-Agent, so
 * every call goes through one module-level throttle with a descriptive User-Agent.
 */

import type { Config } from '../config.js';
import { logger } from './logger.js';
import { ErrorFormatter } from './error-formatter.js';
import { normTitle } from './normalize-title.js';
import { DEFAULT_MUSICBRAINZ_USER_AGENT } from '../constants/defaults.js';
import {
  FetchTimeoutError,
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from './fetch-with-timeout.js';

const MB_API_BASE = 'https://musicbrainz.org/ws/2';

// 1 req/s plus margin so clock jitter can't put two requests in one second.
const MIN_INTERVAL_MS = 1100;

// 100 is the MB maximum page size. Ten pages hold 1000 release groups, more than any real
// single-artist album and EP discography.
const BROWSE_PAGE_SIZE = 100;
const BROWSE_MAX_PAGES = 10;

// MB relevance runs 0 to 100. Exact matches scored 100, and same-name decoys by other artists
// scored at most 89.
const SEARCH_MIN_SCORE = 85;

// A popular group's light release browse stops at 300 releases, bounding the throttled requests.
const TRACKLIST_LIGHT_MAX_PAGES = 3;

let queueTail: Promise<void> = Promise.resolve();
let lastDispatchAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    // A backward wall-clock step must not stall the queue past one interval.
    const wait = Math.min(MIN_INTERVAL_MS, lastDispatchAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    lastDispatchAt = Date.now();
    return task();
  });
  // Rejections are swallowed so one failed request does not reject every later task in the chain.
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resetMusicBrainzThrottleForTests(): void {
  queueTail = Promise.resolve();
  lastDispatchAt = 0;
}

// MB answers an unknown MBID with 404, which lookups report as "not found", not "unreachable".
class MbNotFoundError extends Error {}

async function mbFetch(
  path: string,
  params: Record<string, string>,
  config: Config,
): Promise<Record<string, unknown>> {
  const url = new URL(`${MB_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });
  url.searchParams.append('fmt', 'json');

  const userAgent = config.musicBrainzUserAgent ?? DEFAULT_MUSICBRAINZ_USER_AGENT;

  const attempt = (): Promise<Record<string, unknown>> => throttled(async () => {
    logger.debug(`Calling MusicBrainz API: ${path}`, params);

    const response = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json',
        },
      },
      {
        timeoutMs: getExternalApiTimeoutMs(),
        retryPolicy: 'never',
        operationLabel: `MusicBrainz ${path}`,
        respectProxy: true,
      },
    );

    if (response.status === 404) {
      throw new MbNotFoundError(ErrorFormatter.httpRequest(`MusicBrainz ${path}`, response));
    }
    if (!response.ok) {
      throw new Error(ErrorFormatter.httpRequest(`MusicBrainz ${path}`, response));
    }

    return await response.json() as Record<string, unknown>;
  });

  // Reads are safe to retry on timeout, and the retry goes through the throttle so
  // every request MB sees is spaced by MIN_INTERVAL_MS.
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof FetchTimeoutError)) throw error;
    return await attempt();
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// MB sends a missing date, country or disambiguation as "", which must not sort or read as a value.
function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

/** MB parses a search query as Lucene, so a quote or backslash is escaped to keep one phrase. */
function luceneQuote(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`;
}

export interface MbArtistMatch {
  mbid: string;
  name: string;
  score: number;
  disambiguation: string | null;
}

function parseArtistRow(row: Record<string, unknown>, score: number): MbArtistMatch | null {
  const mbid = asString(row['id']);
  const name = asString(row['name']);
  if (mbid === null || name === null) return null;
  return { mbid, name, score, disambiguation: asNonEmptyString(row['disambiguation']) };
}

/** A low-score guess returns null, so the caller degrades instead of using a wrong artist. */
export async function searchMbArtist(name: string, config: Config): Promise<MbArtistMatch | null> {
  const data = await mbFetch('/artist', { query: `artist:${luceneQuote(name)}`, limit: '5' }, config);

  const candidates: MbArtistMatch[] = [];
  for (const raw of asArray(data['artists'])) {
    const row = asRecord(raw);
    const score = typeof row['score'] === 'number' ? row['score'] : 0;
    const match = parseArtistRow(row, score);
    if (match !== null) candidates.push(match);
  }

  const lowered = name.toLowerCase();
  const picked =
    candidates.find(c => c.name.toLowerCase() === lowered) ??
    (candidates.length > 0 && candidates[0] !== undefined && candidates[0].score >= SEARCH_MIN_SCORE
      ? candidates[0]
      : null);

  if (picked === null) {
    logger.debug(`MusicBrainz artist search found no acceptable match for "${name}"`);
  } else {
    logger.debug(`MusicBrainz resolved "${name}" → ${picked.mbid} (score ${picked.score})`);
  }
  return picked;
}

/**
 * The canonical name feeds the Last.fm and Navidrome lookups, since Last.fm's own mbid lookup
 * misses on a stale index.
 */
export async function lookupMbArtist(mbid: string, config: Config): Promise<MbArtistMatch | null> {
  try {
    const data = await mbFetch(`/artist/${encodeURIComponent(mbid)}`, {}, config);
    return parseArtistRow(data, 100);
  } catch (error) {
    if (error instanceof MbNotFoundError) return null;
    throw error;
  }
}

export interface MbReleaseGroup {
  mbid: string;
  title: string;
  /** First release year. */
  year: number | null;
  /** Capitalized as MB returns it, such as "Album". */
  primaryType: string | null;
  /** Lowercased. MB returns "Remix" and "Live", and the exclude filter compares lowercase. */
  secondaryTypes: string[];
  /** Highest vote count first. */
  genres: string[];
  disambiguation: string | null;
}

function parseReleaseGroup(raw: unknown): MbReleaseGroup | null {
  const row = asRecord(raw);
  const mbid = asString(row['id']);
  const title = asString(row['title']);
  if (mbid === null || title === null) return null;

  const date = asString(row['first-release-date']) ?? '';
  const yearNum = Number.parseInt(date.slice(0, 4), 10);

  const genres = asArray(row['genres'])
    .map(g => asRecord(g))
    .map(g => ({
      name: asString(g['name']),
      count: typeof g['count'] === 'number' ? g['count'] : 0,
    }))
    .filter((g): g is { name: string; count: number } => g.name !== null)
    .sort((a, b) => b.count - a.count)
    // MB does not guarantee genre casing, and lowercase matches the Last.fm tag fallback.
    .map(g => g.name.toLowerCase());

  return {
    mbid,
    title,
    year: Number.isFinite(yearNum) ? yearNum : null,
    primaryType: asString(row['primary-type']),
    secondaryTypes: asArray(row['secondary-types'])
      .map(t => asString(t))
      .filter((t): t is string => t !== null)
      .map(t => t.toLowerCase()),
    genres,
    disambiguation: asNonEmptyString(row['disambiguation']),
  };
}

/** `inc=genres` returns genres in the browse, so no per-album Last.fm getInfo call is needed. */
export async function browseMbReleaseGroups(
  artistMbid: string,
  includeTypes: string[],
  config: Config,
): Promise<MbReleaseGroup[]> {
  const groups: MbReleaseGroup[] = [];
  let offset = 0;

  for (let page = 0; page < BROWSE_MAX_PAGES; page++) {
    const data = await mbFetch('/release-group', {
      artist: artistMbid,
      type: includeTypes.join('|'),
      inc: 'genres',
      limit: String(BROWSE_PAGE_SIZE),
      offset: String(offset),
    }, config);

    const rows = asArray(data['release-groups']);
    for (const raw of rows) {
      const parsed = parseReleaseGroup(raw);
      if (parsed !== null) groups.push(parsed);
    }

    const total = typeof data['release-group-count'] === 'number'
      ? data['release-group-count']
      : groups.length;

    // MB paging guidance says to advance by the rows returned. An empty page ends the browse
    // whatever the claimed total.
    offset += rows.length;
    if (rows.length === 0 || offset >= total) break;
  }

  logger.debug(`MusicBrainz browse: ${groups.length} release groups for ${artistMbid}`);
  return groups;
}

/** Search hits carry no genres and may omit secondary types, so both can be []. */
export interface MbReleaseGroupDetail extends MbReleaseGroup {
  /** First credited artist. */
  artistName: string | null;
}

function parseReleaseGroupDetail(raw: unknown): MbReleaseGroupDetail | null {
  const base = parseReleaseGroup(raw);
  if (base === null) return null;

  const credits = asArray(asRecord(raw)['artist-credit']);
  const artistName = credits.length > 0 ? asString(asRecord(credits[0])['name']) : null;

  return { ...base, artistName };
}

/** The canonical title and artist from an mbid feed the Last.fm and Navidrome lookups. */
export async function lookupMbReleaseGroup(
  mbid: string,
  config: Config,
): Promise<MbReleaseGroupDetail | null> {
  try {
    // URLSearchParams serializes the space as '+', MB's inc separator.
    const data = await mbFetch(
      `/release-group/${encodeURIComponent(mbid)}`,
      { inc: 'genres artist-credits' },
      config,
    );
    return parseReleaseGroupDetail(data);
  } catch (error) {
    if (error instanceof MbNotFoundError) return null;
    throw error;
  }
}

function primaryTypeRank(primaryType: string | null): number {
  if (primaryType === 'Album') return 0;
  if (primaryType === 'EP') return 1;
  return 2;
}

// An album named after its title track shares that title with its Single, so type breaks the tie.
function outranksReleaseGroup(candidate: MbReleaseGroupDetail, current: MbReleaseGroupDetail): boolean {
  const typeDelta = primaryTypeRank(candidate.primaryType) - primaryTypeRank(current.primaryType);
  if (typeDelta !== 0) return typeDelta < 0;
  return candidate.secondaryTypes.length < current.secondaryTypes.length;
}

export async function searchMbReleaseGroup(
  artistName: string,
  albumTitle: string,
  config: Config,
): Promise<MbReleaseGroupDetail | null> {
  const data = await mbFetch('/release-group', {
    query: `releasegroup:${luceneQuote(albumTitle)} AND artist:${luceneQuote(artistName)}`,
    limit: '25',
  }, config);

  const candidates: Array<{ detail: MbReleaseGroupDetail; score: number }> = [];
  for (const raw of asArray(data['release-groups'])) {
    const detail = parseReleaseGroupDetail(raw);
    if (detail === null) continue;
    const scoreValue = asRecord(raw)['score'];
    candidates.push({ detail, score: typeof scoreValue === 'number' ? scoreValue : 0 });
  }

  const targetTitle = normTitle(albumTitle);
  let exact: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (normTitle(candidate.detail.title) !== targetTitle) continue;
    if (exact === undefined || outranksReleaseGroup(candidate.detail, exact.detail)) exact = candidate;
  }
  const top = candidates[0];
  const picked = exact ?? (top !== undefined && top.score >= SEARCH_MIN_SCORE ? top : null);

  if (picked === null) {
    logger.debug(`MusicBrainz release-group search found no acceptable match for "${artistName}": "${albumTitle}"`);
    return null;
  }
  logger.debug(`MusicBrainz resolved "${albumTitle}" → ${picked.detail.mbid} (score ${picked.score})`);
  return picked.detail;
}

export interface MbTrack {
  /** Sequential across all media (1-based), so multi-disc albums read linearly. */
  position: number;
  title: string;
  durationSeconds: number | null;
}

export interface MbTracklist {
  releaseMbid: string;
  status: string | null;
  date: string | null;
  country: string | null;
  tracks: MbTrack[];
}

type MbReleaseSummary = Omit<MbTracklist, 'tracks'>;

function parseReleaseSummary(row: Record<string, unknown>): MbReleaseSummary | null {
  const releaseMbid = asString(row['id']);
  if (releaseMbid === null) return null;
  return {
    releaseMbid,
    status: asString(row['status']),
    date: asNonEmptyString(row['date']),
    country: asNonEmptyString(row['country']),
  };
}

function parseReleaseTracks(row: Record<string, unknown>): MbTrack[] {
  const media = asArray(row['media'])
    .map(m => asRecord(m))
    .sort((a, b) => (typeof a['position'] === 'number' ? a['position'] : 0) - (typeof b['position'] === 'number' ? b['position'] : 0));

  const tracks: MbTrack[] = [];
  for (const medium of media) {
    const mediumTracks = asArray(medium['tracks'])
      .map(t => asRecord(t))
      .sort((a, b) => (typeof a['position'] === 'number' ? a['position'] : 0) - (typeof b['position'] === 'number' ? b['position'] : 0));
    for (const track of mediumTracks) {
      const title = asString(track['title']);
      if (title === null) continue;
      const lengthMs = typeof track['length'] === 'number' ? track['length'] : null;
      tracks.push({
        position: tracks.length + 1,
        title,
        durationSeconds: lengthMs !== null ? Math.round(lengthMs / 1000) : null,
      });
    }
  }
  return tracks;
}

/**
 * The earliest Official release best matches the group's first-release-date. A partial date such as
 * "2023" sorts before the full dates of that year.
 */
function pickPreferredRelease<T extends MbReleaseSummary>(releases: T[]): T | null {
  const officials = releases.filter(r => r.status === 'Official');
  const pool = officials.length > 0 ? officials : [...releases];
  pool.sort((a, b) => {
    if (a.date === null) return b.date === null ? 0 : 1;
    if (b.date === null) return -1;
    return a.date.localeCompare(b.date);
  });
  return pool[0] ?? null;
}

/**
 * A browse without recordings avoids the track cap of a recordings browse. Tracks are then fetched
 * for the chosen release only.
 */
async function lookupPreferredRelease(releaseGroupMbid: string, config: Config): Promise<MbTracklist | null> {
  const summaries: MbReleaseSummary[] = [];
  let offset = 0;

  for (let page = 0; page < TRACKLIST_LIGHT_MAX_PAGES; page++) {
    const data = await mbFetch('/release', {
      'release-group': releaseGroupMbid,
      limit: String(BROWSE_PAGE_SIZE),
      offset: String(offset),
    }, config);

    const rows = asArray(data['releases']);
    for (const raw of rows) {
      const summary = parseReleaseSummary(asRecord(raw));
      if (summary !== null) summaries.push(summary);
    }

    const total = typeof data['release-count'] === 'number' ? data['release-count'] : summaries.length;
    offset += rows.length;
    if (rows.length === 0 || offset >= total) break;
  }

  const preferred = pickPreferredRelease(summaries);
  if (preferred === null) return null;

  const release = await mbFetch(
    `/release/${encodeURIComponent(preferred.releaseMbid)}`,
    { inc: 'recordings media' },
    config,
  );
  const tracks = parseReleaseTracks(release);
  return tracks.length > 0 ? { ...preferred, tracks } : null;
}

/**
 * MB is the primary tracklist source, since Last.fm durations are mostly null and its titles carry
 * feat suffixes (docs/ARTIST-ALBUMS-SPEC.md §9.1).
 */
export async function browseMbReleaseTracklist(
  releaseGroupMbid: string,
  config: Config,
): Promise<MbTracklist | null> {
  const data = await mbFetch('/release', {
    'release-group': releaseGroupMbid,
    inc: 'recordings media',
    limit: String(BROWSE_PAGE_SIZE),
  }, config);

  const rows = asArray(data['releases']);
  const releaseCount = typeof data['release-count'] === 'number' ? data['release-count'] : rows.length;
  const firstPage: MbTracklist[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const summary = parseReleaseSummary(row);
    if (summary === null) continue;
    const tracks = parseReleaseTracks(row);
    if (tracks.length === 0) continue;
    firstPage.push({ ...summary, tracks });
  }
  const firstPageChoice = pickPreferredRelease(firstPage);

  // MB caps a recordings browse near 500 tracks, so a popular group's first page is an arbitrary
  // subset.
  const chosen = releaseCount > rows.length
    ? (await lookupPreferredRelease(releaseGroupMbid, config)) ?? firstPageChoice
    : firstPageChoice;

  if (chosen === null) {
    logger.debug(`MusicBrainz release browse: no usable tracklist for ${releaseGroupMbid}`);
    return null;
  }

  logger.debug(
    `MusicBrainz tracklist for ${releaseGroupMbid}: release ${chosen.releaseMbid} ` +
    `(${chosen.status ?? 'no status'}, ${chosen.date ?? 'undated'}), ${chosen.tracks.length} tracks`,
  );
  return chosen;
}
