/**
 * Navidrome MCP Server - Single-Type Search
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { NavidromeClient } from '../../client/navidrome-client.js';
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

export async function searchSongs(client: NavidromeClient, args: unknown): Promise<{
  songs: SongDTO[];
  total: number;
  appliedFilters?: Record<string, string>;
}> {
  try {
    const params = SearchSongsSchema.parse(args);
    logger.debug('Tool search_songs called with args:', params);

    const { searchParams, appliedFilters } = await buildEnhancedSearchParams(params, 'title', 'title', 'song');
    logger.debug('Enhanced song search parameters:', { searchParams, appliedFilters });

    const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown[]>(`/song?${searchParams}`);
    const songs = transformSongsToDTO(data, { verbose: params.verbose });

    logger.debug(`Song search completed: ${songs.length} of ${total ?? `${songs.length} (no header)`} results`);

    return {
      songs,
      total: total ?? songs.length,
      ...(Object.keys(appliedFilters).length > 0 ? { appliedFilters } : {}),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('search_songs', error));
  }
}

export async function searchAlbums(client: NavidromeClient, args: unknown): Promise<{
  albums: AlbumDTO[];
  total: number;
  appliedFilters?: Record<string, string>;
}> {
  try {
    const params = SearchAlbumsSchema.parse(args);
    logger.debug('Tool search_albums called with args:', params);

    const { searchParams, appliedFilters } = await buildEnhancedSearchParams(params, 'name', 'name', 'album');
    logger.debug('Enhanced album search parameters:', { searchParams, appliedFilters });

    const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown[]>(`/album?${searchParams}`);
    const albums = transformAlbumsToDTO(data, { verbose: params.verbose });

    logger.debug(`Album search completed: ${albums.length} of ${total ?? `${albums.length} (no header)`} results`);

    return {
      albums,
      total: total ?? albums.length,
      ...(Object.keys(appliedFilters).length > 0 ? { appliedFilters } : {}),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('search_albums', error));
  }
}

// role=maincredit keeps track and album artists and drops composers and other credited
// contributors.
export async function searchArtists(client: NavidromeClient, args: unknown): Promise<{
  artists: ArtistDTO[];
  total: number;
  appliedFilters?: Record<string, string>;
}> {
  try {
    const params = SearchArtistsSchema.parse(args);
    logger.debug('Tool search_artists called with args:', params);

    const { searchParams: baseParams, appliedFilters } = await buildEnhancedSearchParams(params, 'name', 'name', 'artist');
    const searchParams = `${baseParams}&role=maincredit`;
    logger.debug('Enhanced artist search parameters:', { searchParams, appliedFilters });

    const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown[]>(`/artist?${searchParams}`);
    const artists = transformArtistsToDTO(data, { verbose: params.verbose });

    logger.debug(`Artist search completed: ${artists.length} of ${total ?? `${artists.length} (no header)`} results`);

    return {
      artists,
      total: total ?? artists.length,
      ...(Object.keys(appliedFilters).length > 0 ? { appliedFilters } : {}),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('search_artists', error));
  }
}
