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
import {
  buildContentTypeParams,
  aggregateSearchResults,
  type ParallelSearchResponses,
  type ParallelSearchTotals,
} from './result-aggregator.js';

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
  totalArtists: number;
  totalAlbums: number;
  totalSongs: number;
  totalResults: number;
  appliedFilters?: Record<string, string>;
}> {
  // Data collection - parse and validate input parameters
  const params = SearchAllSchema.parse(args);
  logger.debug('Tool searchAll called with args:', params);

  try {
    // Processing - resolve text-based filters to IDs (may refresh from Navidrome when cache is disabled)
    const { resolvedFilters, appliedFilters } = await resolveTextFilters(params);

    // Build enhanced query parameters for each content type. Same offset
    // applied to all 3 types — see SearchAllSchema for rationale.
    const contentTypeParams = buildContentTypeParams({
      artistCount: params.artistCount,
      albumCount: params.albumCount,
      songCount: params.songCount,
      query: params.query,
      offset: params.offset,
      sort: params.sort,
      order: params.order,
      randomSeed: params.randomSeed,
      resolvedFilters,
      year: params.year,
      starred: params.starred
    });

    logger.debug('Enhanced search parameters:', {
      songParams: contentTypeParams.songParams,
      albumParams: contentTypeParams.albumParams,
      artistParams: contentTypeParams.artistParams,
      offset: params.offset,
      appliedFilters,
    });

    // Make parallel requests using the client's library filtering. The *Meta
    // variant gives us X-Total-Count for each type so the LLM can tell
    // "page-of-3 with 200 songs available" from "page-of-3 with 3 total".
    //
    // Skip the fetch entirely when a count is 0 — sending `_start=N&_end=N`
    // (LIMIT 0 OFFSET N) trips a SQL error in Navidrome for offset>0. Saves
    // a round-trip too: if the LLM didn't ask for artists, we shouldn't
    // hit /api/artist at all. Each empty placeholder uses a fresh array
    // so future downstream code can mutate without aliasing across types.
    const empty = (): { data: unknown[]; total: null } => ({ data: [], total: null });
    const [songs, albums, artists] = await Promise.all([
      params.songCount > 0
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/song?${contentTypeParams.songParams}`)
        : Promise.resolve(empty()),
      params.albumCount > 0
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/album?${contentTypeParams.albumParams}`)
        : Promise.resolve(empty()),
      params.artistCount > 0
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/artist?${contentTypeParams.artistParams}`)
        : Promise.resolve(empty()),
    ]);

    // Prepare responses for aggregation
    const responses: ParallelSearchResponses = {
      songsResponse: songs.data,
      albumsResponse: albums.data,
      artistsResponse: artists.data,
    };
    const totals: ParallelSearchTotals = {
      songsTotal: songs.total,
      albumsTotal: albums.total,
      artistsTotal: artists.total,
    };

    // Output construction - aggregate results from all search types
    const result = aggregateSearchResults(responses, totals, appliedFilters);

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchAll', error));
  }
}