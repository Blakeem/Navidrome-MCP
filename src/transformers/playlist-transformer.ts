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
 * Raw playlist data from Navidrome API
 */
export interface RawPlaylist {
  id: string;
  name: string;
  comment?: string;
  public: boolean;
  songCount: number;
  duration?: number;
  owner: string;
  [key: string]: unknown;
}

/**
 * Transform a raw playlist from Navidrome API to a clean DTO
 * @param rawPlaylist Raw playlist data from API
 * @returns Clean playlist DTO for LLM consumption
 */
export function transformToPlaylistDTO(rawPlaylist: RawPlaylist): PlaylistDTO {
  const dto: PlaylistDTO = {
    id: rawPlaylist.id,
    name: rawPlaylist.name || '',
    public: rawPlaylist.public || false,
    songCount: rawPlaylist.songCount || 0,
    durationFormatted: formatDuration(rawPlaylist.duration),
    owner: rawPlaylist.owner || '',
  };

  if (rawPlaylist.comment !== undefined) {
    dto.comment = rawPlaylist.comment;
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

  return rawPlaylists.map((playlist) => transformToPlaylistDTO(playlist as RawPlaylist));
}