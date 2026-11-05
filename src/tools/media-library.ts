/**
 * Navidrome MCP Server - Media Library Tools
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
    // A detail lookup returns one item, so the verbose shape cannot bloat context.
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
    // Verbose for the same reason as getSong.
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
    // Verbose for the same reason as getSong.
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
    if (playlists.length === 0) {
      // Navidrome lists no playlists for an unknown song too, so the song read tells the two apart.
      await client.request<unknown>(`/song/${encodeURIComponent(params.songId)}`);
    }

    return {
      playlists,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_song_playlists', error));
  }
}