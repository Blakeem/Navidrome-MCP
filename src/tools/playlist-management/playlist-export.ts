/**
 * Navidrome MCP Server - Playlist Export and Track Utilities
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
import {
  formatDuration,
} from '../../transformers/index.js';
import type {
  PlaylistTrackDTO,
} from '../../types/index.js';
import {
  PlaylistTracksPaginationSchema,
} from '../../schemas/index.js';

/**
 * Raw playlist track data from Navidrome API
 */
interface RawPlaylistTrack {
  id: number;
  mediaFileId?: string;
  playlistId: string;
  title?: string;
  album?: string;
  artist?: string;
  albumArtist?: string;
  duration?: number;
  bitRate?: number;
  path?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
  [key: string]: unknown;
}

/**
 * Transform raw playlist track data to DTO
 */
function transformToPlaylistTrackDTO(rawTrack: RawPlaylistTrack): PlaylistTrackDTO {
  const dto: PlaylistTrackDTO = {
    id: rawTrack.id,
    mediaFileId: rawTrack.mediaFileId ?? String(rawTrack.id),
    playlistId: rawTrack.playlistId,
    title: rawTrack.title ?? '',
    album: rawTrack.album ?? '',
    artist: rawTrack.artist ?? '',
    duration: rawTrack.duration ?? 0,
    durationFormatted: formatDuration(rawTrack.duration),
  };

  // Add optional fields only if they have values
  if (rawTrack.albumArtist !== null && rawTrack.albumArtist !== undefined && rawTrack.albumArtist !== '') {
    dto.albumArtist = rawTrack.albumArtist;
  }

  if (rawTrack.bitRate !== undefined) {
    dto.bitRate = rawTrack.bitRate;
  }

  if (rawTrack.path !== null && rawTrack.path !== undefined && rawTrack.path !== '') {
    dto.path = rawTrack.path;
  }

  if (rawTrack.trackNumber !== undefined) {
    dto.trackNumber = rawTrack.trackNumber;
  }

  if (rawTrack.year !== undefined) {
    dto.year = rawTrack.year;
  }

  if (rawTrack.genre !== null && rawTrack.genre !== undefined && rawTrack.genre !== '') {
    dto.genre = rawTrack.genre;
  }

  return dto;
}

/**
 * Get all tracks in a playlist
 */
export async function getPlaylistTracks(client: NavidromeClient, args: unknown): Promise<{
  tracks: PlaylistTrackDTO[];
  total: number;
  offset: number;
  limit: number;
  playlistId: string;
  format: string;
  m3uContent?: string;
}> {
  const params = PlaylistTracksPaginationSchema.parse(args);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
    });

    const headers: Record<string, string> = {};
    if (params.format === 'm3u') {
      headers['Accept'] = 'audio/x-mpegurl';
    }

    const response = await client.request<unknown>(`/playlist/${params.playlistId}/tracks?${queryParams.toString()}`, {
      method: 'GET',
      headers,
    });

    if (params.format === 'm3u') {
      return {
        tracks: [],
        total: 0,
        offset: params.offset,
        limit: params.limit,
        playlistId: params.playlistId,
        format: 'm3u',
        m3uContent: response as string,
      };
    }

    const tracks = Array.isArray(response)
      ? response.map((track: unknown) => transformToPlaylistTrackDTO(track as RawPlaylistTrack))
      : [];

    return {
      tracks,
      total: tracks.length,
      offset: params.offset,
      limit: params.limit,
      playlistId: params.playlistId,
      format: 'json',
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch playlist tracks: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}