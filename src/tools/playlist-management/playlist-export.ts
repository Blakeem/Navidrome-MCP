/**
 * Navidrome MCP Server - Playlist Export and Track Utilities
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

/** No `tracks` or `total`, since the m3u body carries the tracks and get_playlist has songCount. */
interface GetPlaylistTracksM3UResponse {
  format: 'm3u';
  m3uContent: string;
}

type GetPlaylistTracksResponse =
  | GetPlaylistTracksJsonResponse
  | GetPlaylistTracksM3UResponse;

/** `offset`, `limit` and `playlistId` are not echoed, since they only consume context. */
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