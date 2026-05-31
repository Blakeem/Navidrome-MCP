/**
 * Navidrome MCP Server - Search Result Aggregation
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

import type { SongDTO, AlbumDTO, ArtistDTO } from '../../types/index.js';
import { transformSongsToDTO, transformAlbumsToDTO, transformArtistsToDTO } from '../../transformers/index.js';
import { logger } from '../../utils/logger.js';
import { mapSortField, stripUnsupportedFilters, type SearchEndpoint } from './filter-resolver.js';

/**
 * Raw API response data from parallel search requests
 */
export interface ParallelSearchResponses {
  songsResponse: unknown[];
  albumsResponse: unknown[];
  artistsResponse: unknown[];
}

/**
 * Per-type total counts captured from each sub-fetch's X-Total-Count header.
 * `null` means the header was absent or unparseable; aggregator falls back
 * to the array length at the call site.
 */
export interface ParallelSearchTotals {
  songsTotal: number | null;
  albumsTotal: number | null;
  artistsTotal: number | null;
}

/**
 * Per-content-type view of the filters that were *actually honored* by each
 * sub-fetch. Navidrome's `/api/artist` silently ignores tag/year filters (no
 * such columns), so a single shared `appliedFilters` over-claimed for the
 * artist slice in a mixed result. Reporting per type keeps the claim truthful:
 * `songs`/`albums` carry the tag+year filters they honor; `artists` only
 * carries filters the artist endpoint actually applies (e.g. `starred`).
 *
 * A type's entry is omitted entirely when no filters applied to that slice, so
 * an unfiltered query still yields no `appliedFilters` at all (see the
 * non-empty guard in {@link aggregateSearchResults}).
 */
export interface AppliedFiltersByType {
  songs?: Record<string, string>;
  albums?: Record<string, string>;
  artists?: Record<string, string>;
}

/**
 * Aggregated search results with metadata. The per-type totals (`totalSongs`,
 * `totalAlbums`, `totalArtists`) reflect the server's full match count for
 * each type — the LLM uses these to know whether more results exist beyond
 * the current page. `totalResults` is the sum so the LLM has a single number
 * to report. The original query is intentionally NOT echoed (LLM already
 * knows what it asked for); it surfaces in DEBUG logs only.
 *
 * `appliedFilters` is reported per content type (see {@link AppliedFiltersByType})
 * so the artist slice never claims tag/year filters that `/api/artist` ignores.
 */
interface AggregatedSearchResult {
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  totalArtists: number;
  totalAlbums: number;
  totalSongs: number;
  totalResults: number;
  appliedFilters?: AppliedFiltersByType;
}

/**
 * Transform and aggregate parallel search responses into a unified result
 * Handles the transformation of raw API responses to DTOs and combines them with metadata
 *
 * @param responses - Raw responses from parallel API calls
 * @param totals - Per-type totals from X-Total-Count (null falls back to array length)
 * @param appliedFilters - The full set of resolved filters (display-name keys)
 *   the caller requested. This is split per content type here: the song/album
 *   slices keep all of them; the artist slice drops tag/year (which `/api/artist`
 *   ignores) so the reported `appliedFilters` is truthful for every slice.
 * @returns Aggregated search result with transformed DTOs and metadata
 */
export function aggregateSearchResults(
  responses: ParallelSearchResponses,
  totals: ParallelSearchTotals,
  appliedFilters: Record<string, string>
): AggregatedSearchResult {
  // Data collection - extract responses
  const { songsResponse, albumsResponse, artistsResponse } = responses;

  // Processing - transform responses to DTOs
  const songs = transformSongsToDTO(songsResponse);
  const albums = transformAlbumsToDTO(albumsResponse);
  const artists = transformArtistsToDTO(artistsResponse);

  // Resolve per-type totals — header value if available, else page size.
  const totalSongs = totals.songsTotal ?? songs.length;
  const totalAlbums = totals.albumsTotal ?? albums.length;
  const totalArtists = totals.artistsTotal ?? artists.length;
  const totalResults = totalSongs + totalAlbums + totalArtists;

  logger.debug(`Enhanced search completed: ${totalResults} total (${totalSongs} songs / ${totalAlbums} albums / ${totalArtists} artists), returned ${songs.length}/${albums.length}/${artists.length}`);

  // Output construction - build aggregated result
  const result: AggregatedSearchResult = {
    artists,
    albums,
    songs,
    totalArtists,
    totalAlbums,
    totalSongs,
    totalResults,
  };

  // Report appliedFilters per content type so each slice's claim is truthful.
  // Songs/albums honor every resolved filter; artists drop tag/year (which
  // /api/artist silently ignores) via stripUnsupportedFilters. A type entry is
  // included only when that slice actually had filters applied, so an entirely
  // unfiltered query still emits no `appliedFilters` at all.
  if (Object.keys(appliedFilters).length > 0) {
    const songFilters = stripUnsupportedFilters(appliedFilters, 'song', true);
    const albumFilters = stripUnsupportedFilters(appliedFilters, 'album', true);
    const artistFilters = stripUnsupportedFilters(appliedFilters, 'artist', true);

    const byType: AppliedFiltersByType = {};
    if (Object.keys(songFilters).length > 0) byType.songs = songFilters;
    if (Object.keys(albumFilters).length > 0) byType.albums = albumFilters;
    if (Object.keys(artistFilters).length > 0) byType.artists = artistFilters;

    if (Object.keys(byType).length > 0) {
      result.appliedFilters = byType;
    }
  }

  return result;
}

