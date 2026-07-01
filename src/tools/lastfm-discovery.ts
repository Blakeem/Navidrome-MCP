/**
 * Navidrome MCP Server - Last.fm Music Discovery Tools
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

import { z } from 'zod';
import type { Config } from '../config.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { safeNumber } from '../utils/safe-number.js';
import { Cache } from '../utils/cache.js';
import { normTitle, isJunkAlbumName } from '../utils/normalize-title.js';
import {
  browseMbReleaseGroups,
  browseMbReleaseTracklist,
  lookupMbArtist,
  lookupMbReleaseGroup,
  searchMbArtist,
  searchMbReleaseGroup,
  type MbArtistMatch,
  type MbReleaseGroup,
  type MbReleaseGroupDetail,
  type MbTrack,
  type MbTracklist,
} from '../utils/musicbrainz.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from '../utils/fetch-with-timeout.js';
import {
  SimilarArtistsSchema,
  SimilarTracksSchema,
  ArtistInfoSchema,
  TopTracksByArtistSchema,
  TrendingMusicSchema,
  GetArtistAlbumsSchema,
  GetAlbumInfoSchema,
} from '../schemas/index.js';

interface LastFmArtist {
  name: string;
  match: number;
  url: string;
  mbid: string | null;
}

/**
 * Collapse a ZodError into a single concise, LLM-actionable sentence.
 *
 * The tool JSON Schemas advertise `required: []` (the real constraints are
 * conditional — artist OR mbid, etc.), so the LLM can legitimately call with
 * missing identifiers. Rather than forwarding Zod's raw issue-array message
 * (a noisy blob), surface the schema's own issue messages when present, or the
 * caller-provided rule summary as a fallback.
 */
function formatZodIssues(error: z.ZodError, fallback: string): string {
  const messages = error.issues.map((issue) => issue.message).filter((m) => m !== '');
  return messages.length > 0 ? messages.join('; ') : fallback;
}

// Input echoes (artist, originalTrack, type/page/perPage) are intentionally
// dropped from these Last.fm response shapes — the LLM just sent them. Only
// server-derived fields (count, items, biography, mbid, etc.) survive. The
// originals are captured in the DEBUG log line at the top of each function.
interface SimilarArtistsResult {
  count: number;
  similarArtists: LastFmArtist[];
}

interface LastFmTrack {
  name: string;
  artist: string;
  match: number;
  url: string;
  mbid: string | null;
}

interface SimilarTracksResult {
  count: number;
  similarTracks: LastFmTrack[];
}

interface LastFmTag {
  name: string;
  url: string;
}

interface ArtistInfoResult {
  name: string;
  mbid: string | null;
  url: string;
  listeners: number;
  playcount: number;
  biography: string | null;
  tags: LastFmTag[];
  similar: string[];
}

