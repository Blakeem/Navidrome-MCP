/**
 * Navidrome MCP Server - Shared Transformer Utilities
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

/**
 * Common interfaces shared across transformers
 */

/**
 * Base interface for entities with genre information
 */
interface RawEntityWithGenres {
  genre?: string;
  genres?: Array<{ id: string; name: string }>;
  [key: string]: unknown;
}

/**
 * Controls how much per-item detail a transformer emits. The default
 * (compact) mode emits only the identity fields each DTO needs to be
 * recognized and acted on (ids, title/name, artist, album, durationFormatted),
 * keeping large array responses well under the tool-result token cap. Verbose
 * mode restores every field. `keep` force-emits specific fields in compact mode
 * for tools whose entire purpose is a particular metric — e.g. `playCount` for
 * list_most_played, `starred`/`starredAt` for list_starred_items.
 */
export interface TransformOptions {
  /** When true, emit all fields. Default false (compact). */
  verbose?: boolean;
  /** Field names to force-emit even in compact mode. */
  keep?: readonly string[];
}

/**
 * Decide whether an optional/secondary field should be emitted given the
 * transform options. A field is emitted when verbose is on OR it is explicitly
 * named in `keep`. Identity fields never go through this gate — they are always
 * emitted directly by each transformer.
 *
 * NOTE: `keep` must name the field a transformer actually gates on. For coupled
 * fields that is the gate field, not the dependent one: `starredAt` is emitted
 * inside the `shouldEmit('starred', …)` block, so force-keeping the starred
 * state needs `keep: ['starred']`; `keep: ['starredAt']` alone emits nothing.
 */
export function shouldEmit(field: string, options?: TransformOptions): boolean {
  if (options?.verbose === true) {
    return true;
  }
  return options?.keep?.includes(field) ?? false;
}

/**
 * Parse a `MM:SS` formatted duration string into total seconds.
 * Returns 0 for any input that does not match the two-part `MM:SS` shape.
 * Inverse of {@link formatDuration}.
 * @param durationFormatted A duration string like "3:45"
 * @returns Total seconds, or 0 if the input cannot be parsed
 */
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

/**
 * Format duration from seconds to MM:SS format
 * @param seconds Duration in seconds
 * @returns Formatted string like "3:45"
 */
export function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Extract the primary genre from various formats
 * @param entity The entity with genre data
 * @returns The primary genre name or undefined
 */
export function extractGenre(entity: RawEntityWithGenres): string | undefined {
  // Try genres array first (newer format)
  if (entity.genres && Array.isArray(entity.genres) && entity.genres.length > 0) {
    const first = entity.genres.find(g => g.name !== '');
    if (first) {
      return first.name;
    }
  }
  // Fall back to genre string
  if (entity.genre !== undefined && entity.genre !== '') {
    return entity.genre;
  }
  return undefined;
}

/**
 * Extract all genres from an entity with genre data
 * @param entity The entity with genre data
 * @returns Array of genre names or undefined
 */
export function extractAllGenres(entity: RawEntityWithGenres): string[] | undefined {
  // Try genres array first (newer format)
  if (entity.genres && Array.isArray(entity.genres) && entity.genres.length > 0) {
    const names = entity.genres.map(g => g.name).filter(Boolean);
    return names.length > 0 ? names : undefined;
  }
  // Fall back to single genre string as array
  if (entity.genre !== undefined && entity.genre !== '') {
    return [entity.genre];
  }
  return undefined;
}