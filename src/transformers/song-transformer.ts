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
import { parseLocalLyrics } from './lyrics-tag.js';
import {
  formatDuration,
  extractGenre,
  extractAllGenres,
  shouldEmit,
  starredFields,
  transformObjectRows,
  type TransformOptions,
} from './shared-transformers.js';

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
  lyrics?: string;
  [key: string]: unknown;
}


/**
 * Transform a raw song from Navidrome API to a clean DTO
 * @param rawSong Raw song data from API
 * @param options Verbosity controls (see {@link TransformOptions}). Default
 *   compact: only the identity block below is emitted. Verbose/keep restore
 *   the secondary fields.
 * @returns Clean song DTO for LLM consumption
 */
export function transformToSongDTO(rawSong: RawSong, options?: TransformOptions): SongDTO {
  // Only the presence and the timing of the file's lyrics survive. Carrying the
  // text itself would put a full lyric sheet on every row of every listing.
  const localLyrics = parseLocalLyrics(rawSong.lyrics);

  // Identity block, always emitted (these are what makes a song actionable).
  const dto: SongDTO = {
    id: rawSong.id,
    title: rawSong.title || '',
    artist: rawSong.artist || '',
    artistId: rawSong.artistId,
    album: rawSong.album || '',
    albumId: rawSong.albumId,
    durationFormatted: formatDuration(rawSong.duration),
    ...(localLyrics !== null ? { lyrics: localLyrics.hasSynced ? 'synced' as const : 'unsynced' as const } : {}),
  };

  // A fabricated timestamp would mislead, so addedDate is omitted when the row lacks createdAt.
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

  if (shouldEmit('duration', options) && rawSong.duration !== undefined) {
    dto.duration = rawSong.duration;
  }

  if (shouldEmit('year', options) && rawSong.year !== undefined && rawSong.year > 0) {
    dto.year = rawSong.year;
  }

  if (shouldEmit('path', options) && rawSong.path !== undefined && rawSong.path !== '') {
    dto.path = rawSong.path;
  }

  if (shouldEmit('trackNumber', options) && rawSong.trackNumber !== undefined) {
    dto.trackNumber = rawSong.trackNumber;
  }

  // Navidrome omits playCount for never-played rows, so an explicit 0 separates never played from unavailable.
  if (shouldEmit('playCount', options)) {
    dto.playCount = rawSong.playCount ?? 0;
  }

  if (shouldEmit('rating', options) && rawSong.rating !== undefined && rawSong.rating > 0) {
    dto.rating = rawSong.rating;
  }

  Object.assign(dto, starredFields(rawSong, options));

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
  return transformObjectRows(rawSongs, (song: RawSong) => transformToSongDTO(song, options));
}