interface TopTrackResult {
  rank: number;
  name: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

interface TopTracksByArtistResult {
  count: number;
  tracks: TopTrackResult[];
}

interface TrendingArtistItem {
  rank: number;
  name: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

interface TrendingTrackItem {
  rank: number;
  name: string;
  artist: string;
  playcount: number;
  listeners: number;
  url: string;
  mbid: string | null;
}

interface TrendingTagItem {
  rank: number;
  name: string;
  count: number;
  reach: number;
  url: string;
}

interface TrendingMusicResult {
  count: number;
  items: TrendingArtistItem[] | TrendingTrackItem[] | TrendingTagItem[];
}

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';

async function callLastFmApi(method: string, params: Record<string, string>, apiKey: string): Promise<Record<string, unknown>> {
  const url = new URL(LASTFM_API_BASE);
  url.searchParams.append('method', method);
  url.searchParams.append('api_key', apiKey);
  url.searchParams.append('format', 'json');

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  logger.debug(`Calling Last.fm API: ${method}`, params);

  // All Last.fm endpoints we call are reads — safe to retry on timeout.
  const response = await fetchWithTimeout(
    url.toString(),
    {},
    {
      timeoutMs: getExternalApiTimeoutMs(),
      retryPolicy: 'safe',
      operationLabel: `Last.fm ${method}`,
    },
  );

  if (!response.ok) {
    throw new Error(ErrorFormatter.lastfmApi(response));
  }

  const data = await response.json() as Record<string, unknown>;

  // Last.fm uses positive integers as error codes (e.g. 6 = artist not found).
  // error:0 means no error on some legacy endpoints — do NOT treat it as an error.
  if (typeof data['error'] === 'number' && data['error'] !== 0) {
    const message = typeof data['message'] === 'string' ? data['message'] : undefined;
    throw new Error(ErrorFormatter.lastfmResponse(message));
  }

  return data;
}

export async function getSimilarArtists(config: Config, args: unknown): Promise<SimilarArtistsResult> {
  try {
    const { artist, limit = 20 } = SimilarArtistsSchema.parse(args);

    logger.debug('Tool getSimilarArtists called with args:', { artist, limit });

    if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
      throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
    }

    logger.info(`Getting similar artists for: ${artist}`);

    const data = await callLastFmApi('artist.getSimilar', {
      artist,
      limit: limit.toString(),
      autocorrect: '1',
    }, config.lastFmApiKey);

    const similarArtistsRaw = data['similarartists'];
    if (typeof similarArtistsRaw !== 'object' || similarArtistsRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing similarartists'));
    }
    const similarArtistsContainer = similarArtistsRaw as { artist?: unknown[] };
    const similarArtists = similarArtistsContainer.artist ?? [];

    return {
      count: similarArtists.length,
      similarArtists: similarArtists.map((a: unknown) => {
        const artist = a as Record<string, unknown>;
        return {
          name: typeof artist['name'] === 'string' ? artist['name'] : '',
          match: safeNumber(artist['match']),
          url: typeof artist['url'] === 'string' ? artist['url'] : '',
          mbid: typeof artist['mbid'] === 'string' ? artist['mbid'] : null,
        };
      }),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_similar_artists', error));
  }
}

export async function getSimilarTracks(config: Config, args: unknown): Promise<SimilarTracksResult> {
  try {
    const { artist, track, limit = 20 } = SimilarTracksSchema.parse(args);

    logger.debug('Tool getSimilarTracks called with args:', { artist, track, limit });

    if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
      throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
    }

    logger.info(`Getting similar tracks for: ${artist} - ${track}`);

    const data = await callLastFmApi('track.getSimilar', {
      artist,
      track,
      limit: limit.toString(),
      autocorrect: '1',
    }, config.lastFmApiKey);

    const similarTracksRaw = data['similartracks'];
    if (typeof similarTracksRaw !== 'object' || similarTracksRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing similartracks'));
    }
    const similarTracksContainer = similarTracksRaw as { track?: unknown[] };
    const similarTracks = similarTracksContainer.track ?? [];

    return {
      count: similarTracks.length,
      similarTracks: similarTracks.map((t: unknown) => {
        const track = t as Record<string, unknown>;
        const trackArtist = track['artist'] as Record<string, unknown> | undefined;
        const artistName = trackArtist?.['name'] ?? trackArtist?.['#text'];
        return {
          name: typeof track['name'] === 'string' ? track['name'] : '',
          artist: typeof artistName === 'string' ? artistName : 'Unknown',
          match: safeNumber(track['match']),
          url: typeof track['url'] === 'string' ? track['url'] : '',
          mbid: typeof track['mbid'] === 'string' ? track['mbid'] : null,
        };
      }),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_similar_tracks', error));
  }
}

export async function getArtistInfo(config: Config, args: unknown): Promise<ArtistInfoResult> {
  try {
    const { artist, lang = 'en' } = ArtistInfoSchema.parse(args);

    logger.debug('Tool getArtistInfo called with args:', { artist, lang });

    if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
      throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
    }

    logger.info(`Getting artist info for: ${artist}`);

    const data = await callLastFmApi('artist.getInfo', {
      artist,
      lang,
      autocorrect: '1',
    }, config.lastFmApiKey);

    const artistInfoRaw = data['artist'];
    if (typeof artistInfoRaw !== 'object' || artistInfoRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing artist'));
    }
    const artistInfo = artistInfoRaw as Record<string, unknown>;
    const stats = artistInfo['stats'] as Record<string, unknown> | undefined;
    const bio = artistInfo['bio'] as Record<string, unknown> | undefined;
    const tags = artistInfo['tags'] as Record<string, unknown> | undefined;
    const similar = artistInfo['similar'] as Record<string, unknown> | undefined;
    const bioSummary = bio?.['summary'];

    return {
      name: typeof artistInfo['name'] === 'string' ? artistInfo['name'] : '',
      mbid: typeof artistInfo['mbid'] === 'string' ? artistInfo['mbid'] : null,
      url: typeof artistInfo['url'] === 'string' ? artistInfo['url'] : '',
      listeners: safeNumber(stats?.['listeners']),
      playcount: safeNumber(stats?.['playcount']),
      biography: typeof bioSummary === 'string' ? stripWikiHtml(bioSummary) : null,
      tags: ((tags?.['tag'] as Record<string, unknown>[] | undefined) ?? []).map((t: Record<string, unknown>) => ({
        name: typeof t['name'] === 'string' ? t['name'] : '',
        url: typeof t['url'] === 'string' ? t['url'] : '',
      })),
      similar: ((similar?.['artist'] as Record<string, unknown>[] | undefined) ?? []).slice(0, 5).map((a: Record<string, unknown>) => typeof a['name'] === 'string' ? a['name'] : ''),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_artist_info', error));
  }
}

export async function getTopTracksByArtist(config: Config, args: unknown): Promise<TopTracksByArtistResult> {
  try {
    const { artist, limit = 10 } = TopTracksByArtistSchema.parse(args);

    logger.debug('Tool getTopTracksByArtist called with args:', { artist, limit });

    if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
      throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
    }

    logger.info(`Getting top tracks for artist: ${artist}`);

    const data = await callLastFmApi('artist.getTopTracks', {
      artist,
      limit: limit.toString(),
      autocorrect: '1',
    }, config.lastFmApiKey);

    const topTracksRaw = data['toptracks'];
    if (typeof topTracksRaw !== 'object' || topTracksRaw === null) {
      throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing toptracks'));
    }
    const topTracksContainer = topTracksRaw as Record<string, unknown>;
    const topTracks = (topTracksContainer['track'] as Record<string, unknown>[] | undefined) ?? [];

    return {
      count: topTracks.length,
      tracks: topTracks.map((t: Record<string, unknown>, index: number) => ({
        rank: index + 1,
        name: typeof t['name'] === 'string' ? t['name'] : '',
        playcount: safeNumber(t['playcount']),
        listeners: safeNumber(t['listeners']),
        url: typeof t['url'] === 'string' ? t['url'] : '',
        mbid: typeof t['mbid'] === 'string' ? t['mbid'] : null,
      })),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_top_tracks_by_artist', error));
  }
}

export async function getTrendingMusic(config: Config, args: unknown): Promise<TrendingMusicResult> {
  try {
    const { type, limit = 20, page = 1 } = TrendingMusicSchema.parse(args);

    logger.debug('Tool getTrendingMusic called with args:', { type, limit, page });

    if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
      throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
    }

    logger.info(`Getting global ${type} chart`);

    const method = type === 'artists' ? 'chart.getTopArtists' :
                   type === 'tracks' ? 'chart.getTopTracks' :
                   'chart.getTopTags';

    const data = await callLastFmApi(method, {
      limit: limit.toString(),
      page: page.toString(),
    }, config.lastFmApiKey);

    if (type === 'artists') {
      const artistsRaw = data['artists'];
      if (typeof artistsRaw !== 'object' || artistsRaw === null) {
        throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing artists'));
      }
      const artistsContainer = artistsRaw as Record<string, unknown>;
      const artists = ((artistsContainer['artist'] as Record<string, unknown>[] | undefined) ?? []).map((a: Record<string, unknown>, index: number): TrendingArtistItem => ({
        rank: (page - 1) * limit + index + 1,
        name: typeof a['name'] === 'string' ? a['name'] : '',
        playcount: safeNumber(a['playcount']),
        listeners: safeNumber(a['listeners']),
        url: typeof a['url'] === 'string' ? a['url'] : '',
        mbid: typeof a['mbid'] === 'string' ? a['mbid'] : null,
      }));

      return {
        count: artists.length,
        items: artists,
      };
    } else if (type === 'tracks') {
      const tracksRaw = data['tracks'];
      if (typeof tracksRaw !== 'object' || tracksRaw === null) {
        throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing tracks'));
      }
      const tracksContainer = tracksRaw as Record<string, unknown>;
      const tracks = ((tracksContainer['track'] as Record<string, unknown>[] | undefined) ?? []).map((t: Record<string, unknown>, index: number): TrendingTrackItem => {
        const artistObj = t['artist'] as Record<string, unknown> | undefined;
        const artistName = artistObj?.['name'];
        return {
          rank: (page - 1) * limit + index + 1,
          name: typeof t['name'] === 'string' ? t['name'] : '',
          artist: typeof artistName === 'string' ? artistName : 'Unknown',
          playcount: safeNumber(t['playcount']),
          listeners: safeNumber(t['listeners']),
          url: typeof t['url'] === 'string' ? t['url'] : '',
          mbid: typeof t['mbid'] === 'string' ? t['mbid'] : null,
        };
      });

      return {
        count: tracks.length,
        items: tracks,
      };
    } else {
      // Last.fm's chart.getTopTags response does NOT include a `count` field —
      // it returns `reach` (unique users) and `taggings` (total tag applications)
      // instead. Surface `taggings` as `count` (the LLM-facing semantic field)
      // because that's the closer analogue to per-tag popularity; also expose
      // `reach` so callers that care about distinct users can use it.
      const tagsRaw = data['tags'];
      if (typeof tagsRaw !== 'object' || tagsRaw === null) {
        throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing tags'));
      }
      const tagsContainer = tagsRaw as Record<string, unknown>;
      const tags = ((tagsContainer['tag'] as Record<string, unknown>[] | undefined) ?? []).map((t: Record<string, unknown>, index: number): TrendingTagItem => ({
        rank: (page - 1) * limit + index + 1,
        name: typeof t['name'] === 'string' ? t['name'] : '',
        count: safeNumber(t['taggings'] ?? t['count']),
        reach: safeNumber(t['reach']),
        url: typeof t['url'] === 'string' ? t['url'] : '',
      }));

      return {
        count: tags.length,
        items: tags,
      };
    }
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_trending_music', error));
  }
}

// === get_artist_albums =======================================================
//
// Full discography with types/years (MusicBrainz spine), genres + popularity
// (Last.fm enrichment), and in-library flags (Navidrome). Pipeline + decisions:
// docs/ARTIST-ALBUMS-SPEC.md. Constant ~4-5 requests per call regardless of
// discography size — genres ride the MB browse (`inc=genres`), popularity
// rides ONE getTopAlbums page, and per-album Last.fm getInfo is never called.

interface LastFmTopAlbumRow {
  name: string;
  mbid: string | null;
  playcount: number;
  url: string;
}

interface ArtistAlbumDTO {
  title: string;
  year: number | null;
  primaryType: string;
  secondaryTypes: string[];
  /** null when Navidrome was unreachable (membership unknown). */
  inLibrary: boolean | null;
  libraryAlbumId: string | null;
  genres: string[];
  /** Rank by playcount within the full filtered discography; null = no Last.fm join. */
  popularityRank: number | null;
  mbid: string | null;
  source: 'musicbrainz' | 'lastfm-only';
  typeUnverified: boolean;
  // verbose-only (already in hand from the spine/join — never extra requests)
  playcount?: number;
  url?: string;
  disambiguation?: string;
}

interface ArtistAlbumsResult {
  artist: {
    name: string;
    mbid: string | null;
    navidromeArtistId: string | null;
  };
  counts: {
    discography: number;
    inLibrary: number | null;
    missing: number | null;
    returned: number;
  };
  sources: {
    musicbrainz: boolean;
    lastfm: boolean;
  };
  albums: ArtistAlbumDTO[];
  note?: string;
}

// Raw per-source caches (24h: discographies change rarely — spec §8). The
// merged result is intentionally NOT cached so filter-param permutations
// (onlyMissing/excludeSecondary/verbose) always recompute from cached raws.
const ARTIST_ALBUMS_CACHE_TTL_SECONDS = 86400;
const mbArtistCache = new Cache<MbArtistMatch | null>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);
const mbSpineCache = new Cache<MbReleaseGroup[]>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);
const lastFmTopAlbumsCache = new Cache<LastFmTopAlbumRow[]>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);

