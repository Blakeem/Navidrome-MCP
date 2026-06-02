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
import { formatDuration, extractGenre, extractAllGenres, shouldEmit, type TransformOptions } from './shared-transformers.js';

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
  starred?: boolean | null;
  starredAt?: string;
  playDate?: string;
  createdAt?: string;
  path?: string;
  [key: string]: unknown; // Allow other fields we don't use
}


/**
 * Transform a raw song from Navidrome API to a clean DTO
 * @param rawSong Raw song data from API
 * @param options Verbosity controls (see {@link TransformOptions}). Default
 *   compact: only the identity block below is emitted; verbose/keep restore
 *   the secondary fields.
 * @returns Clean song DTO for LLM consumption
 */
export function transformToSongDTO(rawSong: RawSong, options?: TransformOptions): SongDTO {
  // Identity block — always emitted (these are what makes a song actionable).
  const dto: SongDTO = {
    id: rawSong.id,
    title: rawSong.title || '',
    artist: rawSong.artist || '',
    artistId: rawSong.artistId,
    album: rawSong.album || '',
    albumId: rawSong.albumId,
    durationFormatted: formatDuration(rawSong.duration),
  };

  // Secondary fields — emitted only in verbose mode (or when force-kept). Each
  // is still added only if the source actually provides a value.

  // Only emit addedDate when the source actually provides it. Navidrome's REST
  // API always supplies `createdAt`; omitting (rather than fabricating `now`)
  // keeps the value honest for any row that doesn't, matching every other
  // optional field below.
  if (shouldEmit('addedDate', options) && rawSong.createdAt !== undefined && rawSong.createdAt !== '') {
    dto.addedDate = rawSong.createdAt;
  }

  if (shouldEmit('genre', options)) {
    const genre = extractGenre(rawSong);
    if (genre !== undefined) {
      dto.genre = genre;
    }
  }

  if (shouldEmit('genres', options)) {
    const genres = extractAllGenres(rawSong);
    if (genres !== undefined) {
      dto.genres = genres;
    }
  }

  if (shouldEmit('year', options) && rawSong.year !== undefined && rawSong.year > 0) {
    dto.year = rawSong.year;
  }

  if (shouldEmit('path', options) && rawSong.path !== undefined) {
    dto.path = rawSong.path;
  }

  if (shouldEmit('trackNumber', options) && rawSong.trackNumber !== undefined) {
    dto.trackNumber = rawSong.trackNumber;
  }

  if (shouldEmit('playCount', options) && rawSong.playCount !== undefined) {
    dto.playCount = rawSong.playCount;
  }

  if (shouldEmit('rating', options) && rawSong.rating !== undefined && rawSong.rating > 0) {
    dto.rating = rawSong.rating;
  }

  // The `starred` boolean is authoritative. Navidrome retains `starredAt`
  // as a "last starred at" history field even after unstarring, so a
  // populated timestamp alone does NOT mean the item is currently starred.
  // Only echo `starredAt` when the boolean confirms the starred state.
  if (shouldEmit('starred', options)) {
    if (rawSong.starred === true) {
      dto.starred = true;
      if (rawSong.starredAt !== undefined) {
        dto.starredAt = rawSong.starredAt;
      }
    } else if (rawSong.starred === false) {
      dto.starred = false;
    }
  }

  if (shouldEmit('playDate', options) && rawSong.playDate !== undefined && rawSong.playDate !== '') {
    dto.playDate = rawSong.playDate;
  }

  if (shouldEmit('albumArtist', options) && rawSong.albumArtist !== undefined && rawSong.albumArtist !== '') {
    dto.albumArtist = rawSong.albumArtist;
  }

  if (shouldEmit('albumArtistId', options) && rawSong.albumArtistId !== undefined && rawSong.albumArtistId !== '') {
    dto.albumArtistId = rawSong.albumArtistId;
  }

  return dto;
}


/**
 * Transform an array of raw songs to DTOs
 * @param rawSongs Array of raw song data
 * @param options Verbosity controls forwarded to each item (see {@link TransformOptions})
 * @returns Array of clean song DTOs
 */
export function transformSongsToDTO(rawSongs: unknown, options?: TransformOptions): SongDTO[] {
  if (!Array.isArray(rawSongs)) {
    return [];
  }

  // Guard each element: Navidrome can return null / non-object entries on
  // certain API errors. The `as RawSong` cast would pass TS but crash the
  // single-item transformer at runtime, aborting the whole batch. Drop the
  // bad rows instead so one malformed entry doesn't lose every good one.
  return rawSongs
    .filter((song): song is RawSong => typeof song === 'object' && song !== null)
    .map((song) => transformToSongDTO(song, options));
}

