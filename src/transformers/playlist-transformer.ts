/**
 * Navidrome MCP Server - Playlist Data Transformers
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

import type { PlaylistDTO, PlaylistTrackDTO } from '../types/index.js';
import { logger } from '../utils/logger.js';
import {
  extractGenre,
  formatDuration,
  shouldEmit,
  transformObjectRows,
  type TransformOptions,
} from './shared-transformers.js';

/**
 * Raw playlist data from Navidrome API. Older Navidrome releases emit the owner
 * as `owner`, and `ownerName` wins when both are present.
 */
export interface RawPlaylist {
  id: string;
  name: string;
  comment?: string;
  public: boolean;
  songCount: number;
  duration?: number;
  owner?: string;
  ownerName?: string;
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Raw playlist track data from Navidrome API
 */
interface RawPlaylistTrack {
  id: string;
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
  genres?: Array<{ name: string }>;
  [key: string]: unknown;
}

/**
 * Transform a raw playlist from Navidrome API to a clean DTO
 * @param rawPlaylist Raw playlist data from API
 * @param options `keep: ['duration']` adds the numeric total duration
 * @returns Clean playlist DTO for LLM consumption
 */
export function transformToPlaylistDTO(rawPlaylist: RawPlaylist, options?: TransformOptions): PlaylistDTO {
  const owner = rawPlaylist.ownerName ?? rawPlaylist.owner ?? '';

  const dto: PlaylistDTO = {
    id: rawPlaylist.id,
    name: rawPlaylist.name || '',
    public: rawPlaylist.public || false,
    songCount: rawPlaylist.songCount || 0,
    durationFormatted: formatDuration(rawPlaylist.duration),
    owner,
  };

  if (shouldEmit('duration', options) && rawPlaylist.duration !== undefined) {
    dto.duration = rawPlaylist.duration;
  }

  if (rawPlaylist.ownerId !== undefined && rawPlaylist.ownerId !== '') {
    dto.ownerId = rawPlaylist.ownerId;
  }

  if (rawPlaylist.comment !== undefined && rawPlaylist.comment !== '') {
    dto.comment = rawPlaylist.comment;
  }

  if (rawPlaylist.createdAt !== undefined && rawPlaylist.createdAt !== '') {
    dto.createdAt = rawPlaylist.createdAt;
  }

  if (rawPlaylist.updatedAt !== undefined && rawPlaylist.updatedAt !== '') {
    dto.updatedAt = rawPlaylist.updatedAt;
  }

  return dto;
}

/**
 * Transform an array of raw playlists to DTOs
 * @param rawPlaylists Array of raw playlist data
 * @param options Forwarded to each item (see {@link transformToPlaylistDTO})
 * @returns Array of clean playlist DTOs
 */
export function transformPlaylistsToDTO(rawPlaylists: unknown, options?: TransformOptions): PlaylistDTO[] {
  return transformObjectRows(rawPlaylists, (playlist: RawPlaylist) => transformToPlaylistDTO(playlist, options));
}

/**
 * Compact output keeps only what identifies and acts on a track (`position` for reorder and remove,
 * `songId` for playback), so large playlists stay under the token cap.
 */
export function transformToPlaylistTrackDTO(rawTrack: RawPlaylistTrack, options?: TransformOptions): PlaylistTrackDTO {
  // The fallback is a playlist position, not a song id, so a later lookup by it resolves
  // the wrong song. Warn so the substitution never corrupts downstream lookups silently.
  if (rawTrack.mediaFileId === undefined || rawTrack.mediaFileId === '') {
    logger.warn(
      `Playlist track missing mediaFileId (playlistId=${rawTrack.playlistId}, position=${rawTrack.id}); ` +
        `using playlist-position id as a fallback. Possible Navidrome API contract violation.`
    );
  }

  const dto: PlaylistTrackDTO = {
    position: rawTrack.id,
    songId: rawTrack.mediaFileId ?? rawTrack.id,
    title: rawTrack.title ?? '',
    album: rawTrack.album ?? '',
    artist: rawTrack.artist ?? '',
    durationFormatted: formatDuration(rawTrack.duration),
  };

  if (shouldEmit('playlistId', options)) {
    dto.playlistId = rawTrack.playlistId;
  }

  if (shouldEmit('duration', options)) {
    dto.duration = rawTrack.duration ?? 0;
  }

  if (shouldEmit('albumArtist', options) && rawTrack.albumArtist !== undefined && rawTrack.albumArtist !== '') {
    dto.albumArtist = rawTrack.albumArtist;
  }

  if (shouldEmit('bitRate', options) && rawTrack.bitRate !== undefined) {
    dto.bitRate = rawTrack.bitRate;
  }

  if (shouldEmit('path', options) && rawTrack.path !== undefined && rawTrack.path !== '') {
    dto.path = rawTrack.path;
  }

  if (shouldEmit('trackNumber', options) && rawTrack.trackNumber !== undefined) {
    dto.trackNumber = rawTrack.trackNumber;
  }

  if (shouldEmit('year', options) && rawTrack.year !== undefined && rawTrack.year > 0) {
    dto.year = rawTrack.year;
  }

  if (shouldEmit('genre', options)) {
    const genre = extractGenre(rawTrack);
    if (genre !== undefined) {
      dto.genre = genre;
    }
  }

  return dto;
}

/**
 * Transform an array of raw playlist tracks to DTOs
 * @param rawTracks Array of raw playlist track data
 * @param options Verbosity controls forwarded to each item (see {@link TransformOptions})
 * @returns Array of clean playlist track DTOs
 */
export function transformPlaylistTracksToDTO(rawTracks: unknown, options?: TransformOptions): PlaylistTrackDTO[] {
  return transformObjectRows(rawTracks, (track: RawPlaylistTrack) => transformToPlaylistTrackDTO(track, options));
}
