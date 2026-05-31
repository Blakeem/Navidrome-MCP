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
 *
 * Navidrome's `/api/album` rows do NOT include a top-level `artist`/`artistId`
 * field — only `albumArtist`/`albumArtistId`. We carry both shapes here so the
 * transformer can fall back cleanly when the REST surface omits `artist`.
 *
 * Year is exposed as `maxYear` / `minYear` (release date range) and
 * `maxOriginalYear` / `minOriginalYear` (original release date range). We
 * synthesize `releaseYear` from `maxYear` (preferred) with `minYear` /
 * `maxOriginalYear` as fallbacks.
 */
export interface RawAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  albumArtist?: string;
  albumArtistId?: string;
  releaseYear?: number;
  maxYear?: number;
  minYear?: number;
  maxOriginalYear?: number;
  minOriginalYear?: number;
  genre?: string;
  genres?: Array<{ id: string; name: string }>;
  songCount: number;
  duration?: number;
  compilation?: boolean;
  playCount?: number;
  rating?: number;
  starred?: boolean | null;
  starredAt?: string;
  [key: string]: unknown;
}

/**
 * Pick the most informative non-empty string from a list of candidates. Treats
 * empty strings, null, and undefined as "missing" so we fall through to the
 * next candidate. Used to recover `artist`/`artistId` from `albumArtist` when
 * the Navidrome listing omits the artist fields.
 */
function pickString(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Pick the first finite, non-zero number from candidates. Navidrome reports
 * "year unknown" as `0`, so we treat zero as missing rather than emitting it
 * as a valid release year (which would be misleading).
 */
function pickYear(...candidates: Array<number | undefined>): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Transform a raw album from Navidrome API to a clean DTO
 * @param rawAlbum Raw album data from API
 * @returns Clean album DTO for LLM consumption
 */
export function transformToAlbumDTO(rawAlbum: RawAlbum): AlbumDTO {
  // The REST `/api/album` listing leaves the top-level `artist` field unset;
  // only `albumArtist` is populated. Fall back to `albumArtist` so the DTO
  // never carries an empty `artist` string when there's a perfectly good
  // value one field over.
  const artist = pickString(rawAlbum.artist, rawAlbum.albumArtist) ?? '';
  const artistId = pickString(rawAlbum.artistId, rawAlbum.albumArtistId) ?? '';

  const dto: AlbumDTO = {
    id: rawAlbum.id,
    name: rawAlbum.name || '',
    artist,
    artistId,
    songCount: rawAlbum.songCount || 0,
    durationFormatted: formatDuration(rawAlbum.duration),
  };

  if (rawAlbum.albumArtist !== undefined && rawAlbum.albumArtist !== '') {
    dto.albumArtist = rawAlbum.albumArtist;
  }

  if (rawAlbum.albumArtistId !== undefined && rawAlbum.albumArtistId !== '') {
    dto.albumArtistId = rawAlbum.albumArtistId;
  }

  // Year handling: API exposes maxYear / minYear (release date range) and
  // maxOriginalYear / minOriginalYear (original release date). Prefer the
  // explicit `releaseYear` if a caller already normalised it; otherwise use
  // the latest release year, falling back to the earliest, then the original.
  const releaseYear = pickYear(
    rawAlbum.releaseYear,
    rawAlbum.maxYear,
    rawAlbum.minYear,
    rawAlbum.maxOriginalYear,
    rawAlbum.minOriginalYear,
  );
  if (releaseYear !== undefined) {
    dto.releaseYear = releaseYear;
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

  if (rawAlbum.rating !== undefined && rawAlbum.rating > 0) {
    dto.rating = rawAlbum.rating;
  }

  // The `starred` boolean is authoritative. Navidrome retains `starredAt`
  // as a "last starred at" history field even after unstarring, so a
  // populated timestamp alone does NOT mean the item is currently starred.
  // Only echo `starredAt` when the boolean confirms the starred state.
  if (rawAlbum.starred === true) {
    dto.starred = true;
    if (rawAlbum.starredAt !== undefined) {
      dto.starredAt = rawAlbum.starredAt;
    }
  } else if (rawAlbum.starred === false) {
    dto.starred = false;
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

  // Guard each element: Navidrome can return null / non-object entries on
  // certain API errors. The `as RawAlbum` cast would pass TS but crash the
  // single-item transformer at runtime, aborting the whole batch. Drop the
  // bad rows instead so one malformed entry doesn't lose every good one.
  return rawAlbums
    .filter((album): album is RawAlbum => typeof album === 'object' && album !== null)
    .map((album) => transformToAlbumDTO(album));
}