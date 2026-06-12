/**
 * Navidrome MCP Server - MusicBrainz Web Service v2 client
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

/**
 * Minimal MusicBrainz client for the discography surface (get_artist_albums,
 * get_album_info): artist search/lookup, release-group search/lookup/browse,
 * and release-browse tracklists. Two operational rules from
 * https://musicbrainz.org/doc/MusicBrainz_API are enforced here so call sites
 * cannot get them wrong:
 *
 *   - ≤ 1 request/second: every call is serialized through a module-level
 *     queue that spaces dispatches by MIN_INTERVAL_MS, across concurrent tool
 *     invocations. Exceeding the limit gets the client IP blocked.
 *   - Meaningful User-Agent: required; generic agents may be blocked.
 */

import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from './error-formatter.js';
import { normTitle } from './normalize-title.js';
import { DEFAULT_MUSICBRAINZ_USER_AGENT } from '../constants/defaults.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from './fetch-with-timeout.js';

const MB_API_BASE = 'https://musicbrainz.org/ws/2';

// 1 req/s plus margin so clock jitter can't put two requests in one second.
const MIN_INTERVAL_MS = 1100;

// Browse paging: 100 is the MB max page size; 10 pages = 1000 release groups,
// far beyond any real single-artist discography at type=album|ep.
const BROWSE_PAGE_SIZE = 100;
const BROWSE_MAX_PAGES = 10;

// Accept index-0 fuzzy search hits only at/above this MB relevance score
// (0-100). Verified live: exact matches score 100; same-name different-artist
// decoys score ≤ 89. Applies to both artist and release-group searches.
const SEARCH_MIN_SCORE = 85;

// --- Throttle: module-level promise-chain queue --------------------------

let queueTail: Promise<void> = Promise.resolve();
let lastDispatchAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = lastDispatchAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    lastDispatchAt = Date.now();
    return task();
  });
  // The next task waits for this one to settle; swallow rejections so one
  // failed request never poisons the chain for subsequent callers.
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Test-only: reset throttle state so fake-timer tests start cold. */
export function resetMusicBrainzThrottleForTests(): void {
  queueTail = Promise.resolve();
  lastDispatchAt = 0;
}

// --- Fetch ----------------------------------------------------------------

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

  return throttled(async () => {
    logger.debug(`Calling MusicBrainz API: ${path}`, params);

    // Reads only — safe to retry on timeout. fetchWithTimeout retries solely
    // on AbortError (never on HTTP 503), so MB rate-limit responses are not
    // hammered, and a timeout-retry is already spaced past MIN_INTERVAL_MS by
    // the elapsed timeout itself.
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
        retryPolicy: 'safe',
        operationLabel: `MusicBrainz ${path}`,
      },
    );

    if (!response.ok) {
      throw new Error(ErrorFormatter.httpRequest(`MusicBrainz ${path}`, response));
    }

    return await response.json() as Record<string, unknown>;
  });
}

// --- Narrowing helpers (codebase style: hand-rolled, zod is for inputs) ---

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

/** Lucene phrase query value; escapes embedded quotes/backslashes. */
function luceneQuote(s: string): string {
  return `"${s.replace(/[\\"]/g, '\\$&')}"`;
}

// --- Artist resolution -----------------------------------------------------

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
  return { mbid, name, score, disambiguation: asString(row['disambiguation']) };
}

/**
 * Resolve an artist name to a MusicBrainz artist. Picks, in score order:
 * the first case-insensitive exact name match, else the top hit when its
 * relevance score clears ARTIST_SEARCH_MIN_SCORE, else `null` (the caller
 * degrades rather than guessing at a wrong artist's discography).
 */
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
 * Look up an artist by MBID — used when the caller supplies only an MBID, to
 * recover the canonical name for the Last.fm and Navidrome branches (Last.fm's
 * own mbid= lookup is unreliable: stale index, verified live).
 */
export async function lookupMbArtist(mbid: string, config: Config): Promise<MbArtistMatch | null> {
  const data = await mbFetch(`/artist/${encodeURIComponent(mbid)}`, {}, config);
  return parseArtistRow(data, 100);
}

// --- Release-group browse ---------------------------------------------------

export interface MbReleaseGroup {
  mbid: string;
  title: string;
  /** First release year, or null when MB has no date. */
  year: number | null;
  /** e.g. "Album", "EP", "Single" — capitalization as MB returns it. */
  primaryType: string | null;
  /** Lowercased (MB returns "Remix"/"Live"; the exclude filter compares lowercase). */
  secondaryTypes: string[];
  /** Genre names, lowercased, highest vote-count first; [] when MB has none. */
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
    // Lowercase so `genres` is uniform with the Last.fm tag fallback — MB does
    // not guarantee casing on genre submissions.
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
    disambiguation: asString(row['disambiguation']),
  };
}

/**
 * Browse all release groups for an artist, filtered server-side by primary
 * type(s), with per-group genres riding the same request (`inc=genres` —
 * this is what makes per-album Last.fm getInfo calls unnecessary).
 */
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

    // Advance by rows actually returned (per MB paging guidance); an empty
    // page means the server has nothing more regardless of the claimed total.
    offset += rows.length;
    if (rows.length === 0 || offset >= total) break;
  }

  logger.debug(`MusicBrainz browse: ${groups.length} release groups for ${artistMbid}`);
  return groups;
}

// --- Release-group detail (get_album_info) -----------------------------------

