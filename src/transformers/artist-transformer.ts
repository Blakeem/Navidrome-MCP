/**
 * Navidrome MCP Server - Artist Data Transformers
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

import type { ArtistDTO } from '../types/index.js';
import {
  extractAllGenres,
  shouldEmit,
  starredFields,
  transformObjectRows,
  type TransformOptions,
} from './shared-transformers.js';

/**
 * Raw artist data from Navidrome API
 */
export interface RawArtist {
  id: string;
  name: string;
  albumCount: number;
  songCount: number;
  genres?: Array<{ id: string; name: string }>;
  biography?: string;
  playCount?: number;
  rating?: number;
  starred?: boolean | null;
  starredAt?: string;
  [key: string]: unknown;
}

/**
 * Transform a raw artist from Navidrome API to a clean DTO
 * @param rawArtist Raw artist data from API
 * @param options Verbosity controls (see {@link TransformOptions}). Default
 *   compact: only the identity block is emitted. Verbose/keep restore the rest.
 * @returns Clean artist DTO for LLM consumption
 */
export function transformToArtistDTO(rawArtist: RawArtist, options?: TransformOptions): ArtistDTO {
  // Identity block, always emitted.
  const dto: ArtistDTO = {
    id: rawArtist.id,
    name: rawArtist.name || '',
    albumCount: rawArtist.albumCount || 0,
    songCount: rawArtist.songCount || 0,
  };

  // Navidrome omits playCount for never-played rows, so an explicit 0 separates never played from unavailable.
  if (shouldEmit('playCount', options)) {
    dto.playCount = rawArtist.playCount ?? 0;
  }

  if (shouldEmit('genres', options)) {
    const genres = extractAllGenres(rawArtist);
    if (genres !== undefined) {
      dto.genres = genres;
    }
  }

  if (shouldEmit('biography', options) && rawArtist.biography !== undefined && rawArtist.biography !== '') {
    dto.biography = rawArtist.biography;
  }

  if (shouldEmit('rating', options) && rawArtist.rating !== undefined && rawArtist.rating > 0) {
    dto.rating = rawArtist.rating;
  }

  Object.assign(dto, starredFields(rawArtist, options));

  return dto;
}

/**
 * Transform an array of raw artists to DTOs
 * @param rawArtists Array of raw artist data
 * @param options Verbosity controls forwarded to each item (see {@link TransformOptions})
 * @returns Array of clean artist DTOs
 */
export function transformArtistsToDTO(rawArtists: unknown, options?: TransformOptions): ArtistDTO[] {
  return transformObjectRows(rawArtists, (artist: RawArtist) => transformToArtistDTO(artist, options));
}