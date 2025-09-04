/**
 * Navidrome MCP Server - Common Schema Definitions
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

import { z } from 'zod';

// Basic ID validation schema
export const IdSchema = z.object({
  id: z.string().min(1, 'ID is required'),
});

// Required ID with custom message
export const createIdSchema = (resourceType: string): ReturnType<typeof z.object> => z.object({
  id: z.string().min(1, `${resourceType} ID is required`),
});

// Search query schema
export const SearchQuerySchema = z.object({
  query: z.string().min(1, 'Search query is required'),
});

// Item type enums for user preferences
export const ItemTypeSchema = z.enum(['song', 'album', 'artist']);
export const ItemListTypeSchema = z.enum(['songs', 'albums', 'artists']);

// Common limit validation patterns
export const createLimitSchema = (min = 1, max = 500, defaultValue?: number): ReturnType<typeof z.number> => {
  if (defaultValue !== undefined) {
    return z.number().min(min).max(max).optional().default(defaultValue);
  }
  return z.number().min(min).max(max);
};

// Offset schema for pagination
export const OffsetSchema = z.number().min(0).optional().default(0);

// Order enum
export const OrderSchema = z.enum(['ASC', 'DESC']).optional().default('ASC');

// Common sort fields (can be extended per tool)
export const SortSchema = z.string().optional().default('name');

// Boolean flag schema
export const OptionalBooleanSchema = z.boolean().optional();
export const RequiredBooleanSchema = z.boolean();

// Rating validation
export const RatingSchema = z.number().min(0).max(5);

// Duration validation for timeouts
export const createTimeoutSchema = (min: number, max: number, defaultValue: number): ReturnType<typeof z.number> => 
  z.number().min(min).max(max).optional().default(defaultValue);

// URL validation
export const UrlSchema = z.string().url('URL must be a valid URL');

// String array schemas
export const StringArraySchema = z.array(z.string());
export const OptionalStringArraySchema = z.array(z.string()).optional();
export const NonEmptyStringArraySchema = z.array(z.string()).min(1, 'At least one item is required');

// Common validation schemas for different resource types
export const PlaylistIdSchema = createIdSchema('Playlist');
export const SongIdSchema = createIdSchema('Song');
export const ArtistIdSchema = createIdSchema('Artist');
export const AlbumIdSchema = createIdSchema('Album');
export const TagIdSchema = createIdSchema('Tag');