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
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';

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
 * Get all tracks in a playlist. The LLM-supplied `offset`, `limit`,
 * `playlistId`, and `format` are NOT echoed back — they only consume context
 * window. The presence of `m3uContent` (vs `tracks`) implicitly signals the
 * format; `total` (server-derived from X-Total-Count) is what the LLM needs
 * for further pagination. The original args are captured in the DEBUG log.
 */
export async function getPlaylistTracks(client: NavidromeClient, args: unknown): Promise<{
  tracks: PlaylistTrackDTO[];
  total: number;
  m3uContent?: string;
}> {
  const params = PlaylistTracksPaginationSchema.parse(args);
  logger.debug('Tool getPlaylistTracks called with args:', params);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
    });

    const headers: Record<string, string> = {};
    if (params.format === 'm3u') {
      headers['Accept'] = 'audio/x-mpegurl';
    }

    const { data, total } = await client.requestWithMeta<unknown>(
      `/playlist/${encodeURIComponent(params.playlistId)}/tracks?${queryParams.toString()}`,
      { method: 'GET', headers },
    );

    if (params.format === 'm3u') {
      // m3u branch returns the raw text payload — there are no DTO items to
      // count. Surface the X-Total-Count if Navidrome sent one (it does for
      // the JSON path; m3u typically omits it), otherwise fall back to 0.
      // The actual track count is in the m3u body and via get_playlist.songCount.
      return {
        tracks: [],
        total: total ?? 0,
        m3uContent: data as string,
      };
    }

    const tracks = Array.isArray(data)
      ? data.map((track: unknown) => transformToPlaylistTrackDTO(track as RawPlaylistTrack))
      : [];

    return {
      tracks,
      total: total ?? tracks.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_playlist_tracks', error));
  }
}