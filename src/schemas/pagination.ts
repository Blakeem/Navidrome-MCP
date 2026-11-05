/**
 * Navidrome MCP Server - Pagination Schema Definitions
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import { DEFAULT_VALUES } from '../constants/defaults.js';
import { createLimitSchema, ItemListTypeSchema, OffsetSchema, OrderSchema, PlaylistIdSchema, VerboseSchema } from './common.js';

// `onlyWithPlayableTracks` defaults to false, since the LLM also adds songs to empty and
// other-library playlists that the playable-only view hides.
export const PlaylistPaginationSchema = z.object({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.PLAYLISTS_LIMIT),
  offset: OffsetSchema,
  sort: z.enum(['name', 'songCount', 'duration', 'createdAt', 'updatedAt']).optional().default('name'),
  order: OrderSchema,
  onlyWithPlayableTracks: z.boolean().optional().default(false),
});

export const PlaylistTracksPaginationSchema = PlaylistIdSchema.extend({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.PLAYLIST_TRACKS_LIMIT),
  offset: OffsetSchema,
  format: z.enum(['json', 'm3u']).optional().default('json'),
  verbose: VerboseSchema,
});

export const PlayQueuePaginationSchema = z.strictObject({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.PLAY_QUEUE_LIMIT),
  offset: OffsetSchema,
});

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