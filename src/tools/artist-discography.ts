/**
 * Navidrome MCP Server - Artist Discography Tools
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Config } from '../config.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { safeNumber } from '../utils/safe-number.js';
import { Cache } from '../utils/cache.js';
import { normTitle, isJunkAlbumName } from '../utils/normalize-title.js';
import {
  asLastFmArray,
  callLastFmApi,
  requireLastFmApiKey,
  stripWikiHtml,
} from '../utils/lastfm.js';
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
  ArtistAlbumsSchema,
  AlbumInfoSchema,
} from '../schemas/index.js';

// get_artist_albums takes the discography from MusicBrainz, popularity from Last.fm, and library
// membership from Navidrome. Step labels [A] to [G] refer to docs/ARTIST-ALBUMS-SPEC.md §3.

interface LastFmTopAlbumRow {
  name: string;
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
  /** Rank by playcount within the full filtered discography. null means no Last.fm join. */
  popularityRank: number | null;
  mbid: string | null;
  source: 'musicbrainz' | 'lastfm-only';
  typeUnverified: boolean;
  // Verbose-only. These come from data already fetched, so verbose adds no requests.
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

// Discographies change rarely, so raw per-source responses cache for 24h (spec §8). The merged
// result is not cached, so each filter combination recomputes from the cached raws.
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

// Concurrent calls for one key share a single in-flight request, since MusicBrainz allows 1 req/s.
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

// Matches the Last.fm error 6 messages but not an HTTP "404 Not Found" status line.
const LASTFM_NOT_FOUND = /album not found|could not be found/i;

async function fetchTopAlbums(artist: string, apiKey: string): Promise<LastFmTopAlbumRow[]> {
  // One page suffices because rank beyond the top 100 carries no popularity signal.
  const data = await callLastFmApi('artist.getTopAlbums', {
    artist,
    limit: '100',
    autocorrect: '1',
  }, apiKey);

  const container = data['topalbums'];
  if (typeof container !== 'object' || container === null) {
    throw new Error(ErrorFormatter.lastfmResponse('unexpected response shape: missing topalbums'));
  }
  const albums = asLastFmArray((container as Record<string, unknown>)['album']);

  return albums.map((a): LastFmTopAlbumRow => ({
    name: typeof a['name'] === 'string' ? a['name'] : '',
    playcount: safeNumber(a['playcount']),
    url: typeof a['url'] === 'string' ? a['url'] : '',
  }));
}

/** Last.fm exposes only release MBIDs, so the spine join keys rows by normalized title. */
function indexLastFmRows(rows: LastFmTopAlbumRow[]): Map<string, LastFmTopAlbumRow> {
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
  return byNorm;
}

interface LibraryLookup {
  /** The first accepted match. */
  artistId: string | null;
  /** Spans every accepted artist id, since one act can have several Navidrome artist rows. */
  albumsByNormTitle: Map<string, string>;
}

/** One act can carry several spellings, such as "Miami Nights '84" and "Miami Nights 1984". */
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
 * Navidrome's `/artist?name=` requires every query word as a word prefix, so "Miami Nights 1984"
 * misses the "Miami Nights '84" row. The query without the trailing number finds such aliases.
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
  const seen = new Map<string, string>();
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

  // Navidrome has no rate limit, so the per-artist album queries run in parallel.
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
  };
}

