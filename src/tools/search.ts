/**
 * Navidrome MCP Server - Search Tools
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

import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { transformSongsToDTO, transformAlbumsToDTO, transformArtistsToDTO } from '../transformers/song-transformer.js';
import type { SongDTO, AlbumDTO, ArtistDTO } from '../types/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { filterCacheManager } from '../services/filter-cache-manager.js';
import { logger } from '../utils/logger.js';
import {
  SearchAllSchema,
  SearchSongsSchema,
  SearchAlbumsSchema,
  SearchArtistsSchema,
  ListSongsSchema,
  ListAlbumsSchema,
  ListArtistsSchema,
} from '../schemas/index.js';

/**
 * Search across all content types (artists, albums, songs) with enhanced filtering
 * Uses parallel requests for optimal performance and supports text-based filters
 */
export async function searchAll(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  query: string;
  totalResults: number;
  appliedFilters?: Record<string, string>;
}> {
  const params = SearchAllSchema.parse(args);

  try {
    // Resolve text-based filters to IDs
    const resolvedFilters: Record<string, string> = {};
    const appliedFilters: Record<string, string> = {};

    if (params.genre !== undefined && params.genre !== '') {
      const genreId = filterCacheManager.resolve('genres', params.genre);
      if (genreId !== null && genreId !== '') {
        resolvedFilters['genre_id'] = genreId;
        appliedFilters['genre'] = params.genre;
      } else {
        const similar = filterCacheManager.findSimilar('genres', params.genre);
        const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
        throw new Error(`Genre '${params.genre}' not found.${suggestion}`);
      }
    }

    if (params.mediaType !== undefined && params.mediaType !== '') {
      const mediaId = filterCacheManager.resolve('mediaTypes', params.mediaType);
      if (mediaId !== null && mediaId !== '') {
        resolvedFilters['media_id'] = mediaId;
        appliedFilters['mediaType'] = params.mediaType;
      } else {
        const similar = filterCacheManager.findSimilar('mediaTypes', params.mediaType);
        const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
        throw new Error(`Media type '${params.mediaType}' not found.${suggestion}`);
      }
    }

    if (params.country !== undefined && params.country !== '') {
      const countryId = filterCacheManager.resolve('countries', params.country);
      if (countryId !== null && countryId !== '') {
        resolvedFilters['releasecountry_id'] = countryId;
        appliedFilters['country'] = params.country;
      } else {
        const similar = filterCacheManager.findSimilar('countries', params.country);
        const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
        throw new Error(`Country '${params.country}' not found.${suggestion}`);
      }
    }

    if (params.releaseType !== undefined && params.releaseType !== '') {
      const releaseTypeId = filterCacheManager.resolve('releaseTypes', params.releaseType);
      if (releaseTypeId !== null && releaseTypeId !== '') {
        resolvedFilters['releasetype_id'] = releaseTypeId;
        appliedFilters['releaseType'] = params.releaseType;
      } else {
        const similar = filterCacheManager.findSimilar('releaseTypes', params.releaseType);
        const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
        throw new Error(`Release type '${params.releaseType}' not found.${suggestion}`);
      }
    }

    if (params.recordLabel !== undefined && params.recordLabel !== '') {
      const labelId = filterCacheManager.resolve('recordLabels', params.recordLabel);
      if (labelId !== null && labelId !== '') {
        resolvedFilters['recordlabel_id'] = labelId;
        appliedFilters['recordLabel'] = params.recordLabel;
      } else {
        const similar = filterCacheManager.findSimilar('recordLabels', params.recordLabel);
        const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
        throw new Error(`Record label '${params.recordLabel}' not found.${suggestion}`);
      }
    }

    if (params.mood !== undefined && params.mood !== '') {
      const moodId = filterCacheManager.resolve('moods', params.mood);
      if (moodId !== null && moodId !== '') {
        resolvedFilters['mood_id'] = moodId;
        appliedFilters['mood'] = params.mood;
      } else {
        const similar = filterCacheManager.findSimilar('moods', params.mood);
        const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
        throw new Error(`Mood '${params.mood}' not found.${suggestion}`);
      }
    }

    // Build enhanced query parameters
    const buildParams = (
      limit: number, 
      searchField: string, 
      sortField: string = params.sort || 'name'
    ): string => {
      const searchParams = new URLSearchParams();
      
      // Add pagination
      searchParams.set('_start', '0');
      searchParams.set('_end', limit.toString());
      
      // Add search term as direct parameter
      searchParams.set(searchField, params.query);
      
      // Add sorting
      searchParams.set('_sort', sortField);
      searchParams.set('_order', params.order || 'ASC');
      
      // Add random seed if using random sort
      if (sortField === 'random' && params.randomSeed !== undefined) {
        searchParams.set('seed', params.randomSeed.toString());
      }
      
      // Add resolved filters
      Object.entries(resolvedFilters).forEach(([key, value]) => {
        searchParams.set(key, value);
      });
      
      // Add boolean filters
      if (params.starred !== undefined) {
        searchParams.set('starred', params.starred.toString());
      }
      
      // Add year filtering (for albums and songs)
      if (params.yearFrom !== undefined) {
        searchParams.set('year_from', params.yearFrom.toString());
      }
      if (params.yearTo !== undefined) {
        searchParams.set('year_to', params.yearTo.toString());
      }
      
      return searchParams.toString();
    };

    // Determine appropriate sort field for each endpoint
    const getSortField = (defaultSort: string): string => {
      const sort = params.sort || defaultSort;
      
      // Map common sort fields to endpoint-specific ones
      switch (sort) {
        case 'name': return defaultSort === 'title' ? 'title' : 'name';
        case 'recently_added': return 'recently_added';
        case 'starred_at': return 'starred_at';
        case 'random': return 'random';
        default: return sort;
      }
    };

    // Build parameters for each endpoint type with appropriate sort fields
    const songParams = buildParams(params.songCount, 'title', getSortField('title'));
    const albumParams = buildParams(params.albumCount, 'name', getSortField('name'));
    const artistParams = buildParams(params.artistCount, 'name', getSortField('name'));

    logger.debug('Enhanced search parameters:', {
      songParams,
      albumParams,
      artistParams,
      appliedFilters,
    });

    // Make parallel requests using the client's library filtering
    const [songsResponse, albumsResponse, artistsResponse] = await Promise.all([
      client.requestWithLibraryFilter<unknown[]>(`/song?${songParams}`),
      client.requestWithLibraryFilter<unknown[]>(`/album?${albumParams}`),
      client.requestWithLibraryFilter<unknown[]>(`/artist?${artistParams}`),
    ]);

    // Transform responses to DTOs
    const songs = transformSongsToDTO(songsResponse);
    const albums = transformAlbumsToDTO(albumsResponse);
    const artists = transformArtistsToDTO(artistsResponse);

    const totalResults = songs.length + albums.length + artists.length;

    logger.debug(`Enhanced search completed: ${totalResults} total results (${songs.length} songs, ${albums.length} albums, ${artists.length} artists)`);

    const result = {
      artists,
      albums,
      songs,
      query: params.query,
      totalResults,
    };

    // Only include appliedFilters if any filters were applied
    if (Object.keys(appliedFilters).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).appliedFilters = appliedFilters;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchAll', error));
  }
}

