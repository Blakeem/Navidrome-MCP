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
import { shouldEmit, type TransformOptions } from './shared-transformers.js';

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
 * @param options Verbosity controls (see {@link TransformOptions}). Default
 *   compact: only the identity block is emitted; verbose/keep restore the rest.
 * @returns Clean artist DTO for LLM consumption
 */
export function transformToArtistDTO(rawArtist: RawArtist, options?: TransformOptions): ArtistDTO {
  // Identity block — always emitted.
  const dto: ArtistDTO = {
    id: rawArtist.id,
    name: rawArtist.name || '',
    albumCount: rawArtist.albumCount || 0,
    songCount: rawArtist.songCount || 0,
  };

  // Default to 0 explicitly when emitted. Navidrome omits `playCount` entirely
  // for never-played artists (only emits the field for playCount > 0), which
  // made sort=playCount results ambiguous: an LLM couldn't distinguish "never
  // played" from "field unavailable". An explicit zero is the unambiguous
  // representation. Gated so compact output (where playCount is irrelevant)
  // stays lean; list_most_played force-keeps it.
  if (shouldEmit('playCount', options)) {
    dto.playCount = rawArtist.playCount ?? 0;
  }

  if (shouldEmit('genres', options) && rawArtist.genres !== undefined) {
    const filtered = rawArtist.genres.filter(g => g.length > 0);
    if (filtered.length > 0) {
      dto.genres = filtered;
    }
  }

  if (shouldEmit('biography', options) && rawArtist.biography !== undefined && rawArtist.biography !== '') {
    dto.biography = rawArtist.biography;
  }

  if (shouldEmit('rating', options) && rawArtist.rating !== undefined && rawArtist.rating > 0) {
    dto.rating = rawArtist.rating;
  }

  // The `starred` boolean is authoritative. Navidrome retains `starredAt`
  // as a "last starred at" history field even after unstarring, so a
  // populated timestamp alone does NOT mean the item is currently starred.
  // Only echo `starredAt` when the boolean confirms the starred state.
  if (shouldEmit('starred', options)) {
    if (rawArtist.starred === true) {
      dto.starred = true;
      if (rawArtist.starredAt !== undefined) {
        dto.starredAt = rawArtist.starredAt;
      }
    } else if (rawArtist.starred === false) {
      dto.starred = false;
    }
  }

  return dto;
}

/**
 * Transform an array of raw artists to DTOs
 * @param rawArtists Array of raw artist data
 * @param options Verbosity controls forwarded to each item (see {@link TransformOptions})
 * @returns Array of clean artist DTOs
 */
export function transformArtistsToDTO(rawArtists: unknown, options?: TransformOptions): ArtistDTO[] {
  if (!Array.isArray(rawArtists)) {
    return [];
  }

  // Guard each element: Navidrome can return null / non-object entries on
  // certain API errors. The `as RawArtist` cast would pass TS but crash the
  // single-item transformer at runtime, aborting the whole batch. Drop the
  // bad rows instead so one malformed entry doesn't lose every good one.
  return rawArtists
    .filter((artist): artist is RawArtist => typeof artist === 'object' && artist !== null)
    .map((artist) => transformToArtistDTO(artist, options));
}