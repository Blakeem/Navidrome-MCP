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
export interface RawEntityWithGenres {
  genre?: string;
  genres?: Array<{ id: string; name: string }>;
  [key: string]: unknown;
}

/**
 * Format duration from seconds to MM:SS format
 * @param seconds Duration in seconds
 * @returns Formatted string like "3:45"
 */
export function formatDuration(seconds?: number): string {
  if (seconds === null || seconds === undefined || seconds <= 0) {
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
    const firstGenre = entity.genres[0];
    if (firstGenre) {
      return firstGenre.name;
    }
  }
  // Fall back to genre string
  if (entity.genre !== null && entity.genre !== undefined && entity.genre !== '') {
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
    return entity.genres.map(g => g.name).filter(Boolean);
  }
  // Fall back to single genre string as array
  if (entity.genre !== null && entity.genre !== undefined && entity.genre !== '') {
    return [entity.genre];
  }
  return undefined;
}