/**
 * Navidrome MCP Server - Artist Data Transformers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ArtistDTO } from '../types/index.js';
import {
  extractAllGenres,
  shouldEmit,
  starredFields,
  transformObjectRows,
  type TransformOptions,
} from './shared-transformers.js';

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

export function transformToArtistDTO(rawArtist: RawArtist, options?: TransformOptions): ArtistDTO {
  const dto: ArtistDTO = {
    id: rawArtist.id,
    name: rawArtist.name || '',
    albumCount: rawArtist.albumCount || 0,
    songCount: rawArtist.songCount || 0,
  };

  // Navidrome omits playCount on a never-played row. An explicit 0 keeps never played distinct
  // from not reported.
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

export function transformArtistsToDTO(rawArtists: unknown, options?: TransformOptions): ArtistDTO[] {
  return transformObjectRows(rawArtists, (artist: RawArtist) => transformToArtistDTO(artist, options));
}