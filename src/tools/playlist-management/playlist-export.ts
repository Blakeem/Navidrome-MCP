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
  transformPlaylistTracksToDTO,
} from '../../transformers/index.js';
import type {
  PlaylistTrackDTO,
} from '../../types/index.js';
import {
  PlaylistTracksPaginationSchema,
} from '../../schemas/index.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';

interface GetPlaylistTracksJsonResponse {
  format: 'json';
  tracks: PlaylistTrackDTO[];
  total: number;
}

/**
 * M3U-mode response. It omits `tracks` and `total`, since the m3u body carries the tracks
 * and `get_playlist` reports songCount.
 */
interface GetPlaylistTracksM3UResponse {
  format: 'm3u';
  m3uContent: string;
}

type GetPlaylistTracksResponse =
  | GetPlaylistTracksJsonResponse
  | GetPlaylistTracksM3UResponse;

/**
 * Get all tracks in a playlist. The caller's `offset`, `limit` and `playlistId` are not echoed,
 * since they only consume context. The DEBUG log keeps them.
 */
export async function getPlaylistTracks(client: NavidromeClient, args: unknown): Promise<GetPlaylistTracksResponse> {
  try {
    const params = PlaylistTracksPaginationSchema.parse(args);
    logger.debug('Tool getPlaylistTracks called with args:', params);

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
      if (typeof data !== 'string') {
        throw new Error('Expected an M3U text body but received a JSON response. The server did not honor the audio/x-mpegurl Accept header for the M3U export.');
      }
      return {
        format: 'm3u',
        m3uContent: data,
      };
    }

    const tracks = transformPlaylistTracksToDTO(data, { verbose: params.verbose });

    return {
      format: 'json',
      tracks,
      total: total ?? tracks.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_playlist_tracks', error));
  }
}