/**
 * Navidrome MCP Server - Search Orchestration
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

import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { SongDTO, AlbumDTO, ArtistDTO } from '../../types/index.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';
import { SearchAllSchema } from '../../schemas/index.js';
import { resolveTextFilters } from './filter-resolver.js';
import { buildContentTypeParams, aggregateSearchResults, type ParallelSearchResponses } from './result-aggregator.js';

/**
 * Search across all content types (artists, albums, songs) with enhanced filtering
 * Uses parallel requests for optimal performance and supports text-based filters
 *
 * This is the main search orchestrator that coordinates multiple search types,
 * resolves text-based filters to IDs, and aggregates results from parallel API calls.
 *
 * @param client - Navidrome client for API requests
 * @param _config - Configuration object (unused but kept for API consistency)
 * @param args - Search parameters including query, counts, filters, and sorting options
 * @returns Promise resolving to aggregated search results across all content types
 */
export async function searchAll(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  query: string;
  totalResults: number;
  appliedFilters?: Record<string, string>;
}> {
  // Data collection - parse and validate input parameters
  const params = SearchAllSchema.parse(args);

  try {
    // Processing - resolve text-based filters to IDs
    const { resolvedFilters, appliedFilters } = resolveTextFilters(params);

    // Build enhanced query parameters for each content type
    const contentTypeParams = buildContentTypeParams({
      artistCount: params.artistCount,
      albumCount: params.albumCount,
      songCount: params.songCount,
      query: params.query,
      sort: params.sort,
      order: params.order,
      randomSeed: params.randomSeed,
      resolvedFilters,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      starred: params.starred
    });

    logger.debug('Enhanced search parameters:', {
      songParams: contentTypeParams.songParams,
      albumParams: contentTypeParams.albumParams,
      artistParams: contentTypeParams.artistParams,
      appliedFilters,
    });

    // Make parallel requests using the client's library filtering
    const [songsResponse, albumsResponse, artistsResponse] = await Promise.all([
      client.requestWithLibraryFilter<unknown[]>(`/song?${contentTypeParams.songParams}`),
      client.requestWithLibraryFilter<unknown[]>(`/album?${contentTypeParams.albumParams}`),
      client.requestWithLibraryFilter<unknown[]>(`/artist?${contentTypeParams.artistParams}`),
    ]);

    // Prepare responses for aggregation
    const responses: ParallelSearchResponses = {
      songsResponse,
      albumsResponse,
      artistsResponse
    };

    // Output construction - aggregate results from all search types
    const result = aggregateSearchResults(responses, params.query, appliedFilters);

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchAll', error));
  }
}