/**
 * Parameters for building URL search parameters for different content types
 */
interface SearchParamsConfig {
  artistCount: number;
  albumCount: number;
  songCount: number;
  query: string;
  // Same offset applied to all 3 sub-fetches — see SearchAllSchema for why.
  offset: number;
  sort?: string | undefined;
  order?: 'ASC' | 'DESC' | undefined;
  randomSeed?: number | undefined;
  resolvedFilters: Record<string, string>;
  // Single-year filter only. Navidrome has no year-range filter — see
  // filter-resolver.ts for the per-endpoint semantics.
  year?: number | undefined;
  starred?: boolean | undefined;
}

/**
 * Result of building search parameters for different content types
 */
interface ContentTypeParams {
  songParams: string;
  albumParams: string;
  artistParams: string;
}

/**
 * Build URL search parameters for different content types with appropriate sort fields
 * Each content type (songs, albums, artists) may have different optimal sort fields
 *
 * @param config - Configuration for building search parameters
 * @returns Object containing URL parameters for each content type
 */
export function buildContentTypeParams(config: SearchParamsConfig): ContentTypeParams {
  // Data collection - extract configuration values
  const { artistCount, albumCount, songCount, query, offset, sort, order, randomSeed, resolvedFilters, year, starred } = config;

  // Processing - create parameter building function
  const buildParams = (
    limit: number,
    searchField: string,
    sortField: string,
    endpoint: SearchEndpoint
  ): string => {
    const searchParams = new URLSearchParams();

    // Add pagination
    searchParams.set('_start', offset.toString());
    searchParams.set('_end', (offset + limit).toString());

    // Add search term as direct parameter (only if not empty)
    if (query !== '' && query.trim() !== '') {
      searchParams.set(searchField, query);
    }

    // Add sorting
    searchParams.set('_sort', sortField);
    searchParams.set('_order', order ?? 'ASC');

    // Add random seed if using random sort
    if (sortField === 'random' && randomSeed !== undefined) {
      searchParams.set('seed', randomSeed.toString());
    }

    // Add resolved filters, dropping any the endpoint silently ignores
    // (tag/year on /api/artist) so we don't send dead params there.
    Object.entries(stripUnsupportedFilters(resolvedFilters, endpoint, false)).forEach(([key, value]) => {
      searchParams.set(key, value);
    });

    // Add boolean filters
    if (starred !== undefined) {
      searchParams.set('starred', starred.toString());
    }

    // Single-year filter — albums match by [minYear, maxYear] containing N,
    // songs match the year column exactly, artists ignore it (no column), so
    // skip it for the artist endpoint rather than send a no-op param.
    if (year !== undefined && endpoint !== 'artist') {
      searchParams.set('year', year.toString());
    }

    return searchParams.toString();
  };

  // Determine appropriate sort field for each endpoint.
  // `endpoint` drives endpoint-specific aliases (see `mapSortField`) — e.g.
  // `_sort=year` is silently ignored by `/api/album`, which has no `year`
  // column; we map it to `maxYear` so DESC ordering returns newest albums.
  const getSortField = (defaultSort: string, endpoint: SearchEndpoint): string => {
    const requestedSort = sort ?? defaultSort;

    // Map common sort fields to endpoint-specific ones
    let mapped: string;
    switch (requestedSort) {
      case 'name':
        // The song endpoint sorts by `title`; albums/artists sort by `name`.
        // Discriminate on the endpoint itself rather than the `defaultSort`
        // sentinel so the mapping stays correct if the per-endpoint defaults
        // are ever reshuffled.
        mapped = endpoint === 'song' ? 'title' : 'name';
        break;
      case 'recently_added':
      case 'starred_at':
      case 'random':
        mapped = requestedSort;
        break;
      default:
        mapped = requestedSort;
    }
    return mapSortField(mapped, endpoint);
  };

  // Output construction - build parameters for each endpoint type with appropriate sort fields
  const songParams = buildParams(songCount, 'title', getSortField('title', 'song'), 'song');
  const albumParams = buildParams(albumCount, 'name', getSortField('name', 'album'), 'album');
  const artistParams = buildParams(artistCount, 'name', getSortField('name', 'artist'), 'artist');

  return {
    songParams,
    albumParams,
    artistParams
  };
}