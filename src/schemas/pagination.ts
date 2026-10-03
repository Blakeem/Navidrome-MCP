/**
 * Navidrome MCP Server - Pagination Schema Definitions
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
import { DEFAULT_VALUES } from '../constants/defaults.js';
import { createLimitSchema, ItemListTypeSchema, OffsetSchema, OrderSchema, PlaylistIdSchema, VerboseSchema } from './common.js';

// Base pagination schema factory
const createPaginationSchema = (
  limitDefault: number,
  maxLimit = 500,
  sortDefault = 'name'
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- schema factory. Its return type is inferred by zod, and an explicit annotation would be unwieldy
) => z.object({
  limit: createLimitSchema(1, maxLimit, limitDefault),
  offset: OffsetSchema,
  sort: z.string().optional().default(sortDefault),
  order: OrderSchema,
});

// Specific pagination schemas for different resources.
//
// `onlyWithPlayableTracks` (default false) gates an extra per-playlist probe:
// when true, `list_playlists` returns only playlists with >=1 track in the
// currently active libraries. Default false preserves the full management view
// (so the LLM can still add songs to empty/other-library playlists).
export const PlaylistPaginationSchema = createPaginationSchema(
  DEFAULT_VALUES.PLAYLISTS_LIMIT,
  500,
  'name'
).extend({
  sort: z.enum(['name', 'songCount', 'duration', 'createdAt', 'updatedAt']).optional().default('name'),
  onlyWithPlayableTracks: z.boolean().optional().default(false),
});

export const PlaylistTracksPaginationSchema = PlaylistIdSchema.extend({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.PLAYLIST_TRACKS_LIMIT),
  offset: OffsetSchema,
  format: z.enum(['json', 'm3u']).optional().default('json'),
  verbose: VerboseSchema,
});

// User preferences pagination. The type accepts singular or plural (see ItemListTypeSchema in common.ts)
export const StarredItemsPaginationSchema = z.object({
  type: ItemListTypeSchema,
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.STARRED_ITEMS_LIMIT),
  offset: OffsetSchema,
  verbose: VerboseSchema,
});

export const TopRatedItemsPaginationSchema = z.object({
  type: ItemListTypeSchema,
  minRating: z.number().int().min(1).max(5).optional().default(4),
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.TOP_RATED_LIMIT),
  offset: OffsetSchema,
  verbose: VerboseSchema,
});

// Listening history pagination
export const RecentlyPlayedPaginationSchema = z.object({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.RECENTLY_PLAYED_LIMIT),
  offset: OffsetSchema,
  timeRange: z.enum(['today', 'week', 'month', 'all']).optional().default('all'),
  verbose: VerboseSchema,
});

export const MostPlayedPaginationSchema = z.object({
  type: ItemListTypeSchema.optional().default('songs'),
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.MOST_PLAYED_LIMIT),
  offset: OffsetSchema,
  minPlayCount: z.number().min(1).optional().default(1),
  verbose: VerboseSchema,
});