export interface MbReleaseGroupDetail {
  mbid: string;
  title: string;
  /** First credited artist name; null when MB returns no artist-credit. */
  artistName: string | null;
  year: number | null;
  primaryType: string | null;
  /** Lowercased. Search results may omit secondary types entirely ⇒ []. */
  secondaryTypes: string[];
  /** Genre names, highest vote-count first. Search results carry none ⇒ []. */
  genres: string[];
  disambiguation: string | null;
}

function parseReleaseGroupDetail(raw: unknown): MbReleaseGroupDetail | null {
  const base = parseReleaseGroup(raw);
  if (base === null) return null;

  const credits = asArray(asRecord(raw)['artist-credit']);
  const artistName = credits.length > 0 ? asString(asRecord(credits[0])['name']) : null;

  return { ...base, artistName };
}

/**
 * Look up a release group by MBID with genres and artist credits — used when
 * get_album_info receives an mbid (as emitted by get_artist_albums) and must
 * recover the canonical title/artist for the Last.fm and Navidrome branches.
 */
export async function lookupMbReleaseGroup(
  mbid: string,
  config: Config,
): Promise<MbReleaseGroupDetail | null> {
  // URLSearchParams serializes the space as '+', MB's inc separator.
  const data = await mbFetch(
    `/release-group/${encodeURIComponent(mbid)}`,
    { inc: 'genres artist-credits' },
    config,
  );
  return parseReleaseGroupDetail(data);
}

/**
 * Resolve artist + album names to a release group. Picks the first hit whose
 * normalized title matches, else the top hit at/above SEARCH_MIN_SCORE, else
 * null. Note: search hits carry year/types/artist-credit but never genres.
 */
export async function searchMbReleaseGroup(
  artistName: string,
  albumTitle: string,
  config: Config,
): Promise<MbReleaseGroupDetail | null> {
  const data = await mbFetch('/release-group', {
    query: `releasegroup:${luceneQuote(albumTitle)} AND artist:${luceneQuote(artistName)}`,
    limit: '5',
  }, config);

  const candidates: Array<{ detail: MbReleaseGroupDetail; score: number }> = [];
  for (const raw of asArray(data['release-groups'])) {
    const detail = parseReleaseGroupDetail(raw);
    if (detail === null) continue;
    const scoreValue = asRecord(raw)['score'];
    candidates.push({ detail, score: typeof scoreValue === 'number' ? scoreValue : 0 });
  }

  const targetTitle = normTitle(albumTitle);
  const exact = candidates.find(c => normTitle(c.detail.title) === targetTitle);
  const top = candidates[0];
  const picked = exact ?? (top !== undefined && top.score >= SEARCH_MIN_SCORE ? top : null);

  if (picked === null) {
    logger.debug(`MusicBrainz release-group search found no acceptable match for "${artistName}" — "${albumTitle}"`);
    return null;
  }
  logger.debug(`MusicBrainz resolved "${albumTitle}" → ${picked.detail.mbid} (score ${picked.score})`);
  return picked.detail;
}

// --- Release-browse tracklist -------------------------------------------------

export interface MbTrack {
  /** Sequential across all media (1-based), so multi-disc albums read linearly. */
  position: number;
  title: string;
  durationSeconds: number | null;
}

export interface MbTracklist {
  /** The release whose tracklist was chosen (Official preferred, then earliest). */
  releaseMbid: string;
  status: string | null;
  date: string | null;
  country: string | null;
  tracks: MbTrack[];
}

interface ParsedRelease {
  mbid: string;
  status: string | null;
  date: string | null;
  country: string | null;
  tracks: MbTrack[];
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
 * Fetch the tracklist for a release group by browsing its releases with
 * recordings + media riding the same request (verified live: `inc=recordings`
 * works on a browse). MB is the PRIMARY tracklist source — Last.fm durations
 * are mostly null and its titles carry feat-suffix noise (spec §9.1).
 * Returns null when the release group has no usable release.
 */
export async function browseMbReleaseTracklist(
  releaseGroupMbid: string,
  config: Config,
): Promise<MbTracklist | null> {
  const data = await mbFetch('/release', {
    'release-group': releaseGroupMbid,
    inc: 'recordings media',
    limit: '100',
  }, config);

  const releases: ParsedRelease[] = [];
  for (const raw of asArray(data['releases'])) {
    const row = asRecord(raw);
    const mbid = asString(row['id']);
    if (mbid === null) continue;
    const tracks = parseReleaseTracks(row);
    if (tracks.length === 0) continue;
    releases.push({
      mbid,
      status: asString(row['status']),
      date: asString(row['date']),
      country: asString(row['country']),
      tracks,
    });
  }
  if (releases.length === 0) {
    logger.debug(`MusicBrainz release browse: no usable tracklist for ${releaseGroupMbid}`);
    return null;
  }

  // Prefer Official releases; within the pool, earliest date wins (the
  // canonical original, matching first-release-date semantics). Partial dates
  // ("2023") sort before full ones lexicographically — acceptable. Undated last.
  const officials = releases.filter(r => r.status === 'Official');
  const pool = officials.length > 0 ? officials : releases;
  pool.sort((a, b) => {
    if (a.date === null) return b.date === null ? 0 : 1;
    if (b.date === null) return -1;
    return a.date.localeCompare(b.date);
  });

  const chosen = pool[0];
  if (chosen === undefined) return null;

  logger.debug(
    `MusicBrainz tracklist for ${releaseGroupMbid}: release ${chosen.mbid} ` +
    `(${chosen.status ?? 'no status'}, ${chosen.date ?? 'undated'}), ${chosen.tracks.length} tracks`,
  );
  return {
    releaseMbid: chosen.mbid,
    status: chosen.status,
    date: chosen.date,
    country: chosen.country,
    tracks: chosen.tracks,
  };
}