/**
 * Helper function to build enhanced search parameters
 */
function buildEnhancedSearchParams(
  params: {
    query: string;
    limit: number;
    sort?: string | undefined;
    order?: 'ASC' | 'DESC' | undefined;
    randomSeed?: number | undefined;
    genre?: string | undefined;
    mediaType?: string | undefined;
    country?: string | undefined;
    releaseType?: string | undefined;
    recordLabel?: string | undefined;
    mood?: string | undefined;
    yearFrom?: number | undefined;
    yearTo?: number | undefined;
    starred?: boolean | undefined;
  },
  searchField: string,
  defaultSort: string
): { searchParams: string; appliedFilters: Record<string, string> } {
  // Resolve text-based filters to IDs
  const resolvedFilters: Record<string, string> = {};
  const appliedFilters: Record<string, string> = {};

  if (params.genre !== undefined && params.genre !== '') {
    const genreId = filterCacheManager.resolve('genres', params.genre);
    if (genreId !== null && genreId !== '') {
      resolvedFilters['genre_id'] = genreId;
      appliedFilters['genre'] = params.genre;
    } else {
      const similar = filterCacheManager.findSimilar('genres', params.genre);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Genre '${params.genre}' not found.${suggestion}`);
    }
  }

  if (params.mediaType !== undefined && params.mediaType !== '') {
    const mediaId = filterCacheManager.resolve('mediaTypes', params.mediaType);
    if (mediaId !== null && mediaId !== '') {
      resolvedFilters['media_id'] = mediaId;
      appliedFilters['mediaType'] = params.mediaType;
    } else {
      const similar = filterCacheManager.findSimilar('mediaTypes', params.mediaType);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Media type '${params.mediaType}' not found.${suggestion}`);
    }
  }

  if (params.country !== undefined && params.country !== '') {
    const countryId = filterCacheManager.resolve('countries', params.country);
    if (countryId !== null && countryId !== '') {
      resolvedFilters['releasecountry_id'] = countryId;
      appliedFilters['country'] = params.country;
    } else {
      const similar = filterCacheManager.findSimilar('countries', params.country);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Country '${params.country}' not found.${suggestion}`);
    }
  }

  if (params.releaseType !== undefined && params.releaseType !== '') {
    const releaseTypeId = filterCacheManager.resolve('releaseTypes', params.releaseType);
    if (releaseTypeId !== null && releaseTypeId !== '') {
      resolvedFilters['releasetype_id'] = releaseTypeId;
      appliedFilters['releaseType'] = params.releaseType;
    } else {
      const similar = filterCacheManager.findSimilar('releaseTypes', params.releaseType);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Release type '${params.releaseType}' not found.${suggestion}`);
    }
  }

  if (params.recordLabel !== undefined && params.recordLabel !== '') {
    const labelId = filterCacheManager.resolve('recordLabels', params.recordLabel);
    if (labelId !== null && labelId !== '') {
      resolvedFilters['recordlabel_id'] = labelId;
      appliedFilters['recordLabel'] = params.recordLabel;
    } else {
      const similar = filterCacheManager.findSimilar('recordLabels', params.recordLabel);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Record label '${params.recordLabel}' not found.${suggestion}`);
    }
  }

  if (params.mood !== undefined && params.mood !== '') {
    const moodId = filterCacheManager.resolve('moods', params.mood);
    if (moodId !== null && moodId !== '') {
      resolvedFilters['mood_id'] = moodId;
      appliedFilters['mood'] = params.mood;
    } else {
      const similar = filterCacheManager.findSimilar('moods', params.mood);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Mood '${params.mood}' not found.${suggestion}`);
    }
  }

  // Build URLSearchParams
  const searchParams = new URLSearchParams();
  
  // Add pagination
  searchParams.set('_start', '0');
  searchParams.set('_end', params.limit.toString());
  
  // Add search term as direct parameter
  searchParams.set(searchField, params.query);
  
  // Add sorting
  const sortField = params.sort ?? defaultSort;
  searchParams.set('_sort', sortField);
  searchParams.set('_order', params.order ?? 'ASC');
  
  // Add random seed if using random sort
  if (sortField === 'random' && params.randomSeed !== undefined) {
    searchParams.set('seed', params.randomSeed.toString());
  }
  
  // Add resolved filters
  Object.entries(resolvedFilters).forEach(([key, value]) => {
    searchParams.set(key, value);
  });
  
  // Add boolean filters
  if (params.starred !== undefined) {
    searchParams.set('starred', params.starred.toString());
  }
  
  // Add year filtering
  if (params.yearFrom !== undefined) {
    searchParams.set('year_from', params.yearFrom.toString());
  }
  if (params.yearTo !== undefined) {
    searchParams.set('year_to', params.yearTo.toString());
  }

  return {
    searchParams: searchParams.toString(),
    appliedFilters
  };
}

