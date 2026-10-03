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
import type { TransformOptions } from '../../transformers/shared-transformers.js';
import { logger } from '../../utils/logger.js';
import {
  buildSearchUrlParams,
  mapSortField,
  stripUnsupportedAppliedFilters,
  type SearchEndpoint,
} from './filter-resolver.js';

export interface ParallelSearchResponses {
  songsResponse: unknown[];
  albumsResponse: unknown[];
  artistsResponse: unknown[];
}

/** X-Total-Count per type. `null` means the header was absent and the page length stands in. */
export interface ParallelSearchTotals {
  songsTotal: number | null;
  albumsTotal: number | null;
  artistsTotal: number | null;
}

/** Filters each slice honored. A slice with no honored filters has no entry. */
export interface AppliedFiltersByType {
  songs?: Record<string, string>;
  albums?: Record<string, string>;
  artists?: Record<string, string>;
}

/** Per-type totals are server match counts, so the LLM can tell whether more pages exist. */
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

function splitAppliedFilters(appliedFilters: Record<string, string>): AppliedFiltersByType {
  const byType: AppliedFiltersByType = {};
  const songFilters = stripUnsupportedAppliedFilters(appliedFilters, 'song');
  const albumFilters = stripUnsupportedAppliedFilters(appliedFilters, 'album');
  const artistFilters = stripUnsupportedAppliedFilters(appliedFilters, 'artist');

  if (Object.keys(songFilters).length > 0) byType.songs = songFilters;
  if (Object.keys(albumFilters).length > 0) byType.albums = albumFilters;
  if (Object.keys(artistFilters).length > 0) byType.artists = artistFilters;

  return byType;
}

export function aggregateSearchResults(
  responses: ParallelSearchResponses,
  totals: ParallelSearchTotals,
  appliedFilters: Record<string, string>,
  transformOptions: TransformOptions = {}
): AggregatedSearchResult {
  const { songsResponse, albumsResponse, artistsResponse } = responses;

  const songs = transformSongsToDTO(songsResponse, transformOptions);
  const albums = transformAlbumsToDTO(albumsResponse, transformOptions);
  const artists = transformArtistsToDTO(artistsResponse, transformOptions);
  const totalSongs = totals.songsTotal ?? songs.length;
  const totalAlbums = totals.albumsTotal ?? albums.length;
  const totalArtists = totals.artistsTotal ?? artists.length;
  const totalResults = totalSongs + totalAlbums + totalArtists;
  const appliedByType = splitAppliedFilters(appliedFilters);

  logger.debug(`Enhanced search completed: ${totalResults} total (${totalSongs} songs / ${totalAlbums} albums / ${totalArtists} artists), returned ${songs.length}/${albums.length}/${artists.length}`);

  return {
    artists,
    albums,
    songs,
    totalArtists,
    totalAlbums,
    totalSongs,
    totalResults,
    ...(Object.keys(appliedByType).length > 0 ? { appliedFilters: appliedByType } : {}),
  };
}

interface SearchParamsConfig {
  artistCount: number;
  albumCount: number;
  songCount: number;
  query: string;
  offset: number;
  sort?: string | undefined;
  order?: 'ASC' | 'DESC' | undefined;
  randomSeed?: number | undefined;
  resolvedFilters: Record<string, string>;
  year?: number | undefined;
  starred?: boolean | undefined;
}

interface ContentTypeParams {
  songParams: string;
  albumParams: string;
  artistParams: string;
}

// /api/artist has none of these columns and returns its default order for them.
const ARTIST_NAME_FALLBACK_SORTS: ReadonlySet<string> = new Set(['title', 'album', 'artist', 'year', 'duration', 'recently_added']);

// Only the search_all sort enum spans all three types, so its keys need per-endpoint aliases.
function getSortField(requestedSort: string, endpoint: SearchEndpoint): string {
  if (endpoint === 'artist' && ARTIST_NAME_FALLBACK_SORTS.has(requestedSort)) {
    return 'name';
  }
  if (requestedSort === 'name' || requestedSort === 'title') {
    return endpoint === 'song' ? 'title' : 'name';
  }
  if (requestedSort === 'album') {
    return endpoint === 'song' ? 'album' : 'name';
  }
  return mapSortField(requestedSort, endpoint);
}

export function buildContentTypeParams(config: SearchParamsConfig): ContentTypeParams {
  const { artistCount, albumCount, songCount, sort } = config;
  const shared = {
    query: config.query,
    offset: config.offset,
    order: config.order,
    randomSeed: config.randomSeed,
    resolvedFilters: config.resolvedFilters,
    starred: config.starred,
    year: config.year,
  };

  const songParams = buildSearchUrlParams({
    ...shared, endpoint: 'song', searchField: 'title', limit: songCount, sortField: getSortField(sort ?? 'title', 'song'),
  });
  const albumParams = buildSearchUrlParams({
    ...shared, endpoint: 'album', searchField: 'name', limit: albumCount, sortField: getSortField(sort ?? 'name', 'album'),
  });
  const artistParams = buildSearchUrlParams({
    ...shared, endpoint: 'artist', searchField: 'name', limit: artistCount, sortField: getSortField(sort ?? 'name', 'artist'),
  });

  return { songParams, albumParams, artistParams };
}
