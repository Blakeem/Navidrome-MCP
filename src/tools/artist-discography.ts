/**
 * Navidrome MCP Server - Artist Discography Tools
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

// === get_artist_albums =======================================================
//
// Full discography with types/years/genres (MusicBrainz spine), popularity
// (Last.fm enrichment), and in-library flags (Navidrome). Pipeline + decisions:
// docs/ARTIST-ALBUMS-SPEC.md.

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
  // verbose-only (already in hand from the spine/join, never extra requests)
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

// Raw per-source caches (24h: discographies change rarely, spec §8). The
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

// Last.fm error 6 texts, specific enough to skip an HTTP "404 Not Found" status line.
const LASTFM_NOT_FOUND = /album not found|could not be found/i;

async function fetchTopAlbums(artist: string, apiKey: string): Promise<LastFmTopAlbumRow[]> {
  // ONE page only: rank beyond the top 100 carries no popularity signal.
  // Spine albums that miss the join get popularityRank null.
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

/**
 * Junk-drop + normTitle-dedup (keep the highest-playcount variant), keyed by
 * normalized title for the spine join. Last.fm exposes only release MBIDs, so MBIDs cannot join.
 */
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

// --- Navidrome branch ---------------------------------------------------------

interface LibraryLookup {
  /** Primary resolved Navidrome artist id (first accepted match). */
  artistId: string | null;
  /** normTitle(album name) → Navidrome album id, across ALL accepted artist ids. */
  albumsByNormTitle: Map<string, string>;
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
 * surface. `likelySameArtist` then decides what actually counts.
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
  // Resolve artist id(s). Collect ALL close matches, not just one (spec §4).
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
  };
}

/** One failed probe must not fail the whole tool, since library membership degrades per title. */
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
 * Fallback when name-resolution found no Navidrome artist (heavy aliasing):
 * probe a capped number of discography titles by album name and accept only
 * on a normalized artist-name match (spec §4 step 4).
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

// --- Orchestration ------------------------------------------------------------

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
      // [D] joins by normalized title, since Last.fm exposes only release MBIDs. It runs before
      // both [F] filters so a filtered match stays joined and never resurfaces as unverified.
      const key = normTitle(rg.title);
      const lastFm = byNorm.get(key) ?? null;
      if (lastFm !== null) joinedNormKeys.add(normTitle(lastFm.name));

      // [F] primary-type filter, then secondary-type exclusion (secondary types lowercased at parse).
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

  // Last.fm-only rows: the long tail MB lacks. Reached two ways: explicit
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

/** Ranks span the full filtered discography before onlyMissing, so they stay stable whatever the membership filter does. */
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

  // Most-listened first reads naturally. Unranked rows keep spine order at the end.
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

    // -- Resolve the MB artist (search by name, or lookup when MBID given).
    //    Last.fm's own mbid= param is unreliable, so the MBID path recovers
    //    the canonical name from MB for the other two branches.
    let mbArtist: MbArtistMatch | null = null;
    let mbRequestFailed = false;
    try {
      // Cache keys use the raw lowercased name, NOT normTitle. Normalization is
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
      const mbid = String(params.mbid);
      throw new Error(mbRequestFailed
        ? `MusicBrainz was unreachable while resolving mbid ${mbid}, and no artist name was provided. Retry later or pass the artist name.`
        : `No MusicBrainz artist exists for mbid ${mbid}. Pass the artist name instead.`);
    }

    // -- Fan out the three branches. MB is internally serialized at 1 req/s.
    //    Last.fm and Navidrome run alongside.
    // includeUnverified browses every primary type so a Last.fm row MB types as a single or EP joins instead of leaking.
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

    // -- Degradation accounting (spec §6: degrade, not fail).
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

    // -- [D]/[E]/[F] merge, enrich, type-filter, then [G] library compare.
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

// === get_album_info ===========================================================
//
// Single-album deep dive, the companion to get_artist_albums (spec §9).
// MusicBrainz is primary for the tracklist because its durations and titles are
// complete where Last.fm's are not. Last.fm supplies the wiki, tags and popularity only it has.

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
  /** MB release-group genres. Falls back to top-5 Last.fm tags when MB has none. */
  genres: string[];
  listeners: number | null;
  playcount: number | null;
  /** Last.fm wiki summary, HTML-stripped. null when Last.fm has none. */
  summary: string | null;
  trackCount: number | null;
  tracks: AlbumTrackDTO[];
  tracksSource: 'musicbrainz' | 'lastfm' | null;
  sources: { musicbrainz: boolean; lastfm: boolean };
  // verbose-only (already in hand, never extra requests)
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
 * Last.fm album tags mix genres with user shelf-keeping noise (observed live:
 * ":3star", "2015", "albums I own", "seen live"). Keep only genre-like tags
 * for the `genres` fallback. The verbose `tags` field keeps the raw list.
 */
function isGenreLikeTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (trimmed === '' || /^\d{1,4}$/.test(trimmed)) return false; // bare years/numbers
  if (!/^[\p{L}\p{N}]/u.test(trimmed)) return false; // punctuation-led (":3star")
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

  // Last.fm drops or reshapes sparse fields (no tracks key, object-form single track,
  // tags as "", no wiki) and sends counts as strings (verified live, spec §9.4).
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

    // -- Resolve the MB release group: lookup when an mbid is given (recovers
    //    canonical title/artist for the other branches), else name search.
    //    Last.fm's own mbid= param is NEVER used. It wants a release MBID and
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
      const mbid = String(params.mbid);
      if (mbResolveFailed) {
        throw new Error(`MusicBrainz was unreachable while resolving mbid ${mbid}, and no artist and album names were provided. Retry later or pass the artist and album names.`);
      }
      if (rg === null) {
        throw new Error(`No MusicBrainz release group exists for mbid ${mbid}. Pass artist and album names instead.`);
      }
      throw new Error(`MusicBrainz release group ${mbid} has no artist credit. Pass artist and album names instead.`);
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
    //    the tracklist browse are distinct MB calls. A browse failure must not
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

    // -- Library compare.
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
