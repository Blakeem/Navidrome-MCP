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
  SongIdSchema,
  AlbumIdSchema,
  ArtistIdSchema,
} from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

export async function getSong(client: NavidromeClient, args: unknown): Promise<SongDTO> {
  try {
    const params = SongIdSchema.parse(args);
    logger.debug('Tool getSong called with args:', params);

    const rawSong = await client.requestWithLibraryFilter<unknown>(`/song/${encodeURIComponent(params.songId)}`);
    // Single-item detail lookup: full metadata is the whole point and there is
    // no array to bloat context, so always return the verbose shape.
    return transformToSongDTO(rawSong as RawSong, { verbose: true });
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_song', error));
  }
}

export async function getAlbum(client: NavidromeClient, args: unknown): Promise<AlbumDTO> {
  try {
    const params = AlbumIdSchema.parse(args);
    logger.debug('Tool getAlbum called with args:', params);

    const rawAlbum = await client.requestWithLibraryFilter<unknown>(`/album/${encodeURIComponent(params.albumId)}`);
    // Single-item detail lookup, always verbose (see getSong).
    return transformToAlbumDTO(rawAlbum as RawAlbum, { verbose: true });
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_album', error));
  }
}

export async function getArtist(client: NavidromeClient, args: unknown): Promise<ArtistDTO> {
  try {
    const params = ArtistIdSchema.parse(args);
    logger.debug('Tool getArtist called with args:', params);

    const rawArtist = await client.requestWithLibraryFilter<unknown>(`/artist/${encodeURIComponent(params.artistId)}`);
    // Single-item detail lookup, always verbose (see getSong).
    return transformToArtistDTO(rawArtist as RawArtist, { verbose: true });
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_artist', error));
  }
}

export async function getSongPlaylists(client: NavidromeClient, args: unknown): Promise<{
  playlists: PlaylistDTO[];
}> {
  try {
    const params = SongIdSchema.parse(args);
    logger.debug('Tool getSongPlaylists called with args:', params);

    const rawPlaylists = await client.requestWithLibraryFilter<unknown>(`/song/${encodeURIComponent(params.songId)}/playlists`);
    const playlists = transformPlaylistsToDTO(rawPlaylists);

    return {
      playlists,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_song_playlists', error));
  }
}