/** One failed probe must not fail the entire tool, since library membership degrades per title. */
async function probeAlbumsByName(client: NavidromeClient, title: string): Promise<unknown> {
  try {
    const { data } = await client.requestWithLibraryFilterAndMeta<unknown>(
      `/album?name=${encodeURIComponent(title)}&_start=0&_end=5`,
    );
    return data;
  } catch (error) {
    logger.warn(`Navidrome album probe for "${title}" failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Covers artists that name resolution misses through heavy aliasing (spec §4 step 4). The probe
 * cap bounds the added Navidrome requests.
 */
async function fallbackAlbumMatch(
  client: NavidromeClient,
  artistName: string,
  titles: string[],
): Promise<Map<string, string>> {
  const FALLBACK_PROBE_CAP = 10;
  const matches = new Map<string, string>();
  for (const title of titles.slice(0, FALLBACK_PROBE_CAP)) {
    const data = await probeAlbumsByName(client, title);
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
      if (key !== '' && !matches.has(key)) {
        matches.set(key, id);
      }
    }
  }
  return matches;
}

interface LibraryResolution {
  lookup: LibraryLookup | null;
  note: string | null;
}

/**
 * Library membership degrades to unknown instead of failing the tool (spec §6),
 * and an unresolved artist falls back to probing album titles (spec §4.4).
 */
async function resolveLibraryLookup(
  client: NavidromeClient,
  navResult: PromiseSettledResult<LibraryLookup>,
  artistName: string,
  probeTitles: string[],
): Promise<LibraryResolution> {
  if (navResult.status === 'rejected') {
    logger.warn(`Navidrome library lookup failed: ${String(navResult.reason)}`);
    return { lookup: null, note: 'Navidrome was unreachable; library membership is unknown (inLibrary: null).' };
  }

  const lookup = navResult.value;
  if (lookup.artistId !== null || probeTitles.length === 0) {
    return { lookup, note: null };
  }

  const fallbackMatches = await fallbackAlbumMatch(client, artistName, probeTitles);
  return { lookup: { ...lookup, albumsByNormTitle: fallbackMatches }, note: null };
}

interface MergeInput {
  spine: MbReleaseGroup[];
  lastFmRows: LastFmTopAlbumRow[];
  mbUsable: boolean;
  includeUnverified: boolean;
  includeTypes: string[];
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
  const byNorm = indexLastFmRows(input.lastFmRows);
  const merged: MergedAlbum[] = [];
  const joinedNormKeys = new Set<string>();

  if (input.mbUsable) {
    const included = new Set(input.includeTypes);
    const excluded = new Set(input.excludeSecondary);
    for (const rg of input.spine) {
      // [D] runs before both [F] filters so a filtered match stays joined and never resurfaces as
      // unverified.
      const key = normTitle(rg.title);
      const lastFm = byNorm.get(key) ?? null;
      if (lastFm !== null) joinedNormKeys.add(normTitle(lastFm.name));

      // Secondary types are lowercased at parse, so they compare directly with excludeSecondary.
      if (!included.has((rg.primaryType ?? '').toLowerCase())) continue;
      if (rg.secondaryTypes.some(t => excluded.has(t))) continue;

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

  // Last.fm-only rows cover the long tail MB lacks. They become the entire list when MB is
  // unusable (spec §6).
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
        mbid: null,
        source: 'lastfm-only',
        typeUnverified: true,
        disambiguation: null,
        lastFm: row,
      });
    }
  }

  return merged;
}

interface ShapedAlbums {
  albums: ArtistAlbumDTO[];
  returned: ArtistAlbumDTO[];
  inLibraryCount: number | null;
  missingCount: number | null;
  onlyMissingSkipped: boolean;
}

/** Ranks are assigned before onlyMissing filters, so a rank does not depend on membership. */
function shapeAlbums(
  merged: MergedAlbum[],
  navLookup: LibraryLookup | null,
  onlyMissing: boolean,
  verbose: boolean,
): ShapedAlbums {
  const membershipKnown = navLookup !== null;
  const rankByAlbum = new Map<MergedAlbum, number>();

  [...merged]
    .filter(m => m.lastFm !== null)
    .sort((a, b) => (b.lastFm?.playcount ?? 0) - (a.lastFm?.playcount ?? 0))
    .forEach((m, i) => rankByAlbum.set(m, i + 1));

  const albums: ArtistAlbumDTO[] = merged.map(m => {
    const libraryAlbumId = navLookup?.albumsByNormTitle.get(normTitle(m.title)) ?? null;
    return {
      title: m.title,
      year: m.year,
      primaryType: m.primaryType,
      secondaryTypes: m.secondaryTypes,
      inLibrary: membershipKnown ? libraryAlbumId !== null : null,
      libraryAlbumId,
      genres: m.genres,
      popularityRank: rankByAlbum.get(m) ?? null,
      mbid: m.mbid,
      source: m.source,
      typeUnverified: m.typeUnverified,
      ...(verbose && m.lastFm !== null ? { playcount: m.lastFm.playcount, url: m.lastFm.url } : {}),
      ...(verbose && m.disambiguation !== null ? { disambiguation: m.disambiguation } : {}),
    };
  });

  // The sort is stable, so unranked rows keep spine order at the end.
  albums.sort((a, b) => (a.popularityRank ?? Number.MAX_SAFE_INTEGER) - (b.popularityRank ?? Number.MAX_SAFE_INTEGER));

  return {
    albums,
    returned: onlyMissing && membershipKnown ? albums.filter(a => a.inLibrary === false) : albums,
    inLibraryCount: membershipKnown ? albums.filter(a => a.inLibrary === true).length : null,
    missingCount: membershipKnown ? albums.filter(a => a.inLibrary === false).length : null,
    onlyMissingSkipped: onlyMissing && !membershipKnown,
  };
}

const DEGRADED_SPINE_NOTE =
  'the list is Last.fm top albums with unknown release types and years, and includeTypes/excludeSecondary were not applied, so it can include singles and EPs.';

export async function getArtistAlbums(
  client: NavidromeClient,
  config: Config,
  args: unknown,
): Promise<ArtistAlbumsResult> {
  try {
    const params = ArtistAlbumsSchema.parse(args);

    logger.debug('Tool getArtistAlbums called with args:', {
      artist: params.artist,
      mbid: params.mbid,
      includeTypes: params.includeTypes,
      onlyMissing: params.onlyMissing,
    });

    const apiKey = requireLastFmApiKey(config);
    const notes: string[] = [];

    // Last.fm's mbid= param is unreliable, so the MBID path recovers the canonical name from MB
    // for the Last.fm and Navidrome branches.
    let mbArtist: MbArtistMatch | null = null;
    let mbRequestFailed = false;
    try {
      // Cache keys use the lowercased name, not normTitle. normTitle collides "The Midnight" with
      // "Midnight", and a 24h wrong-artist hit costs more than a duplicate fetch.
      mbArtist = params.mbid !== undefined
        ? await cachedOr(mbArtistCache, `mbid:${params.mbid}`, () => lookupMbArtist(params.mbid as string, config))
        : await cachedOr(mbArtistCache, `name:${(params.artist as string).toLowerCase()}`, () => searchMbArtist(params.artist as string, config));
    } catch (error) {
      mbRequestFailed = true;
      logger.warn(`MusicBrainz artist resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const artistName = params.artist ?? mbArtist?.name;
    if (artistName === undefined) {
      const mbid = String(params.mbid);
      throw new Error(mbRequestFailed
        ? `MusicBrainz was unreachable while resolving mbid ${mbid}, and no artist name was provided. Retry later or pass the artist name.`
        : `No MusicBrainz artist exists for mbid ${mbid}. Pass the artist name instead.`);
    }

    // includeUnverified browses every primary type, so a Last.fm row that MB types as a single or
    // EP joins its release group instead of appearing as unverified.
    const browseTypes = params.includeUnverified ? ['album', 'ep', 'single'] : params.includeTypes;
    const spinePromise: Promise<MbReleaseGroup[]> = mbArtist !== null
      ? cachedOr(
          mbSpineCache,
          `${mbArtist.mbid}|${[...browseTypes].sort().join(',')}`,
          () => browseMbReleaseGroups(mbArtist.mbid, browseTypes, config),
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

    const spine = spineResult.status === 'fulfilled' ? spineResult.value : [];
    if (spineResult.status === 'rejected') {
      mbRequestFailed = true;
      logger.warn(`MusicBrainz browse failed: ${String(spineResult.reason)}`);
    }
    const mbUsable = mbArtist !== null && spineResult.status === 'fulfilled';
    if (mbRequestFailed) {
      notes.push(`MusicBrainz was unreachable; ${DEGRADED_SPINE_NOTE}`);
    } else if (mbArtist === null) {
      notes.push(`Artist not found in MusicBrainz; ${DEGRADED_SPINE_NOTE}`);
    }

    const lastFmRows = lastFmResult.status === 'fulfilled' ? lastFmResult.value : [];
    const lastFmOk = lastFmResult.status === 'fulfilled';
    const lastFmNotFound = lastFmResult.status === 'rejected' && LASTFM_NOT_FOUND.test(String(lastFmResult.reason));
    if (lastFmResult.status === 'rejected') {
      logger.warn(`Last.fm getTopAlbums failed: ${String(lastFmResult.reason)}`);
      notes.push(lastFmNotFound
        ? 'Last.fm has no entry for this artist; popularity ranking is unavailable.'
        : 'Last.fm was unreachable; popularity ranking is unavailable.');
    }

    if (!mbUsable && !lastFmOk) {
      throw new Error(!mbRequestFailed && lastFmNotFound
        ? `No artist matching "${artistName}" was found in MusicBrainz or Last.fm. Check the spelling, or pass a MusicBrainz artist mbid.`
        : `No discography source is available: ${notes.join(' ')}`);
    }

    const merged = mergeSources({
      spine,
      lastFmRows,
      mbUsable,
      includeUnverified: params.includeUnverified,
      includeTypes: params.includeTypes,
      excludeSecondary: params.excludeSecondary,
    });
    const library = await resolveLibraryLookup(client, navResult, artistName, merged.map(m => m.title));
    const navLookup = library.lookup;
    if (library.note !== null) {
      notes.push(library.note);
    }

    const shaped = shapeAlbums(merged, navLookup, params.onlyMissing, params.verbose);
    if (shaped.onlyMissingSkipped) {
      notes.push('onlyMissing was not applied because library membership is unknown.');
    }

    logger.info(
      `get_artist_albums: ${artistName}: spine ${spine.length}, lastfm ${lastFmRows.length}, ` +
      `merged ${merged.length}, returned ${shaped.returned.length}`,
    );

    return {
      artist: {
        name: mbArtist?.name ?? artistName,
        mbid: mbArtist?.mbid ?? params.mbid ?? null,
        navidromeArtistId: navLookup?.artistId ?? null,
      },
      counts: {
        discography: shaped.albums.length,
        inLibrary: shaped.inLibraryCount,
        missing: shaped.missingCount,
        returned: shaped.returned.length,
      },
      sources: {
        musicbrainz: mbUsable,
        lastfm: lastFmOk,
      },
      albums: shaped.returned,
      ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_artist_albums', error));
  }
}

// get_album_info takes the tracklist from MusicBrainz because Last.fm durations and titles are
// incomplete. Last.fm supplies the wiki, tags, and popularity that only it has (spec §9).

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
    /** A MusicBrainz release-group MBID, which this tool accepts back as input. */
    mbid: string | null;
    year: number | null;
    primaryType: string;
    secondaryTypes: string[];
    /** null when Navidrome was unreachable (membership unknown). */
    inLibrary: boolean | null;
    libraryAlbumId: string | null;
  };
  /** MB release-group genres. Falls back to the top 5 genre-like Last.fm tags when MB has none. */
  genres: string[];
  listeners: number | null;
  playcount: number | null;
  /** Last.fm wiki summary, HTML-stripped. null when Last.fm has none. */
  summary: string | null;
  trackCount: number | null;
  tracks: AlbumTrackDTO[];
  tracksSource: 'musicbrainz' | 'lastfm' | null;
  sources: { musicbrainz: boolean; lastfm: boolean };
  // Verbose-only. These come from data already fetched, so verbose adds no requests.
  wikiFull?: string | null;
  lastFmUrl?: string;
  tags?: string[];
  tracklistRelease?: { mbid: string; status: string | null; date: string | null; country: string | null };
  note?: string;
}

const mbRgDetailCache = new Cache<MbReleaseGroupDetail | null>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);
const mbTracklistCache = new Cache<MbTracklist | null>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);
const lastFmAlbumInfoCache = new Cache<LastFmAlbumInfo>(ARTIST_ALBUMS_CACHE_TTL_SECONDS);

