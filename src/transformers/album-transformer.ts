/**
 * Navidrome MCP Server - Album Data Transformers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { AlbumDTO } from '../types/index.js';
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
 * Navidrome's `/api/album` rows carry no `artist` or `artistId`, only `albumArtist` and
 * `albumArtistId`, so the transformer falls back to those.
 */
export interface RawAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  albumArtist?: string;
  albumArtistId?: string;
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

function pickString(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/** Navidrome reports an unknown year as 0, so zero counts as missing. */
function pickYear(...candidates: Array<number | undefined>): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return undefined;
}

export function transformToAlbumDTO(rawAlbum: RawAlbum, options?: TransformOptions): AlbumDTO {
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

  if (shouldEmit('albumArtist', options) && rawAlbum.albumArtist !== undefined && rawAlbum.albumArtist !== '') {
    dto.albumArtist = rawAlbum.albumArtist;
  }

  if (shouldEmit('albumArtistId', options) && rawAlbum.albumArtistId !== undefined && rawAlbum.albumArtistId !== '') {
    dto.albumArtistId = rawAlbum.albumArtistId;
  }

  if (shouldEmit('releaseYear', options)) {
    const releaseYear = pickYear(
      rawAlbum.maxYear,
      rawAlbum.minYear,
      rawAlbum.maxOriginalYear,
      rawAlbum.minOriginalYear,
    );
    if (releaseYear !== undefined) {
      dto.releaseYear = releaseYear;
    }
  }

  if (shouldEmit('genre', options)) {
    const genre = extractGenre(rawAlbum);
    if (genre !== undefined) {
      dto.genre = genre;
    }
  }

  if (shouldEmit('genres', options)) {
    const genres = extractAllGenres(rawAlbum);
    if (genres !== undefined) {
      dto.genres = genres;
    }
  }

  if (shouldEmit('compilation', options) && rawAlbum.compilation !== undefined) {
    dto.compilation = rawAlbum.compilation;
  }

  // Navidrome omits playCount on a never-played row. An explicit 0 keeps never played distinct
  // from not reported.
  if (shouldEmit('playCount', options)) {
    dto.playCount = rawAlbum.playCount ?? 0;
  }

  if (shouldEmit('rating', options) && rawAlbum.rating !== undefined && rawAlbum.rating > 0) {
    dto.rating = rawAlbum.rating;
  }

  Object.assign(dto, starredFields(rawAlbum, options));

  return dto;
}

export function transformAlbumsToDTO(rawAlbums: unknown, options?: TransformOptions): AlbumDTO[] {
  return transformObjectRows(rawAlbums, (album: RawAlbum) => transformToAlbumDTO(album, options));
}