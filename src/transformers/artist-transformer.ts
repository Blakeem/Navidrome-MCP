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

/**
 * Raw artist data from Navidrome API
 */
export interface RawArtist {
  id: string;
  name: string;
  albumCount: number;
  songCount: number;
  genres?: string[];
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
 * @returns Clean artist DTO for LLM consumption
 */
export function transformToArtistDTO(rawArtist: RawArtist): ArtistDTO {
  const dto: ArtistDTO = {
    id: rawArtist.id,
    name: rawArtist.name || '',
    albumCount: rawArtist.albumCount || 0,
    songCount: rawArtist.songCount || 0,
    // Default to 0 explicitly. Navidrome omits `playCount` entirely for
    // never-played artists (only emits the field for playCount > 0), which
    // made sort=playCount results ambiguous: an LLM couldn't distinguish
    // "never played" from "field unavailable". An explicit zero is the
    // unambiguous representation.
    playCount: rawArtist.playCount ?? 0,
  };

  if (rawArtist.genres !== undefined) {
    dto.genres = rawArtist.genres;
  }

  if (rawArtist.biography !== undefined) {
    dto.biography = rawArtist.biography;
  }

  if (rawArtist.rating !== undefined) {
    dto.rating = rawArtist.rating;
  }

  // Mirror album-transformer behaviour: starredAt is authoritative for the
  // starred state. The artist endpoint hasn't been observed to return
  // `starred: null` in the wild, but the consistency makes the DTOs easier
  // to reason about and guards us against future inconsistencies.
  if (rawArtist.starredAt !== undefined && rawArtist.starredAt !== null) {
    dto.starred = true;
    dto.starredAt = rawArtist.starredAt;
  } else if (rawArtist.starred === true || rawArtist.starred === false) {
    dto.starred = rawArtist.starred;
  }

  return dto;
}

/**
 * Transform an array of raw artists to DTOs
 * @param rawArtists Array of raw artist data
 * @returns Array of clean artist DTOs
 */
export function transformArtistsToDTO(rawArtists: unknown): ArtistDTO[] {
  if (!Array.isArray(rawArtists)) {
    return [];
  }

  return rawArtists.map((artist) => transformToArtistDTO(artist as RawArtist));
}