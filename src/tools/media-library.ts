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
import {
  transformPlaylistsToDTO,
  transformToSongDTO,
  transformToAlbumDTO,
  transformToArtistDTO,
  type RawSong,
  type RawAlbum,
  type RawArtist,
} from '../transformers/index.js';
import type { SongDTO, AlbumDTO, ArtistDTO, PlaylistDTO } from '../types/index.js';
import {
  IdSchema,
  GetSongPlaylistsSchema,
} from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

// Get Song by ID
export async function getSong(client: NavidromeClient, args: unknown): Promise<SongDTO> {
  const params = IdSchema.parse(args);
  logger.debug('Tool getSong called with args:', params);

  try {
    const rawSong = await client.requestWithLibraryFilter<unknown>(`/song/${encodeURIComponent(params.id)}`);
    return transformToSongDTO(rawSong as RawSong);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_song', error));
  }
}

// Get Album by ID
export async function getAlbum(client: NavidromeClient, args: unknown): Promise<AlbumDTO> {
  const params = IdSchema.parse(args);
  logger.debug('Tool getAlbum called with args:', params);

  try {
    const rawAlbum = await client.requestWithLibraryFilter<unknown>(`/album/${encodeURIComponent(params.id)}`);
    return transformToAlbumDTO(rawAlbum as RawAlbum);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_album', error));
  }
}

// Get Artist by ID
export async function getArtist(client: NavidromeClient, args: unknown): Promise<ArtistDTO> {
  const params = IdSchema.parse(args);
  logger.debug('Tool getArtist called with args:', params);

  try {
    const rawArtist = await client.requestWithLibraryFilter<unknown>(`/artist/${encodeURIComponent(params.id)}`);
    return transformToArtistDTO(rawArtist as RawArtist);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_artist', error));
  }
}

// Get Playlists containing a song. `songId` is intentionally NOT echoed back —
// the LLM just sent it; returning a single string field would only waste
// context. The DEBUG log captures it for diagnostics.
export async function getSongPlaylists(client: NavidromeClient, args: unknown): Promise<{
  playlists: PlaylistDTO[];
}> {
  const params = GetSongPlaylistsSchema.parse(args);
  logger.debug('Tool getSongPlaylists called with args:', params);

  try {
    const rawPlaylists = await client.requestWithLibraryFilter<unknown>(`/song/${encodeURIComponent(params.songId)}/playlists`);
    const playlists = transformPlaylistsToDTO(rawPlaylists);

    return {
      playlists,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_song_playlists', error));
  }
}