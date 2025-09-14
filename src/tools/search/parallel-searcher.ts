/**
 * Navidrome MCP Server - Parallel Search Operations
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
import { transformSongsToDTO, transformAlbumsToDTO, transformArtistsToDTO } from '../../transformers/index.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';
import {
  SearchSongsSchema,
  SearchAlbumsSchema,
  SearchArtistsSchema,
} from '../../schemas/index.js';
import { buildEnhancedSearchParams } from './filter-resolver.js';

/**
 * Search for songs by title with enhanced filtering
 * Provides comprehensive song search with text-based filter resolution
 *
 * @param client - Navidrome client for API requests
 * @param _config - Configuration object (unused but kept for API consistency)
 * @param args - Search parameters including query, filters, and pagination options
 * @returns Promise resolving to song search results with metadata
 */
export async function searchSongs(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  songs: SongDTO[];
  query: string;
  total: number;
  offset: number;
  limit: number;
  appliedFilters?: Record<string, string>;
}> {
  // Data collection - parse and validate input parameters
  const params = SearchSongsSchema.parse(args);

  try {
    // Processing - build enhanced search parameters with filter resolution
    const { searchParams, appliedFilters } = buildEnhancedSearchParams(params, 'title', 'title');

    logger.debug('Enhanced song search parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/song?${searchParams}`);

    // Transform response to DTOs
    const songs = transformSongsToDTO(response);

    logger.debug(`Song search completed: ${songs.length} results`);

    // Output construction - build result object with conditional applied filters
    const result = {
      songs,
      query: params.query,
      total: songs.length,
      offset: params.offset ?? 0,
      limit: params.limit,
    };

    // Only include appliedFilters if any filters were applied
    if (Object.keys(appliedFilters).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).appliedFilters = appliedFilters;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchSongs', error));
  }
}

/**
 * Search for albums by name with enhanced filtering
 * Provides comprehensive album search with text-based filter resolution
 *
 * @param client - Navidrome client for API requests
 * @param _config - Configuration object (unused but kept for API consistency)
 * @param args - Search parameters including query, filters, and pagination options
 * @returns Promise resolving to album search results with metadata
 */
export async function searchAlbums(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  albums: AlbumDTO[];
  query: string;
  total: number;
  offset: number;
  limit: number;
  appliedFilters?: Record<string, string>;
}> {
  // Data collection - parse and validate input parameters
  const params = SearchAlbumsSchema.parse(args);

  try {
    // Processing - build enhanced search parameters with filter resolution
    const { searchParams, appliedFilters } = buildEnhancedSearchParams(params, 'name', 'name');

    logger.debug('Enhanced album search parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/album?${searchParams}`);

    // Transform response to DTOs
    const albums = transformAlbumsToDTO(response);

    logger.debug(`Album search completed: ${albums.length} results`);

    // Output construction - build result object with conditional applied filters
    const result = {
      albums,
      query: params.query,
      total: albums.length,
      offset: params.offset ?? 0,
      limit: params.limit,
    };

    // Only include appliedFilters if any filters were applied
    if (Object.keys(appliedFilters).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).appliedFilters = appliedFilters;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchAlbums', error));
  }
}

/**
 * Search for artists by name with enhanced filtering
 * Provides comprehensive artist search with text-based filter resolution
 * Uses role=maincredit for comprehensive artist listing
 *
 * @param client - Navidrome client for API requests
 * @param _config - Configuration object (unused but kept for API consistency)
 * @param args - Search parameters including query, filters, and pagination options
 * @returns Promise resolving to artist search results with metadata
 */
export async function searchArtists(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  query: string;
  total: number;
  offset: number;
  limit: number;
  appliedFilters?: Record<string, string>;
}> {
  // Data collection - parse and validate input parameters
  const params = SearchArtistsSchema.parse(args);

  try {
    // Processing - build enhanced search params with role=maincredit for comprehensive artist listing
    const { searchParams: baseParams, appliedFilters } = buildEnhancedSearchParams(params, 'name', 'name');
    const searchParams = `${baseParams}&role=maincredit`;

    logger.debug('Enhanced artist search parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/artist?${searchParams}`);

    // Transform response to DTOs
    const artists = transformArtistsToDTO(response);

    logger.debug(`Artist search completed: ${artists.length} results`);

    // Output construction - build result object with conditional applied filters
    const result = {
      artists,
      query: params.query,
      total: artists.length,
      offset: params.offset ?? 0,
      limit: params.limit,
    };

    // Only include appliedFilters if any filters were applied
    if (Object.keys(appliedFilters).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).appliedFilters = appliedFilters;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchArtists', error));
  }
}