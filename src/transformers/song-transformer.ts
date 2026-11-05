/**
 * Navidrome MCP Server - Song Data Transformers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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


export function transformToSongDTO(rawSong: RawSong, options?: TransformOptions): SongDTO {
  // Only whether the file has lyrics, and whether they are synced, reaches the DTO. The text
  // would put a full lyric sheet on every row of every listing.
  const localLyrics = parseLocalLyrics(rawSong.lyrics);

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

  // Navidrome omits playCount on a never-played row. An explicit 0 keeps never played distinct
  // from not reported.
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


export function transformSongsToDTO(rawSongs: unknown, options?: TransformOptions): SongDTO[] {
  return transformObjectRows(rawSongs, (song: RawSong) => transformToSongDTO(song, options));
}