/** Test-only: drop cached get_album_info raws so fixtures don't leak across tests. */
export function clearAlbumInfoCachesForTests(): void {
  mbRgDetailCache.clear();
  mbTracklistCache.clear();
  lastFmAlbumInfoCache.clear();
}

/** Last.fm album tags mix genres with shelf tags such as ":3star", "2015", and "albums I own". */
function isGenreLikeTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (trimmed === '' || /^\d{1,4}$/.test(trimmed)) return false;
  if (!/^[\p{L}\p{N}]/u.test(trimmed)) return false;
  if (/\b(?:own(?:ed)?|favou?rites?|seen live|check ?out|wishlist)\b/i.test(trimmed)) return false;
  return true;
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

  // Last.fm omits or reshapes sparse fields, such as a missing tracks key, a lone track as an
  // object, tags as "", or no wiki. Counts arrive as strings (spec §9.4).
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
    const params = AlbumInfoSchema.parse(args);

    logger.debug('Tool getAlbumInfo called with args:', {
      artist: params.artist,
      album: params.album,
      mbid: params.mbid,
    });

    const apiKey = requireLastFmApiKey(config);
    const notes: string[] = [];

    // Last.fm's mbid= param takes a release MBID and rejects release-group MBIDs, so the mbid path
    // recovers the names from MB for the Last.fm and Navidrome branches.
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
      const mbid = String(params.mbid);
      if (mbResolveFailed) {
        throw new Error(`MusicBrainz was unreachable while resolving mbid ${mbid}, and no artist and album names were provided. Retry later or pass the artist and album names.`);
      }
      if (rg === null) {
        throw new Error(`No MusicBrainz release group exists for mbid ${mbid}. Pass artist and album names instead.`);
      }
      throw new Error(`MusicBrainz release group ${mbid} has no artist credit. Pass artist and album names instead.`);
    }

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

    // A tracklist browse failure must not report MB unreachable, since `rg` already holds the
    // year, type, and genres.
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
    const lastFmNotFound = lastFmResult.status === 'rejected' && LASTFM_NOT_FOUND.test(String(lastFmResult.reason));
    if (lastFmResult.status === 'rejected') {
      logger.warn(`Last.fm album.getInfo failed: ${String(lastFmResult.reason)}`);
      notes.push(lastFmNotFound
        ? 'Last.fm has no entry for this album; popularity, wiki, and tags are unavailable.'
        : 'Last.fm was unreachable; popularity, wiki, and tags are unavailable.');
    }

    if (!mbUsable && lastFm === null) {
      throw new Error(!mbResolveFailed && lastFmNotFound
        ? `Album "${albumTitle}" by "${artistName}" was not found in MusicBrainz or Last.fm. Check the title, or call get_artist_albums for exact titles and mbids.`
        : `No album info source is available: ${notes.join(' ')}`);
    }

    const probeTitles = rg !== null && rg.title !== albumTitle ? [albumTitle, rg.title] : [albumTitle];
    const library = await resolveLibraryLookup(client, navResult, artistName, probeTitles);
    const navLookup = library.lookup;
    if (library.note !== null) {
      notes.push(library.note);
    }
    const libraryAlbumId =
      navLookup?.albumsByNormTitle.get(normTitle(albumTitle))
      ?? (rg !== null ? navLookup?.albumsByNormTitle.get(normTitle(rg.title)) : undefined)
      ?? null;

    const mbTracks: MbTrack[] = mbTracklist?.tracks ?? [];
    const tracks: AlbumTrackDTO[] = mbTracks.length > 0 ? mbTracks : lastFm?.tracks ?? [];
    const tracksSource: 'musicbrainz' | 'lastfm' | null =
      mbTracks.length > 0 ? 'musicbrainz' : tracks.length > 0 ? 'lastfm' : null;
    if (tracksSource === null) {
      notes.push('No tracklist is available from either source.');
    }

    // Tags are lowercased to match MB genres, which parse lowercased. Search-resolved RGs carry no
    // genres, so the names path usually falls back to tags.
    const genres = rg !== null && rg.genres.length > 0
      ? rg.genres
      : (lastFm?.tags ?? []).filter(isGenreLikeTag).slice(0, 5).map(t => t.toLowerCase());

    logger.info(
      `get_album_info: ${artistName}: ${albumTitle}: tracks=${String(tracks.length)} (${tracksSource ?? 'none'}), ` +
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
    throw new Error(ErrorFormatter.toolExecution('get_album_info', error));
  }
}
