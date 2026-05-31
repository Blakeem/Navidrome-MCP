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

import type { PlaylistDTO } from '../types/index.js';
import { formatDuration } from './shared-transformers.js';

/**
 * Raw playlist data from Navidrome API.
 *
 * Navidrome's `/api/playlist` returns the owner as `ownerName` + `ownerId`,
 * not `owner`. We retain `owner` here as a fallback for older deployments or
 * fixtures that still emit the legacy field — the transformer prefers
 * `ownerName` when both are present.
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
 * Transform a raw playlist from Navidrome API to a clean DTO
 * @param rawPlaylist Raw playlist data from API
 * @returns Clean playlist DTO for LLM consumption
 */
export function transformToPlaylistDTO(rawPlaylist: RawPlaylist): PlaylistDTO {
  // Owner field naming: live Navidrome (>=0.50) emits `ownerName` /
  // `ownerId`; older mocks / fixtures still ship `owner` as a string.
  // Prefer the real-world shape but accept the legacy one so existing test
  // fixtures keep working.
  const owner = rawPlaylist.ownerName ?? rawPlaylist.owner ?? '';

  const dto: PlaylistDTO = {
    id: rawPlaylist.id,
    name: rawPlaylist.name || '',
    public: rawPlaylist.public || false,
    songCount: rawPlaylist.songCount || 0,
    durationFormatted: formatDuration(rawPlaylist.duration),
    owner,
  };

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
 * @returns Array of clean playlist DTOs
 */
export function transformPlaylistsToDTO(rawPlaylists: unknown): PlaylistDTO[] {
  if (!Array.isArray(rawPlaylists)) {
    return [];
  }

  // Guard each element: Navidrome can return null / non-object entries on
  // certain API errors. The `as RawPlaylist` cast would pass TS but crash the
  // single-item transformer at runtime, aborting the whole batch. Drop the
  // bad rows instead so one malformed entry doesn't lose every good one.
  return rawPlaylists
    .filter((playlist): playlist is RawPlaylist => typeof playlist === 'object' && playlist !== null)
    .map((playlist) => transformToPlaylistDTO(playlist));
}