/** Test-only: drop cached MB/Last.fm raws so fixtures don't leak across tests. */
export function clearArtistAlbumsCachesForTests(): void {
  mbArtistCache.clear();
  mbSpineCache.clear();
  lastFmTopAlbumsCache.clear();
}

// Per-cache in-flight fetch maps, so a burst of concurrent calls for the same
// key coalesces into a single external request (MusicBrainz enforces 1 req/s).
const inflightByCache = new WeakMap<Cache<unknown>, Map<string, Promise<unknown>>>();

async function cachedOr<T>(cache: Cache<T>, key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let inflight = inflightByCache.get(cache as Cache<unknown>);
  if (inflight === undefined) {
    inflight = new Map<string, Promise<unknown>>();
    inflightByCache.set(cache as Cache<unknown>, inflight);
  }

  const existing = inflight.get(key);
  if (existing !== undefined) return existing as Promise<T>;

  const p = fetcher()
    .then((value) => {
      cache.set(key, value);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

// --- Last.fm branch ---------------------------------------------------------

async function fetchTopAlbums(artist: string, apiKey: string): Promise<LastFmTopAlbumRow[]> {
  // ONE page only: rank beyond the top 100 carries no popularity signal;
  // spine albums that miss the join simply get popularityRank null.
  const data = await callLastFmApi('artist.getTopAlbums', {
    artist,
    limit: '100',
    autocorrect: '1',
  }, apiKey);

  const container = data['topalbums'];
  if (typeof container !== 'object' || container === null) {
    throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing topalbums'));
  }
  const albums = ((container as Record<string, unknown>)['album'] as Record<string, unknown>[] | undefined) ?? [];

  return albums.map((a): LastFmTopAlbumRow => ({
    name: typeof a['name'] === 'string' ? a['name'] : '',
    mbid: typeof a['mbid'] === 'string' && a['mbid'] !== '' ? a['mbid'] : null,
    playcount: safeNumber(a['playcount']),
    url: typeof a['url'] === 'string' ? a['url'] : '',
  }));
}

/**
 * Junk-drop + normTitle-dedup (keep the highest-playcount variant), then index
 * by MBID and by normalized title for the spine join.
 */
function indexLastFmRows(rows: LastFmTopAlbumRow[]): {
  byMbid: Map<string, LastFmTopAlbumRow>;
  byNorm: Map<string, LastFmTopAlbumRow>;
} {
  const byNorm = new Map<string, LastFmTopAlbumRow>();
  for (const row of rows) {
    if (row.name === '' || isJunkAlbumName(row.name)) continue;
    const key = normTitle(row.name);
    if (key === '') continue;
    const existing = byNorm.get(key);
    if (existing === undefined || row.playcount > existing.playcount) {
      byNorm.set(key, row);
    }
  }

  const byMbid = new Map<string, LastFmTopAlbumRow>();
  for (const row of byNorm.values()) {
    if (row.mbid !== null) byMbid.set(row.mbid, row);
  }
  return { byMbid, byNorm };
}

// --- Navidrome branch ---------------------------------------------------------

interface LibraryLookup {
  /** Primary resolved Navidrome artist id (first accepted match). */
  artistId: string | null;
  /** normTitle(album name) → Navidrome album id, across ALL accepted artist ids. */
  albumsByNormTitle: Map<string, string>;
  /** True when at least one artist id was resolved (fallback matching not needed). */
  resolvedArtist: boolean;
}

/**
 * Same act, multiple spellings ("Miami Nights '84" vs "Miami Nights 1984"):
 * equal after normalization, or token-wise equal where numeric tokens match
 * by suffix.
 */
function likelySameArtist(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (na === nb) return true;

  const tokensA = na.split(' ');
  const tokensB = nb.split(' ');
  if (tokensA.length !== tokensB.length) return false;
  return tokensA.every((tok, i) => {
    const other = tokensB[i];
    if (other === undefined) return false;
    if (tok === other) return true;
    if (/^\d+$/.test(tok) && /^\d+$/.test(other)) {
      return tok.endsWith(other) || other.endsWith(tok);
    }
    return false;
  });
}

/**
 * Navidrome's `/artist?name=` is a contains-filter, so a query for
 * "Miami Nights 1984" never returns the "'84" alias row. When the name ends
 * in a numeric-ish token, also query with that token stripped so alias rows
 * surface; `likelySameArtist` then decides what actually counts.
 */
function artistQueryVariants(name: string): string[] {
  const variants = [name];
  const stripped = name.replace(/\s+['’]?\d{1,4}$/u, '').trim();
  if (stripped !== '' && stripped !== name) variants.push(stripped);
  return variants;
}

function parseIdNameRows(data: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(data)) return [];
  const rows: Array<{ id: string; name: string }> = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row['id'] === 'string' && typeof row['name'] === 'string') {
      rows.push({ id: row['id'], name: row['name'] });
    }
  }
  return rows;
}

async function fetchLibraryLookup(client: NavidromeClient, artistName: string): Promise<LibraryLookup> {
  // Resolve artist id(s) — collect ALL close matches, not just one (spec §4).
  const seen = new Map<string, string>(); // id → name
  for (const variant of artistQueryVariants(artistName)) {
    const { data } = await client.requestWithLibraryFilterAndMeta<unknown>(
      `/artist?name=${encodeURIComponent(variant)}&role=maincredit&_start=0&_end=20`,
    );
    for (const row of parseIdNameRows(data)) {
      if (likelySameArtist(row.name, artistName)) {
        seen.set(row.id, row.name);
      }
    }
  }

  const artistIds = [...seen.keys()];
  const albumsByNormTitle = new Map<string, string>();

  // Union albums across all accepted artist ids (Navidrome has no rate limit).
  const albumPages = await Promise.all(artistIds.map(async id => {
    const { data } = await client.requestWithLibraryFilterAndMeta<unknown>(
      `/album?artist_id=${encodeURIComponent(id)}&_start=0&_end=500`,
    );
    return parseIdNameRows(data);
  }));
  for (const page of albumPages) {
    for (const album of page) {
      const key = normTitle(album.name);
      if (key !== '' && !albumsByNormTitle.has(key)) {
        albumsByNormTitle.set(key, album.id);
      }
    }
  }

  return {
    artistId: artistIds[0] ?? null,
    albumsByNormTitle,
    resolvedArtist: artistIds.length > 0,
  };
}

/**
 * Fallback when name-resolution found no Navidrome artist (heavy aliasing):
 * probe a capped number of discography titles by album name and accept only
 * on a normalized artist-name match (spec §4 step 4).
 */
async function fallbackAlbumMatch(
  client: NavidromeClient,
  artistName: string,
  titles: string[],
  lookup: LibraryLookup,
): Promise<void> {
  const FALLBACK_PROBE_CAP = 10;
  for (const title of titles.slice(0, FALLBACK_PROBE_CAP)) {
    const { data } = await client.requestWithLibraryFilterAndMeta<unknown>(
      `/album?name=${encodeURIComponent(title)}&_start=0&_end=5`,
    );
    if (!Array.isArray(data)) continue;
    for (const raw of data) {
      if (typeof raw !== 'object' || raw === null) continue;
      const row = raw as Record<string, unknown>;
      const id = row['id'];
      const name = row['name'];
      const albumArtist = row['albumArtist'] ?? row['artist'];
      if (typeof id !== 'string' || typeof name !== 'string' || typeof albumArtist !== 'string') continue;
      if (!likelySameArtist(albumArtist, artistName)) continue;
      const key = normTitle(name);
      if (key !== '' && !lookup.albumsByNormTitle.has(key)) {
        lookup.albumsByNormTitle.set(key, id);
      }
    }
  }
}

// --- Orchestration ------------------------------------------------------------

interface MergeInput {
  spine: MbReleaseGroup[];
  lastFmRows: LastFmTopAlbumRow[];
  mbUsable: boolean;
  includeUnverified: boolean;
  excludeSecondary: string[];
}

interface MergedAlbum {
  title: string;
  year: number | null;
  primaryType: string;
  secondaryTypes: string[];
  genres: string[];
  mbid: string | null;
  source: 'musicbrainz' | 'lastfm-only';
  typeUnverified: boolean;
  disambiguation: string | null;
  lastFm: LastFmTopAlbumRow | null;
}

/** Pipeline steps [D] merge, [E] enrich, [F] type filter (spec §3). */
function mergeSources(input: MergeInput): MergedAlbum[] {
  const { byMbid, byNorm } = indexLastFmRows(input.lastFmRows);
  const merged: MergedAlbum[] = [];
  const joinedNormKeys = new Set<string>();

  if (input.mbUsable) {
    const excluded = new Set(input.excludeSecondary);
    for (const rg of input.spine) {
      // [F] secondary-type exclusion (types already lowercased at parse).
      if (rg.secondaryTypes.some(t => excluded.has(t))) continue;

      // [D] join: MBID first, else normalized title.
      const key = normTitle(rg.title);
      const lastFm = byMbid.get(rg.mbid) ?? byNorm.get(key) ?? null;
      if (lastFm !== null) joinedNormKeys.add(normTitle(lastFm.name));

      merged.push({
        title: rg.title,
        year: rg.year,
        primaryType: rg.primaryType ?? 'Unknown',
        secondaryTypes: rg.secondaryTypes,
        genres: rg.genres,
        mbid: rg.mbid,
        source: 'musicbrainz',
        typeUnverified: false,
        disambiguation: rg.disambiguation,
        lastFm,
      });
    }
  }

  // Last.fm-only rows: the long tail MB lacks. Reached two ways — explicit
  // opt-in (`includeUnverified`) on the normal path, or automatically as the
  // degraded spine when MB is unusable (spec §6: degrade, not fail).
  if (!input.mbUsable || input.includeUnverified) {
    for (const [key, row] of byNorm) {
      if (joinedNormKeys.has(key)) continue;
      if (row.playcount <= 0) continue;
      merged.push({
        title: row.name,
        year: null,
        primaryType: 'Unknown',
        secondaryTypes: [],
        genres: [],
        mbid: row.mbid,
        source: 'lastfm-only',
        typeUnverified: true,
        disambiguation: null,
        lastFm: row,
      });
    }
  }

  return merged;
}

export async function getArtistAlbums(
  client: NavidromeClient,
  config: Config,
  args: unknown,
): Promise<ArtistAlbumsResult> {
  try {
    const params = GetArtistAlbumsSchema.parse(args);

    logger.debug('Tool getArtistAlbums called with args:', {
      artist: params.artist,
      mbid: params.mbid,
      includeTypes: params.includeTypes,
      onlyMissing: params.onlyMissing,
    });

    if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
      throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
    }
    const apiKey = config.lastFmApiKey;
    const notes: string[] = [];

    // -- Resolve the MB artist (search by name, or lookup when MBID given;
    //    Last.fm's own mbid= param is unreliable, so the MBID path recovers
    //    the canonical name from MB for the other two branches).
    let mbArtist: MbArtistMatch | null = null;
    let mbRequestFailed = false;
    try {
      // Cache keys use the raw lowercased name, NOT normTitle — normalization is
      // lossy ("The Midnight" / "Midnight" collide) and a 24h wrong-artist hit
      // is worse than the occasional duplicate fetch.
      mbArtist = params.mbid !== undefined
        ? await cachedOr(mbArtistCache, `mbid:${params.mbid}`, () => lookupMbArtist(params.mbid as string, config))
        : await cachedOr(mbArtistCache, `name:${(params.artist as string).toLowerCase()}`, () => searchMbArtist(params.artist as string, config));
    } catch (error) {
      mbRequestFailed = true;
      logger.warn(`MusicBrainz artist resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const artistName = params.artist ?? mbArtist?.name;
    if (artistName === undefined) {
      throw new Error(
        'Could not resolve a usable artist name: MusicBrainz lookup for the given mbid failed and no artist name was provided',
      );
    }

    // -- Fan out the three branches (MB internally serialized at 1 req/s;
    //    Last.fm and Navidrome run alongside).
    const spinePromise: Promise<MbReleaseGroup[]> = mbArtist !== null
      ? cachedOr(
          mbSpineCache,
          `${mbArtist.mbid}|${[...params.includeTypes].sort().join(',')}`,
          () => browseMbReleaseGroups(mbArtist.mbid, params.includeTypes, config),
        )
      : Promise.resolve([]);
    const lastFmPromise = cachedOr(
      lastFmTopAlbumsCache,
      artistName.toLowerCase(),
      () => fetchTopAlbums(artistName, apiKey),
    );
    const navPromise = fetchLibraryLookup(client, artistName);

    const [spineResult, lastFmResult, navResult] = await Promise.allSettled([
      spinePromise,
      lastFmPromise,
      navPromise,
    ]);

    // -- Degradation accounting (spec §6: degrade, not fail).
    const spine = spineResult.status === 'fulfilled' ? spineResult.value : [];
    if (spineResult.status === 'rejected') {
      mbRequestFailed = true;
      logger.warn(`MusicBrainz browse failed: ${String(spineResult.reason)}`);
    }
    const mbUsable = mbArtist !== null && spineResult.status === 'fulfilled';
    if (mbRequestFailed) {
      notes.push('MusicBrainz was unreachable; release types/years are unverified Last.fm data.');
    } else if (mbArtist === null) {
      notes.push('Artist not found in MusicBrainz; release types/years are unverified Last.fm data.');
    }

    const lastFmRows = lastFmResult.status === 'fulfilled' ? lastFmResult.value : [];
    const lastFmOk = lastFmResult.status === 'fulfilled';
    if (!lastFmOk) {
      logger.warn(`Last.fm getTopAlbums failed: ${String(lastFmResult.reason)}`);
      notes.push('Last.fm was unreachable; popularity ranking is unavailable.');
    }

    if (!mbUsable && !lastFmOk) {
      throw new Error('Both MusicBrainz and Last.fm failed — no discography source available');
    }

    const navLookup: LibraryLookup | null = navResult.status === 'fulfilled' ? navResult.value : null;
    if (navLookup === null) {
      logger.warn(`Navidrome library lookup failed: ${String((navResult as PromiseRejectedResult).reason)}`);
      notes.push('Navidrome was unreachable; library membership is unknown (inLibrary: null).');
    }

    // -- [D]/[E]/[F] merge, enrich, type-filter.
    const merged = mergeSources({
      spine,
      lastFmRows,
      mbUsable,
      includeUnverified: params.includeUnverified,
      excludeSecondary: params.excludeSecondary,
    });

    // -- Popularity rank across the full filtered discography (assigned before
    //    onlyMissing so ranks stay stable whatever the membership filter does).
    const ranked = [...merged]
      .filter(m => m.lastFm !== null)
      .sort((a, b) => (b.lastFm?.playcount ?? 0) - (a.lastFm?.playcount ?? 0));
    const rankByTitle = new Map<MergedAlbum, number>();
    ranked.forEach((m, i) => rankByTitle.set(m, i + 1));

    // -- [G] library compare (+ §4.4 fallback probe when no artist resolved).
    if (navLookup !== null && !navLookup.resolvedArtist && merged.length > 0) {
      await fallbackAlbumMatch(client, artistName, merged.map(m => m.title), navLookup);
    }

    const albums: ArtistAlbumDTO[] = merged.map(m => {
      const libraryAlbumId = navLookup?.albumsByNormTitle.get(normTitle(m.title)) ?? null;
      return {
        title: m.title,
        year: m.year,
        primaryType: m.primaryType,
        secondaryTypes: m.secondaryTypes,
        inLibrary: navLookup !== null ? libraryAlbumId !== null : null,
        libraryAlbumId,
        genres: m.genres,
        popularityRank: rankByTitle.get(m) ?? null,
        mbid: m.mbid,
        source: m.source,
        typeUnverified: m.typeUnverified,
        ...(params.verbose && m.lastFm !== null ? { playcount: m.lastFm.playcount, url: m.lastFm.url } : {}),
        ...(params.verbose && m.disambiguation !== null && m.disambiguation !== '' ? { disambiguation: m.disambiguation } : {}),
      };
    });

    // Most-listened first reads naturally; unranked rows keep spine order at the end.
    albums.sort((a, b) => (a.popularityRank ?? Number.MAX_SAFE_INTEGER) - (b.popularityRank ?? Number.MAX_SAFE_INTEGER));

    const inLibraryCount = navLookup !== null ? albums.filter(a => a.inLibrary === true).length : null;
    const missingCount = navLookup !== null ? albums.filter(a => a.inLibrary === false).length : null;

    let returned = albums;
    if (params.onlyMissing) {
      if (navLookup !== null) {
        returned = albums.filter(a => a.inLibrary === false);
      } else {
        notes.push('onlyMissing was not applied because library membership is unknown.');
      }
    }

    logger.info(
      `get_artist_albums: ${artistName} — spine ${spine.length}, lastfm ${lastFmRows.length}, ` +
      `merged ${merged.length}, returned ${returned.length}`,
    );

    return {
      artist: {
        name: mbArtist?.name ?? artistName,
        mbid: mbArtist?.mbid ?? params.mbid ?? null,
        navidromeArtistId: navLookup?.artistId ?? null,
      },
      counts: {
        discography: albums.length,
        inLibrary: inLibraryCount,
        missing: missingCount,
        returned: returned.length,
      },
      sources: {
        musicbrainz: mbUsable,
        lastfm: lastFmOk,
      },
      albums: returned,
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    };
  } catch (error) {
    // Surface a clean, LLM-actionable message for input-contract violations
    // (the JSON Schema advertises required:[] but the conditional rule needs
    // artist OR mbid) instead of letting a raw Zod issue-array blob through.
    if (error instanceof z.ZodError) {
      throw new Error(ErrorFormatter.toolExecution(
        'get_artist_albums',
        new Error(formatZodIssues(error, 'get_artist_albums requires at least one of: artist (name) or mbid (MusicBrainz id).')),
      ));
    }
    throw new Error(ErrorFormatter.toolExecution('get_artist_albums', error));
  }
}

// === get_album_info ===========================================================
//
// Single-album deep dive — the companion to get_artist_albums (spec §9). Source
// roles VERIFIED LIVE 2026-06-12 and inverted from the obvious guess:
//   - MusicBrainz is PRIMARY for the tracklist (complete ms durations, clean
//     titles; Last.fm had 3/14 durations on a flagship album) and for
//     year/type/genres.
//   - Last.fm album.getInfo provides what only it has — wiki, tags, listeners,
//     playcount — and is the tracklist FALLBACK when MB lacks the release group.
// Budget: 2 MB + 1 Last.fm + 1-2 Navidrome requests.

interface AlbumTrackDTO {
  position: number;
  title: string;
  durationSeconds: number | null;
}

interface LastFmAlbumInfo {
  name: string;
  artist: string;
  url: string;
  listeners: number;
  playcount: number;
  tags: string[];
  summary: string | null;
  wikiFull: string | null;
  tracks: AlbumTrackDTO[];
}

interface AlbumInfoResult {
  album: {
    title: string;
    artist: string;
    /** MusicBrainz release-group MBID (feed it back to this tool), or null. */
    mbid: string | null;
    year: number | null;
    primaryType: string;
    secondaryTypes: string[];
    /** null when Navidrome was unreachable (membership unknown). */
    inLibrary: boolean | null;
    libraryAlbumId: string | null;
  };
  /** MB release-group genres; falls back to top-5 Last.fm tags when MB has none. */
  genres: string[];
  listeners: number | null;
  playcount: number | null;
  /** Last.fm wiki summary, HTML-stripped; null when Last.fm has none. */
  summary: string | null;
  trackCount: number | null;
  tracks: AlbumTrackDTO[];
  tracksSource: 'musicbrainz' | 'lastfm' | null;
  sources: { musicbrainz: boolean; lastfm: boolean };
  // verbose-only (already in hand — never extra requests)
  wikiFull?: string | null;
  lastFmUrl?: string;
  tags?: string[];
  tracklistRelease?: { mbid: string; status: string | null; date: string | null; country: string | null };
  note?: string;
}

// Raw per-source caches, 24h like the discography caches (spec §8.3/§9.5).
const mbRgDetailCache = new Cache<MbReleaseGroupDetail | null>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);
const mbTracklistCache = new Cache<MbTracklist | null>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);
const lastFmAlbumInfoCache = new Cache<LastFmAlbumInfo>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);

/** Test-only: drop cached get_album_info raws so fixtures don't leak across tests. */
export function clearAlbumInfoCachesForTests(): void {
  mbRgDetailCache.clear();
  mbTracklistCache.clear();
  lastFmAlbumInfoCache.clear();
}

/**
 * Last.fm serves single-element containers as a bare object instead of a
 * one-element array (verified live on one-track albums) — coerce.
 */
function asLastFmArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
  }
  if (typeof value === 'object' && value !== null) {
    return [value as Record<string, unknown>];
  }
  return [];
}

/**
 * Last.fm album tags mix genres with user shelf-keeping noise (observed live:
 * ":3star", "2015", "albums I own", "seen live"). Keep only genre-like tags
 * for the `genres` fallback; the verbose `tags` field keeps the raw list.
 */
function isGenreLikeTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (trimmed === '' || /^\d{1,4}$/.test(trimmed)) return false; // bare years/numbers
  if (!/^[\p{L}\p{N}]/u.test(trimmed)) return false; // punctuation-led (":3star")
  if (/\b(?:own(?:ed)?|favou?rites?|seen live|check ?out|wishlist)\b/i.test(trimmed)) return false;
  return true;
}

/**
 * Strip wiki HTML plus the boilerplate "Read more on Last.fm" anchor Last.fm
 * appends to every summary. Returns null when nothing readable remains.
 */
function stripWikiHtml(html: string): string | null {
  const text = html
    .replace(/<a\s[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s*Read more on Last\.fm\.?\s*$/i, '')
    .trim();
  return text === '' ? null : text;
}

async function fetchLastFmAlbumInfo(artist: string, album: string, apiKey: string): Promise<LastFmAlbumInfo> {
  const data = await callLastFmApi('album.getInfo', {
    artist,
    album,
    autocorrect: '1',
  }, apiKey);

  const albumRaw = data['album'];
  if (typeof albumRaw !== 'object' || albumRaw === null) {
    throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing album'));
  }
  const info = albumRaw as Record<string, unknown>;

  // Quirks, all verified live (spec §9.4): the `tracks` key can be ABSENT;
  // `tracks.track` is an object for single-track albums; `tags` can be the
  // empty string ""; `wiki` is absent below a popularity floor; listeners/
  // playcount are strings; per-track duration is integer seconds or null.
  const tracksContainer = typeof info['tracks'] === 'object' && info['tracks'] !== null
    ? (info['tracks'] as Record<string, unknown>)['track']
    : undefined;
  const tracks: AlbumTrackDTO[] = asLastFmArray(tracksContainer)
    .map((t, index) => {
      const attr = typeof t['@attr'] === 'object' && t['@attr'] !== null
        ? t['@attr'] as Record<string, unknown>
        : {};
      const rank = safeNumber(attr['rank']);
      const duration = safeNumber(t['duration']);
      return {
        position: rank > 0 ? rank : index + 1,
        title: typeof t['name'] === 'string' ? t['name'] : '',
        durationSeconds: duration > 0 ? duration : null,
      };
    })
    .filter(t => t.title !== '');

  const tagsContainer = typeof info['tags'] === 'object' && info['tags'] !== null
    ? (info['tags'] as Record<string, unknown>)['tag']
    : undefined;
  const tags = asLastFmArray(tagsContainer)
    .map(t => (typeof t['name'] === 'string' ? t['name'] : ''))
    .filter(name => name !== '');

  const wiki = typeof info['wiki'] === 'object' && info['wiki'] !== null
    ? info['wiki'] as Record<string, unknown>
    : null;
  const summaryRaw = wiki !== null && typeof wiki['summary'] === 'string' ? wiki['summary'] : null;
  const contentRaw = wiki !== null && typeof wiki['content'] === 'string' ? wiki['content'] : null;

  return {
    name: typeof info['name'] === 'string' ? info['name'] : album,
    artist: typeof info['artist'] === 'string' ? info['artist'] : artist,
    url: typeof info['url'] === 'string' ? info['url'] : '',
    listeners: safeNumber(info['listeners']),
    playcount: safeNumber(info['playcount']),
    tags,
    summary: summaryRaw !== null ? stripWikiHtml(summaryRaw) : null,
    wikiFull: contentRaw !== null ? stripWikiHtml(contentRaw) : null,
    tracks,
  };
}

export async function getAlbumInfo(
  client: NavidromeClient,
  config: Config,
  args: unknown,
): Promise<AlbumInfoResult> {
  try {
    const params = GetAlbumInfoSchema.parse(args);

    logger.debug('Tool getAlbumInfo called with args:', {
      artist: params.artist,
      album: params.album,
      mbid: params.mbid,
    });

    if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
      throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
    }
    const apiKey = config.lastFmApiKey;
    const notes: string[] = [];

    // -- Resolve the MB release group: lookup when an mbid is given (recovers
    //    canonical title/artist for the other branches), else name search.
    //    Last.fm's own mbid= param is NEVER used — it wants a release MBID and
    //    rejects release-group MBIDs with "Album not found" (verified live).
    let rg: MbReleaseGroupDetail | null = null;
    let mbResolveFailed = false;
    try {
      rg = params.mbid !== undefined
        ? await cachedOr(mbRgDetailCache, `mbid:${params.mbid}`, () => lookupMbReleaseGroup(params.mbid as string, config))
        : await cachedOr(
            mbRgDetailCache,
            `name:${(params.artist as string).toLowerCase()}|${(params.album as string).toLowerCase()}`,
            () => searchMbReleaseGroup(params.artist as string, params.album as string, config),
          );
    } catch (error) {
      mbResolveFailed = true;
      logger.warn(`MusicBrainz release-group resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const artistName = params.artist ?? rg?.artistName ?? undefined;
    const albumTitle = params.album ?? rg?.title;
    if (artistName === undefined || albumTitle === undefined) {
      throw new Error(
        'Could not resolve usable artist/album names: MusicBrainz lookup for the given mbid failed and no names were provided',
      );
    }

    // -- Fan out the three branches (the MB tracklist browse is serialized
    //    behind the resolve step by the module-level 1 req/s throttle).
    const tracklistPromise: Promise<MbTracklist | null> = rg !== null
      ? cachedOr(mbTracklistCache, rg.mbid, () => browseMbReleaseTracklist(rg.mbid, config))
      : Promise.resolve(null);
    const lastFmPromise = cachedOr(
      lastFmAlbumInfoCache,
      `${artistName.toLowerCase()}|${albumTitle.toLowerCase()}`,
      () => fetchLastFmAlbumInfo(artistName, albumTitle, apiKey),
    );
    const navPromise = fetchLibraryLookup(client, artistName);

    const [tracklistResult, lastFmResult, navResult] = await Promise.allSettled([
      tracklistPromise,
      lastFmPromise,
      navPromise,
    ]);

    // -- Degradation accounting (spec §9.5: degrade, not fail). The resolve and
    //    the tracklist browse are distinct MB calls — a browse failure must not
    //    claim "MB unreachable" when year/type/genres are sitting in `rg`.
    const mbTracklist = tracklistResult.status === 'fulfilled' ? tracklistResult.value : null;
    if (tracklistResult.status === 'rejected') {
      logger.warn(`MusicBrainz release browse failed: ${String(tracklistResult.reason)}`);
      notes.push('The MusicBrainz tracklist could not be fetched; falling back to Last.fm if available.');
    }
    const mbUsable = rg !== null;
    if (mbResolveFailed) {
      notes.push('MusicBrainz was unreachable; release year/type are unavailable.');
    } else if (rg === null) {
      notes.push('Album not found in MusicBrainz; release year/type are unavailable.');
    }

    const lastFm = lastFmResult.status === 'fulfilled' ? lastFmResult.value : null;
    if (lastFm === null) {
      const reason = String((lastFmResult as PromiseRejectedResult).reason);
      logger.warn(`Last.fm album.getInfo failed: ${reason}`);
      notes.push(/album not found/i.test(reason)
        ? 'Last.fm has no entry for this album; popularity, wiki, and tags are unavailable.'
        : 'Last.fm was unreachable; popularity, wiki, and tags are unavailable.');
    }

    if (!mbUsable && lastFm === null) {
      throw new Error('Both MusicBrainz and Last.fm failed — no album info source available');
    }

    const navLookup: LibraryLookup | null = navResult.status === 'fulfilled' ? navResult.value : null;
    if (navLookup === null) {
      logger.warn(`Navidrome library lookup failed: ${String((navResult as PromiseRejectedResult).reason)}`);
      notes.push('Navidrome was unreachable; library membership is unknown (inLibrary: null).');
    }

    // -- Library compare (+ §4.4 fallback probe when no artist resolved).
    if (navLookup !== null && !navLookup.resolvedArtist) {
      const probeTitles = rg !== null && rg.title !== albumTitle ? [albumTitle, rg.title] : [albumTitle];
      await fallbackAlbumMatch(client, artistName, probeTitles, navLookup);
    }
    const libraryAlbumId =
      navLookup?.albumsByNormTitle.get(normTitle(albumTitle))
      ?? (rg !== null ? navLookup?.albumsByNormTitle.get(normTitle(rg.title)) : undefined)
      ?? null;

    // -- Tracklist: MB primary, Last.fm fallback (spec §9.1).
    const mbTracks: MbTrack[] = mbTracklist?.tracks ?? [];
    const tracks: AlbumTrackDTO[] = mbTracks.length > 0 ? mbTracks : lastFm?.tracks ?? [];
    const tracksSource: 'musicbrainz' | 'lastfm' | null =
      mbTracks.length > 0 ? 'musicbrainz' : tracks.length > 0 ? 'lastfm' : null;
    if (tracksSource === null) {
      notes.push('No tracklist is available from either source.');
    }

    // -- Genres: MB release-group genres, else genre-like Last.fm tags
    //    (lowercased to match MB genre casing). Search-resolved RGs carry no
    //    genres, so the names path usually lands on the tag fallback.
    const genres = rg !== null && rg.genres.length > 0
      ? rg.genres
      : (lastFm?.tags ?? []).filter(isGenreLikeTag).slice(0, 5).map(t => t.toLowerCase());

    logger.info(
      `get_album_info: ${artistName} — ${albumTitle}: tracks=${String(tracks.length)} (${tracksSource ?? 'none'}), ` +
      `mb=${String(mbUsable)}, lastfm=${String(lastFm !== null)}`,
    );

    return {
      album: {
        title: rg?.title ?? lastFm?.name ?? albumTitle,
        artist: rg?.artistName ?? lastFm?.artist ?? artistName,
        mbid: rg?.mbid ?? params.mbid ?? null,
        year: rg?.year ?? null,
        primaryType: rg?.primaryType ?? 'Unknown',
        secondaryTypes: rg?.secondaryTypes ?? [],
        inLibrary: navLookup !== null ? libraryAlbumId !== null : null,
        libraryAlbumId,
      },
      genres,
      listeners: lastFm?.listeners ?? null,
      playcount: lastFm?.playcount ?? null,
      summary: lastFm?.summary ?? null,
      trackCount: tracks.length > 0 ? tracks.length : null,
      tracks,
      tracksSource,
      sources: { musicbrainz: mbUsable, lastfm: lastFm !== null },
      ...(params.verbose ? {
        wikiFull: lastFm?.wikiFull ?? null,
        ...(lastFm !== null && lastFm.url !== '' ? { lastFmUrl: lastFm.url } : {}),
        ...(lastFm !== null ? { tags: lastFm.tags } : {}),
        ...(tracksSource === 'musicbrainz' && mbTracklist !== null ? {
          tracklistRelease: {
            mbid: mbTracklist.releaseMbid,
            status: mbTracklist.status,
            date: mbTracklist.date,
            country: mbTracklist.country,
          },
        } : {}),
      } : {}),
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    };
  } catch (error) {
    // Surface a clean, LLM-actionable message for input-contract violations
    // (the JSON Schema advertises required:[] but the conditional rule needs
    // mbid OR both artist and album) instead of a raw Zod issue-array blob.
    if (error instanceof z.ZodError) {
      throw new Error(ErrorFormatter.toolExecution(
        'get_album_info',
        new Error(formatZodIssues(error, 'get_album_info requires either mbid, or both artist and album.')),
      ));
    }
    throw new Error(ErrorFormatter.toolExecution('get_album_info', error));
  }
}