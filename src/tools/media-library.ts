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

import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import {
  transformPlaylistsToDTO,
  transformToSongDTO,
  transformToAlbumDTO,
  transformToArtistDTO,
  type RawSong,
  type RawAlbum,
  type RawArtist,
} from '../transformers/song-transformer.js';
import type { SongDTO, AlbumDTO, ArtistDTO, PlaylistDTO } from '../types/index.js';
import {
  IdSchema,
  GetSongPlaylistsSchema,
} from '../schemas/index.js';

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