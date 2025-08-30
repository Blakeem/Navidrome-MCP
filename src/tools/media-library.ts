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

import { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import {
  transformAlbumsToDTO,
  transformArtistsToDTO,
  transformGenresToDTO,
  transformPlaylistsToDTO,
  transformToSongDTO,
  transformToAlbumDTO,
  transformToArtistDTO,
} from '../transformers/song-transformer.js';
import type { SongDTO, AlbumDTO, ArtistDTO, GenreDTO, PlaylistDTO } from '../types/dto.js';

// Common pagination schema
const PaginationSchema = z.object({
  limit: z.number().min(1).max(500).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  sort: z.string().optional().default('name'),
  order: z.enum(['ASC', 'DESC']).optional().default('ASC'),
});


const GetByIdSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

const GetSongPlaylistsSchema = z.object({
  songId: z.string().min(1, 'Song ID is required'),
});

// List Albums
export async function listAlbums(client: NavidromeClient, args: unknown): Promise<{
  albums: AlbumDTO[];
  total: number;
  offset: number;
  limit: number;
}> {
  const params = PaginationSchema.parse(args);

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
  const params = PaginationSchema.parse(args);

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

// List Genres
export async function listGenres(client: NavidromeClient, args: unknown): Promise<{
  genres: GenreDTO[];
  total: number;
  offset: number;
  limit: number;
}> {
  const params = PaginationSchema.parse(args);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    const rawGenres = await client.request<unknown>(`/genre?${queryParams.toString()}`);
    const genres = transformGenresToDTO(rawGenres);

    return {
      genres,
      total: genres.length,
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
  const params = GetByIdSchema.parse(args);

  try {
    const rawSong = await client.request<unknown>(`/song/${params.id}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transformToSongDTO(rawSong as any);
  } catch (error) {
    throw new Error(
      `Failed to fetch song: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get Album by ID
export async function getAlbum(client: NavidromeClient, args: unknown): Promise<AlbumDTO> {
  const params = GetByIdSchema.parse(args);

  try {
    const rawAlbum = await client.request<unknown>(`/album/${params.id}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transformToAlbumDTO(rawAlbum as any);
  } catch (error) {
    throw new Error(
      `Failed to fetch album: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Get Artist by ID
export async function getArtist(client: NavidromeClient, args: unknown): Promise<ArtistDTO> {
  const params = GetByIdSchema.parse(args);

  try {
    const rawArtist = await client.request<unknown>(`/artist/${params.id}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transformToArtistDTO(rawArtist as any);
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
    const playlists = transformPlaylistsToDTO(rawPlaylists);

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