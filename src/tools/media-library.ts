/**
 * Navidrome MCP Server - Media Library Tools
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

import crypto from 'crypto';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  transformAlbumsToDTO,
  transformArtistsToDTO,
  transformPlaylistsToDTO,
  transformToSongDTO,
  transformToAlbumDTO,
  transformToArtistDTO,
  type RawSong,
  type RawAlbum,
  type RawArtist,
} from '../transformers/song-transformer.js';
import type { SongDTO, AlbumDTO, ArtistDTO, GenreDTO, PlaylistDTO } from '../types/index.js';
import {
  AlbumPaginationSchema,
  ArtistPaginationSchema,
  GenrePaginationSchema,
  IdSchema,
  GetSongPlaylistsSchema,
} from '../schemas/index.js';

// List Albums
export async function listAlbums(client: NavidromeClient, args: unknown): Promise<{
  albums: AlbumDTO[];
  total: number;
  offset: number;
  limit: number;
}> {
  const params = AlbumPaginationSchema.parse(args);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    const rawAlbums = await client.request<unknown>(`/album?${queryParams.toString()}`);
    const albums = transformAlbumsToDTO(rawAlbums);

    return {
      albums,
      total: albums.length,
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch albums: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// List Artists
export async function listArtists(client: NavidromeClient, args: unknown): Promise<{
  artists: ArtistDTO[];
  total: number;
  offset: number;
  limit: number;
}> {
  const params = ArtistPaginationSchema.parse(args);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    const rawArtists = await client.request<unknown>(`/artist?${queryParams.toString()}`);
    const artists = transformArtistsToDTO(rawArtists);

    return {
      artists,
      total: artists.length,
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch artists: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Create Subsonic API authentication parameters for genres
 */
function createSubsonicAuthForGenres(config: Config): URLSearchParams {
  const salt = crypto.randomBytes(16).toString('hex');
  const token = crypto.createHash('md5').update(config.navidromePassword + salt).digest('hex');
  
  return new URLSearchParams({
    u: config.navidromeUsername,
    t: token,
    s: salt,
    v: '1.16.1',
    c: 'NavidromeMCP',
    f: 'json',
  });
}

// List Genres
export async function listGenres(_client: NavidromeClient, config: Config, args: unknown): Promise<{
  genres: GenreDTO[];
  total: number;
  offset: number;
  limit: number;
}> {
  const params = GenrePaginationSchema.parse(args);

  try {
    // Use direct fetch to Subsonic API (not through our client since it adds /api prefix)
    const authParams = createSubsonicAuthForGenres(config);
    const subsonicUrl = `${config.navidromeUrl}/rest/getGenres?${authParams.toString()}`;
    
    const subsonicResponse = await fetch(subsonicUrl);
    if (!subsonicResponse.ok) {
      throw new Error(`Subsonic API request failed: ${subsonicResponse.status} ${subsonicResponse.statusText}`);
    }
    
    const response = await subsonicResponse.json() as {
      'subsonic-response'?: {
        genres?: {
          genre?: Array<{
            value?: string;
            songCount?: number;
            albumCount?: number;
          }>;
        };
      };
    };
    
    // Extract genres from Subsonic response structure
    const subsonicGenres = response?.['subsonic-response']?.genres?.genre ?? [];
    
    // Transform Subsonic genre format to our DTO
    const allGenres: GenreDTO[] = subsonicGenres.map((genre) => ({
      id: genre.value ?? '', // Subsonic uses 'value' for genre name as ID
      name: genre.value ?? '',
      songCount: genre.songCount ?? 0,
      albumCount: genre.albumCount ?? 0,
    }));

    // Apply pagination manually since Subsonic getGenres doesn't support it
    const startIndex = params.offset;
    const endIndex = Math.min(startIndex + params.limit, allGenres.length);
    const paginatedGenres = allGenres.slice(startIndex, endIndex);

    return {
      genres: paginatedGenres,
      total: allGenres.length,
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch genres: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get Song by ID
export async function getSong(client: NavidromeClient, args: unknown): Promise<SongDTO> {
  const params = IdSchema.parse(args);

  try {
    const rawSong = await client.request<unknown>(`/song/${params.id}`);
    return transformToSongDTO(rawSong as RawSong);
  } catch (error) {
    throw new Error(
      `Failed to fetch song: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get Album by ID
export async function getAlbum(client: NavidromeClient, args: unknown): Promise<AlbumDTO> {
  const params = IdSchema.parse(args);

  try {
    const rawAlbum = await client.request<unknown>(`/album/${params.id}`);
    return transformToAlbumDTO(rawAlbum as RawAlbum);
  } catch (error) {
    throw new Error(
      `Failed to fetch album: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get Artist by ID
export async function getArtist(client: NavidromeClient, args: unknown): Promise<ArtistDTO> {
  const params = IdSchema.parse(args);

  try {
    const rawArtist = await client.request<unknown>(`/artist/${params.id}`);
    return transformToArtistDTO(rawArtist as RawArtist);
  } catch (error) {
    throw new Error(
      `Failed to fetch artist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get Playlists containing a song
export async function getSongPlaylists(client: NavidromeClient, args: unknown): Promise<{
  playlists: PlaylistDTO[];
  songId: string;
}> {
  const params = GetSongPlaylistsSchema.parse(args);

  try {
    const rawPlaylists = await client.request<unknown>(`/song/${params.songId}/playlists`);
    
    // Workaround: This specific endpoint returns JSON data but with text/plain content-type
    // So we need to parse it manually if it's a string
    let playlistData = rawPlaylists;
    if (typeof rawPlaylists === 'string') {
      try {
        playlistData = JSON.parse(rawPlaylists);
      } catch (parseError) {
        logger.error('Failed to parse playlist data:', parseError);
        playlistData = [];
      }
    }
    
    const playlists = transformPlaylistsToDTO(playlistData);

    return {
      playlists,
      songId: params.songId,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch song playlists: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}