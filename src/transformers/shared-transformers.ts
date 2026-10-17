/**
 * Navidrome MCP Server - Shared Transformer Utilities
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

interface RawEntityWithGenres {
  genre?: string;
  genres?: Array<{ name: string }>;
  [key: string]: unknown;
}

// Every gate name a transformer checks, so a `keep` entry that no transformer gates on fails to
// compile.
type TransformField =
  | 'addedDate'
  | 'albumArtist'
  | 'albumArtistId'
  | 'biography'
  | 'bitRate'
  | 'compilation'
  | 'duration'
  | 'genre'
  | 'genres'
  | 'path'
  | 'playCount'
  | 'playDate'
  | 'playlistId'
  | 'rating'
  | 'releaseYear'
  | 'starred'
  | 'trackNumber'
  | 'year';

/**
 * Compact mode, the default, emits only identity fields so large array responses stay under the
 * tool-result token cap. `keep` force-emits a field one caller needs, such as `playCount` for
 * list_most_played.
 */
export interface TransformOptions {
  verbose?: boolean;
  keep?: readonly TransformField[];
}

/**
 * Identity fields bypass this gate, since each transformer emits them directly.
 * Dependent fields such as `starredAt` are emitted under their gate field (`starred`).
 */
export function shouldEmit(field: TransformField, options?: TransformOptions): boolean {
  if (options?.verbose === true) {
    return true;
  }
  return options?.keep?.includes(field) ?? false;
}

/**
 * Navidrome omits `starred` when false, so only `true` marks a star.
 * `starredAt` outlives an unstar, so it is echoed only with `starred: true`.
 */
export function starredFields(
  raw: { starred?: boolean | null; starredAt?: string },
  options?: TransformOptions,
): { starred?: boolean; starredAt?: string } {
  if (!shouldEmit('starred', options)) {
    return {};
  }
  if (raw.starred === true) {
    return raw.starredAt !== undefined ? { starred: true, starredAt: raw.starredAt } : { starred: true };
  }
  return { starred: false };
}

/**
 * Navidrome can return null or non-object rows on some API errors. One such row would crash the
 * single-item transformer and lose the entire batch, so non-object rows are dropped.
 */
export function transformObjectRows<T, R>(raw: unknown, transform: (row: T) => R): R[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((row): row is T => typeof row === 'object' && row !== null)
    .map((row) => transform(row));
}

/** Inverse of {@link formatDuration}. Any other shape parses as 0. */
export function parseDuration(durationFormatted: string): number {
  const parts = durationFormatted.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0] ?? '0', 10);
    const seconds = parseInt(parts[1] ?? '0', 10);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) {
      return 0;
    }
    if (minutes < 0 || seconds < 0) {
      return 0;
    }
    return minutes * 60 + seconds;
  }
  return 0;
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function extractGenre(entity: RawEntityWithGenres): string | undefined {
  if (entity.genres && Array.isArray(entity.genres) && entity.genres.length > 0) {
    const first = entity.genres.find(g => g.name !== '');
    if (first) {
      return first.name;
    }
  }
  if (entity.genre !== undefined && entity.genre !== '') {
    return entity.genre;
  }
  return undefined;
}

export function extractAllGenres(entity: RawEntityWithGenres): string[] | undefined {
  if (entity.genres && Array.isArray(entity.genres) && entity.genres.length > 0) {
    const names = entity.genres.map(g => g.name).filter(Boolean);
    if (names.length > 0) {
      return names;
    }
  }
  if (entity.genre !== undefined && entity.genre !== '') {
    return [entity.genre];
  }
  return undefined;
}