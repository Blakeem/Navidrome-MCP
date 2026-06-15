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
 * Transform raw playlist track data to DTO.
 *
 * Compact (default): only the identity fields needed to recognize and act on a
 * track — `id` (1-based playlist position for reorder/remove), `mediaFileId`
 * (song id for playback), `title`, `artist`, `album`, `durationFormatted`. This
 * keeps large playlists well under the tool-result token cap. Verbose restores
 * the rest (the heavy `path`, plus `playlistId`, raw `duration`, `bitRate`,
 * `albumArtist`, `trackNumber`, `year`, `genre`).
 */
function transformToPlaylistTrackDTO(rawTrack: RawPlaylistTrack, verbose: boolean): PlaylistTrackDTO {
  // When Navidrome omits mediaFileId we fall back to the 1-based playlist
  // position (rawTrack.id). That value is NOT a song/media-file id, so anything
  // that later looks up or plays this track by mediaFileId will resolve the
  // wrong song (or nothing). Surface the contract violation rather than letting
  // the substitution corrupt downstream lookups silently.
  if (rawTrack.mediaFileId === undefined || rawTrack.mediaFileId === '') {
    logger.warn(
      `Playlist track missing mediaFileId (playlistId=${rawTrack.playlistId}, position=${String(rawTrack.id)}); ` +
        `using playlist-position id as a fallback — possible Navidrome API contract violation.`
    );
  }

  const dto: PlaylistTrackDTO = {
    id: String(rawTrack.id),
    mediaFileId: rawTrack.mediaFileId ?? String(rawTrack.id),
    title: rawTrack.title ?? '',
    album: rawTrack.album ?? '',
    artist: rawTrack.artist ?? '',
    durationFormatted: formatDuration(rawTrack.duration),
  };

  if (!verbose) {
    return dto;
  }

  // Verbose-only fields. `playlistId` is identical on every row (the caller
  // passed it in) and the raw `duration` duplicates `durationFormatted`, so
  // both are omitted from compact responses; the rest are added only if the
  // source actually provides a value.
  dto.playlistId = rawTrack.playlistId;
  dto.duration = rawTrack.duration ?? 0;

  if (rawTrack.albumArtist !== undefined && rawTrack.albumArtist !== '') {
    dto.albumArtist = rawTrack.albumArtist;
  }

  if (rawTrack.bitRate !== undefined) {
    dto.bitRate = rawTrack.bitRate;
  }

  if (rawTrack.path !== undefined && rawTrack.path !== '') {
    dto.path = rawTrack.path;
  }

  if (rawTrack.trackNumber !== undefined) {
    dto.trackNumber = rawTrack.trackNumber;
  }

  if (rawTrack.year !== undefined) {
    dto.year = rawTrack.year;
  }

  if (rawTrack.genre !== undefined && rawTrack.genre !== '') {
    dto.genre = rawTrack.genre;
  }

  return dto;
}

/**
 * JSON-mode response: structured track DTOs plus the paginated total.
 */
interface GetPlaylistTracksJsonResponse {
  format: 'json';
  tracks: PlaylistTrackDTO[];
  total: number;
}

/**
 * M3U-mode response: only the raw m3u payload. We intentionally omit
 * `tracks`/`total` here (Batch 2 #4) — the previous shape returned
 * `tracks: []` and `total: 0` even when `m3uContent` was fully populated,
 * which was misleading. The track count is implicit in the m3u body and is
 * also available via `get_playlist`.songCount.
 */
interface GetPlaylistTracksM3UResponse {
  format: 'm3u';
  m3uContent: string;
}

type GetPlaylistTracksResponse =
  | GetPlaylistTracksJsonResponse
  | GetPlaylistTracksM3UResponse;

/**
 * Get all tracks in a playlist. The LLM-supplied `offset`, `limit`, and
 * `playlistId` are NOT echoed back — they only consume context window. The
 * response shape is discriminated by `format`: JSON mode returns `tracks` and
 * `total` (server-derived from X-Total-Count); M3U mode returns only
 * `m3uContent`. The original args are captured in the DEBUG log.
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
      return {
        format: 'm3u',
        m3uContent: typeof data === 'string' ? data : '',
      };
    }

    const tracks = Array.isArray(data)
      ? data.map((track: unknown) => transformToPlaylistTrackDTO(track as RawPlaylistTrack, params.verbose))
      : [];

    return {
      format: 'json',
      tracks,
      total: total ?? tracks.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_playlist_tracks', error));
  }
}