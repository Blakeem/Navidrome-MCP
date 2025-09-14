/**
 * Navidrome MCP Server - Song Data Transformers
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

import type { SongDTO } from '../types/index.js';
import { formatDuration, extractGenre, extractAllGenres } from './shared-transformers.js';

/**
 * Raw song data from Navidrome API
 */
export interface RawSong {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  albumArtist?: string;
  albumArtistId?: string;
  genre?: string;
  genres?: Array<{ id: string; name: string }>;
  year?: number;
  duration?: number;
  trackNumber?: number;
  playCount?: number;
  rating?: number;
  starred?: boolean;
  createdAt?: string;
  path?: string;
  [key: string]: unknown; // Allow other fields we don't use
}


/**
 * Transform a raw song from Navidrome API to a clean DTO
 * @param rawSong Raw song data from API
 * @returns Clean song DTO for LLM consumption
 */
export function transformToSongDTO(rawSong: RawSong): SongDTO {
  const dto: SongDTO = {
    id: rawSong.id,
    title: rawSong.title || '',
    artist: rawSong.artist || '',
    artistId: rawSong.artistId,
    album: rawSong.album || '',
    albumId: rawSong.albumId,
    durationFormatted: formatDuration(rawSong.duration),
    addedDate: rawSong.createdAt ?? new Date().toISOString(),
  };

  // Add optional fields only if they have values
  const genre = extractGenre(rawSong);
  if (genre !== undefined) {
    dto.genre = genre;
  }

  const genres = extractAllGenres(rawSong);
  if (genres !== undefined) {
    dto.genres = genres;
  }

  if (rawSong.year !== undefined) {
    dto.year = rawSong.year;
  }

  if (rawSong.path !== undefined) {
    dto.path = rawSong.path as string;
  }

  if (rawSong.trackNumber !== undefined) {
    dto.trackNumber = rawSong.trackNumber;
  }

  if (rawSong.playCount !== undefined) {
    dto.playCount = rawSong.playCount;
  }

  if (rawSong.rating !== undefined) {
    dto.rating = rawSong.rating;
  }

  if (rawSong.starred !== undefined) {
    dto.starred = rawSong.starred;
  }

  return dto;
}


/**
 * Transform an array of raw songs to DTOs
 * @param rawSongs Array of raw song data
 * @returns Array of clean song DTOs
 */
export function transformSongsToDTO(rawSongs: unknown): SongDTO[] {
  if (!Array.isArray(rawSongs)) {
    return [];
  }

  return rawSongs.map((song) => transformToSongDTO(song as RawSong));
}

