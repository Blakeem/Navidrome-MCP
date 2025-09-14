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

/**
 * Raw API response data from parallel search requests
 */
export interface ParallelSearchResponses {
  songsResponse: unknown[];
  albumsResponse: unknown[];
  artistsResponse: unknown[];
}

/**
 * Aggregated search results with metadata
 */
interface AggregatedSearchResult {
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  query: string;
  totalResults: number;
  appliedFilters?: Record<string, string>;
}

/**
 * Transform and aggregate parallel search responses into a unified result
 * Handles the transformation of raw API responses to DTOs and combines them with metadata
 *
 * @param responses - Raw responses from parallel API calls
 * @param query - Original search query string
 * @param appliedFilters - Filters that were successfully applied to the search
 * @returns Aggregated search result with transformed DTOs and metadata
 */
export function aggregateSearchResults(
  responses: ParallelSearchResponses,
  query: string,
  appliedFilters: Record<string, string>
): AggregatedSearchResult {
  // Data collection - extract responses
  const { songsResponse, albumsResponse, artistsResponse } = responses;

  // Processing - transform responses to DTOs
  const songs = transformSongsToDTO(songsResponse);
  const albums = transformAlbumsToDTO(albumsResponse);
  const artists = transformArtistsToDTO(artistsResponse);

  // Calculate total results across all content types
  const totalResults = songs.length + albums.length + artists.length;

  logger.debug(`Enhanced search completed: ${totalResults} total results (${songs.length} songs, ${albums.length} albums, ${artists.length} artists)`);

  // Output construction - build aggregated result
  const result: AggregatedSearchResult = {
    artists,
    albums,
    songs,
    query,
    totalResults,
  };

  // Only include appliedFilters if any filters were applied
  if (Object.keys(appliedFilters).length > 0) {
    result.appliedFilters = appliedFilters;
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
  sort?: string | undefined;
  order?: 'ASC' | 'DESC' | undefined;
  randomSeed?: number | undefined;
  resolvedFilters: Record<string, string>;
  yearFrom?: number | undefined;
  yearTo?: number | undefined;
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
  const { artistCount, albumCount, songCount, query, sort, order, randomSeed, resolvedFilters, yearFrom, yearTo, starred } = config;

  // Processing - create parameter building function
  const buildParams = (
    limit: number,
    searchField: string,
    sortField: string
  ): string => {
    const searchParams = new URLSearchParams();

    // Add pagination
    searchParams.set('_start', '0');
    searchParams.set('_end', limit.toString());

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

    // Add resolved filters
    Object.entries(resolvedFilters).forEach(([key, value]) => {
      searchParams.set(key, value);
    });

    // Add boolean filters
    if (starred !== undefined) {
      searchParams.set('starred', starred.toString());
    }

    // Add year filtering (for albums and songs)
    if (yearFrom !== undefined) {
      searchParams.set('year_from', yearFrom.toString());
    }
    if (yearTo !== undefined) {
      searchParams.set('year_to', yearTo.toString());
    }

    return searchParams.toString();
  };

  // Determine appropriate sort field for each endpoint
  const getSortField = (defaultSort: string): string => {
    const requestedSort = sort ?? defaultSort;

    // Map common sort fields to endpoint-specific ones
    switch (requestedSort) {
      case 'name': return defaultSort === 'title' ? 'title' : 'name';
      case 'recently_added': return 'recently_added';
      case 'starred_at': return 'starred_at';
      case 'random': return 'random';
      default: return requestedSort;
    }
  };

  // Output construction - build parameters for each endpoint type with appropriate sort fields
  const songParams = buildParams(songCount, 'title', getSortField('title'));
  const albumParams = buildParams(albumCount, 'name', getSortField('name'));
  const artistParams = buildParams(artistCount, 'name', getSortField('name'));

  return {
    songParams,
    albumParams,
    artistParams
  };
}