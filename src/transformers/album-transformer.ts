/**
 * Navidrome MCP Server - Album Data Transformers
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

import type { AlbumDTO } from '../types/index.js';
import { formatDuration, extractGenre, extractAllGenres } from './shared-transformers.js';

/**
 * Raw album data from Navidrome API
 */
export interface RawAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  albumArtist?: string;
  albumArtistId?: string;
  releaseYear?: number;
  genre?: string;
  genres?: Array<{ id: string; name: string }>;
  songCount: number;
  duration?: number;
  compilation?: boolean;
  playCount?: number;
  rating?: number;
  starred?: boolean;
  [key: string]: unknown;
}

/**
 * Transform a raw album from Navidrome API to a clean DTO
 * @param rawAlbum Raw album data from API
 * @returns Clean album DTO for LLM consumption
 */
export function transformToAlbumDTO(rawAlbum: RawAlbum): AlbumDTO {
  const dto: AlbumDTO = {
    id: rawAlbum.id,
    name: rawAlbum.name || '',
    artist: rawAlbum.artist || '',
    artistId: rawAlbum.artistId,
    songCount: rawAlbum.songCount || 0,
    durationFormatted: formatDuration(rawAlbum.duration),
  };

  if (rawAlbum.albumArtist !== undefined) {
    dto.albumArtist = rawAlbum.albumArtist;
  }

  if (rawAlbum.albumArtistId !== undefined) {
    dto.albumArtistId = rawAlbum.albumArtistId;
  }

  if (rawAlbum.releaseYear !== undefined) {
    dto.releaseYear = rawAlbum.releaseYear;
  }

  const genre = extractGenre(rawAlbum);
  if (genre !== undefined) {
    dto.genre = genre;
  }

  const genres = extractAllGenres(rawAlbum);
  if (genres !== undefined) {
    dto.genres = genres;
  }

  if (rawAlbum.compilation !== undefined) {
    dto.compilation = rawAlbum.compilation;
  }

  if (rawAlbum.playCount !== undefined) {
    dto.playCount = rawAlbum.playCount;
  }

  if (rawAlbum.rating !== undefined) {
    dto.rating = rawAlbum.rating;
  }

  if (rawAlbum.starred !== undefined) {
    dto.starred = rawAlbum.starred;
  }

  return dto;
}

/**
 * Transform an array of raw albums to DTOs
 * @param rawAlbums Array of raw album data
 * @returns Array of clean album DTOs
 */
export function transformAlbumsToDTO(rawAlbums: unknown): AlbumDTO[] {
  if (!Array.isArray(rawAlbums)) {
    return [];
  }

  return rawAlbums.map((album) => transformToAlbumDTO(album as RawAlbum));
}