/**
 * Search for songs by title with enhanced filtering
 */
export async function searchSongs(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  songs: SongDTO[];
  query: string;
  total: number;
  appliedFilters?: Record<string, string>;
}> {
  const params = SearchSongsSchema.parse(args);

  try {
    const { searchParams, appliedFilters } = buildEnhancedSearchParams(params, 'title', 'title');

    logger.debug('Enhanced song search parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/song?${searchParams}`);

    // Transform response to DTOs
    const songs = transformSongsToDTO(response);

    logger.debug(`Song search completed: ${songs.length} results`);

    const result = {
      songs,
      query: params.query,
      total: songs.length,
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
 */
export async function searchAlbums(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  albums: AlbumDTO[];
  query: string;
  total: number;
  appliedFilters?: Record<string, string>;
}> {
  const params = SearchAlbumsSchema.parse(args);

  try {
    const { searchParams, appliedFilters } = buildEnhancedSearchParams(params, 'name', 'name');

    logger.debug('Enhanced album search parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/album?${searchParams}`);

    // Transform response to DTOs
    const albums = transformAlbumsToDTO(response);

    logger.debug(`Album search completed: ${albums.length} results`);

    const result = {
      albums,
      query: params.query,
      total: albums.length,
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
 */
export async function searchArtists(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  query: string;
  total: number;
  appliedFilters?: Record<string, string>;
}> {
  const params = SearchArtistsSchema.parse(args);

  try {
    const { searchParams, appliedFilters } = buildEnhancedSearchParams(params, 'name', 'name');

    logger.debug('Enhanced artist search parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/artist?${searchParams}`);

    // Transform response to DTOs
    const artists = transformArtistsToDTO(response);

    logger.debug(`Artist search completed: ${artists.length} results`);

    const result = {
      artists,
      query: params.query,
      total: artists.length,
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

/**
 * Helper function to build enhanced list parameters (no query required)
 */
function buildEnhancedListParams(
  params: {
    limit: number;
    offset: number;
    sort?: string | undefined;
    order?: 'ASC' | 'DESC' | undefined;
    randomSeed?: number | undefined;
    genre?: string | undefined;
    mediaType?: string | undefined;
    country?: string | undefined;
    releaseType?: string | undefined;
    recordLabel?: string | undefined;
    mood?: string | undefined;
    yearFrom?: number | undefined;
    yearTo?: number | undefined;
    starred?: boolean | undefined;
  },
  defaultSort: string,
  additionalParams?: Record<string, string>
): { searchParams: string; appliedFilters: Record<string, string> } {
  // Resolve text-based filters to IDs (same logic as search)
  const resolvedFilters: Record<string, string> = {};
  const appliedFilters: Record<string, string> = {};

  if (params.genre !== undefined && params.genre !== '') {
    const genreId = filterCacheManager.resolve('genres', params.genre);
    if (genreId !== null && genreId !== '') {
      resolvedFilters['genre_id'] = genreId;
      appliedFilters['genre'] = params.genre;
    } else {
      const similar = filterCacheManager.findSimilar('genres', params.genre);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Genre '${params.genre}' not found.${suggestion}`);
    }
  }

  if (params.mediaType !== undefined && params.mediaType !== '') {
    const mediaId = filterCacheManager.resolve('mediaTypes', params.mediaType);
    if (mediaId !== null && mediaId !== '') {
      resolvedFilters['media_id'] = mediaId;
      appliedFilters['mediaType'] = params.mediaType;
    } else {
      const similar = filterCacheManager.findSimilar('mediaTypes', params.mediaType);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Media type '${params.mediaType}' not found.${suggestion}`);
    }
  }

  if (params.country !== undefined && params.country !== '') {
    const countryId = filterCacheManager.resolve('countries', params.country);
    if (countryId !== null && countryId !== '') {
      resolvedFilters['releasecountry_id'] = countryId;
      appliedFilters['country'] = params.country;
    } else {
      const similar = filterCacheManager.findSimilar('countries', params.country);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Country '${params.country}' not found.${suggestion}`);
    }
  }

  if (params.releaseType !== undefined && params.releaseType !== '') {
    const releaseTypeId = filterCacheManager.resolve('releaseTypes', params.releaseType);
    if (releaseTypeId !== null && releaseTypeId !== '') {
      resolvedFilters['releasetype_id'] = releaseTypeId;
      appliedFilters['releaseType'] = params.releaseType;
    } else {
      const similar = filterCacheManager.findSimilar('releaseTypes', params.releaseType);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Release type '${params.releaseType}' not found.${suggestion}`);
    }
  }

  if (params.recordLabel !== undefined && params.recordLabel !== '') {
    const labelId = filterCacheManager.resolve('recordLabels', params.recordLabel);
    if (labelId !== null && labelId !== '') {
      resolvedFilters['recordlabel_id'] = labelId;
      appliedFilters['recordLabel'] = params.recordLabel;
    } else {
      const similar = filterCacheManager.findSimilar('recordLabels', params.recordLabel);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Record label '${params.recordLabel}' not found.${suggestion}`);
    }
  }

  if (params.mood !== undefined && params.mood !== '') {
    const moodId = filterCacheManager.resolve('moods', params.mood);
    if (moodId !== null && moodId !== '') {
      resolvedFilters['mood_id'] = moodId;
      appliedFilters['mood'] = params.mood;
    } else {
      const similar = filterCacheManager.findSimilar('moods', params.mood);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Mood '${params.mood}' not found.${suggestion}`);
    }
  }

  // Build URLSearchParams
  const searchParams = new URLSearchParams();
  
  // Add pagination
  searchParams.set('_start', params.offset.toString());
  searchParams.set('_end', (params.offset + params.limit).toString());
  
  // Add sorting
  const sortField = params.sort ?? defaultSort;
  searchParams.set('_sort', sortField);
  searchParams.set('_order', params.order ?? 'ASC');
  
  // Add random seed if using random sort
  if (sortField === 'random' && params.randomSeed !== undefined) {
    searchParams.set('seed', params.randomSeed.toString());
  }
  
  // Add resolved filters
  Object.entries(resolvedFilters).forEach(([key, value]) => {
    searchParams.set(key, value);
  });
  
  // Add boolean filters
  if (params.starred !== undefined) {
    searchParams.set('starred', params.starred.toString());
  }
  
  // Add year filtering
  if (params.yearFrom !== undefined) {
    searchParams.set('year_from', params.yearFrom.toString());
  }
  if (params.yearTo !== undefined) {
    searchParams.set('year_to', params.yearTo.toString());
  }
  
  // Add additional params (e.g., role=maincredit for artists)
  if (additionalParams) {
    Object.entries(additionalParams).forEach(([key, value]) => {
      searchParams.set(key, value);
    });
  }

  return {
    searchParams: searchParams.toString(),
    appliedFilters
  };
}

/**
 * List songs with enhanced filtering and pagination
 */
export async function listSongs(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  songs: SongDTO[];
  total: number;
  offset: number;
  limit: number;
  appliedFilters?: Record<string, string>;
}> {
  const params = ListSongsSchema.parse(args);

  try {
    const { searchParams, appliedFilters } = buildEnhancedListParams(params, 'title');

    logger.debug('Enhanced song list parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/song?${searchParams}`);

    // Transform response to DTOs
    const songs = transformSongsToDTO(response);

    logger.debug(`Song list completed: ${songs.length} results (offset: ${params.offset}, limit: ${params.limit})`);

    const result = {
      songs,
      total: songs.length + params.offset, // Approximation since we don't have total count from API
      offset: params.offset,
      limit: params.limit,
    };

    // Only include appliedFilters if any filters were applied
    if (Object.keys(appliedFilters).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).appliedFilters = appliedFilters;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('listSongs', error));
  }
}

/**
 * List albums with enhanced filtering and pagination
 */
export async function listAlbums(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  albums: AlbumDTO[];
  total: number;
  offset: number;
  limit: number;
  appliedFilters?: Record<string, string>;
}> {
  const params = ListAlbumsSchema.parse(args);

  try {
    const { searchParams, appliedFilters } = buildEnhancedListParams(params, 'name');

    logger.debug('Enhanced album list parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/album?${searchParams}`);

    // Transform response to DTOs
    const albums = transformAlbumsToDTO(response);

    logger.debug(`Album list completed: ${albums.length} results (offset: ${params.offset}, limit: ${params.limit})`);

    const result = {
      albums,
      total: albums.length + params.offset, // Approximation since we don't have total count from API
      offset: params.offset,
      limit: params.limit,
    };

    // Only include appliedFilters if any filters were applied
    if (Object.keys(appliedFilters).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).appliedFilters = appliedFilters;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('listAlbums', error));
  }
}

/**
 * List artists with enhanced filtering, pagination, and role=maincredit
 */
export async function listArtists(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  total: number;
  offset: number;
  limit: number;
  appliedFilters?: Record<string, string>;
}> {
  const params = ListArtistsSchema.parse(args);

  try {
    // Add role=maincredit for proper artist listing
    const { searchParams, appliedFilters } = buildEnhancedListParams(
      params, 
      'name',
      { role: 'maincredit' }
    );

    logger.debug('Enhanced artist list parameters:', { searchParams, appliedFilters });

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<unknown[]>(`/artist?${searchParams}`);

    // Transform response to DTOs
    const artists = transformArtistsToDTO(response);

    logger.debug(`Artist list completed: ${artists.length} results (offset: ${params.offset}, limit: ${params.limit})`);

    const result = {
      artists,
      total: artists.length + params.offset, // Approximation since we don't have total count from API
      offset: params.offset,
      limit: params.limit,
    };

    // Only include appliedFilters if any filters were applied
    if (Object.keys(appliedFilters).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).appliedFilters = appliedFilters;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('listArtists', error));
  }
}