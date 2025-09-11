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
import {
  SearchAllSchema,
  SearchSongsSchema,
  SearchAlbumsSchema,
  SearchArtistsSchema,
} from '../schemas/index.js';

/**
 * Search across all content types (artists, albums, songs)
 * Now uses REST API for proper library filtering support
 */
export async function searchAll(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  query: string;
  totalResults: number;
}> {
  const params = SearchAllSchema.parse(args);

  try {
    // Build query parameters for each endpoint with direct parameter search
    const buildParams = (limit: number, searchField: string): string => {
      const searchParams = new URLSearchParams();
      
      // Add pagination
      searchParams.set('_start', '0');
      searchParams.set('_end', limit.toString());
      
      // Add search term as direct parameter (like web UI)
      searchParams.set(searchField, params.query);
      
      return searchParams.toString();
    };

    // Build parameters for each endpoint type
    const songParams = buildParams(params.songCount, 'title');
    const albumParams = buildParams(params.albumCount, 'name');
    const artistParams = buildParams(params.artistCount, 'name');

    // Make parallel requests using the client's library filtering
    const [songsResponse, albumsResponse, artistsResponse] = await Promise.all([
      client.requestWithLibraryFilter<any[]>(`/song?${songParams}`),
      client.requestWithLibraryFilter<any[]>(`/album?${albumParams}`),
      client.requestWithLibraryFilter<any[]>(`/artist?${artistParams}`),
    ]);

    // Transform responses to DTOs
    const songs = transformSongsToDTO(songsResponse);
    const albums = transformAlbumsToDTO(albumsResponse);
    const artists = transformArtistsToDTO(artistsResponse);

    const totalResults = songs.length + albums.length + artists.length;

    return {
      artists,
      albums,
      songs,
      query: params.query,
      totalResults,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchAll', error));
  }
}

/**
 * Search for songs by title
 */
export async function searchSongs(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  songs: SongDTO[];
  query: string;
  total: number;
}> {
  const params = SearchSongsSchema.parse(args);

  try {
    // Build query parameters
    const searchParams = new URLSearchParams();
    
    // Add pagination
    searchParams.set('_start', '0');
    searchParams.set('_end', params.limit.toString());
    
    // Add search term as direct parameter (like web UI)
    searchParams.set('title', params.query);

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<any[]>(`/song?${searchParams.toString()}`);

    // Transform response to DTOs
    const songs = transformSongsToDTO(response);

    return {
      songs,
      query: params.query,
      total: songs.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchSongs', error));
  }
}

/**
 * Search for albums by name
 */
export async function searchAlbums(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  albums: AlbumDTO[];
  query: string;
  total: number;
}> {
  const params = SearchAlbumsSchema.parse(args);

  try {
    // Build query parameters
    const searchParams = new URLSearchParams();
    
    // Add pagination
    searchParams.set('_start', '0');
    searchParams.set('_end', params.limit.toString());
    
    // Add search term as direct parameter (like web UI)
    searchParams.set('name', params.query);

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<any[]>(`/album?${searchParams.toString()}`);

    // Transform response to DTOs
    const albums = transformAlbumsToDTO(response);

    return {
      albums,
      query: params.query,
      total: albums.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchAlbums', error));
  }
}

/**
 * Search for artists by name
 */
export async function searchArtists(client: NavidromeClient, _config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  query: string;
  total: number;
}> {
  const params = SearchArtistsSchema.parse(args);

  try {
    // Build query parameters
    const searchParams = new URLSearchParams();
    
    // Add pagination
    searchParams.set('_start', '0');
    searchParams.set('_end', params.limit.toString());
    
    // Add search term as direct parameter (like web UI)
    searchParams.set('name', params.query);

    // Make request using the client with library filtering
    const response = await client.requestWithLibraryFilter<any[]>(`/artist?${searchParams.toString()}`);

    // Transform response to DTOs
    const artists = transformArtistsToDTO(response);

    return {
      artists,
      query: params.query,
      total: artists.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('searchArtists', error));
  }
}