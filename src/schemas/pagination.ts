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
import { createLimitSchema, OffsetSchema, OrderSchema } from './common.js';

// Base pagination schema factory
export const createPaginationSchema = (
  limitDefault: number,
  maxLimit = 500,
  sortDefault = 'name'
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) => z.object({
  limit: createLimitSchema(1, maxLimit, limitDefault),
  offset: OffsetSchema,
  sort: z.string().optional().default(sortDefault),
  order: OrderSchema,
});

// Specific pagination schemas for different resources
export const PlaylistPaginationSchema = createPaginationSchema(
  DEFAULT_VALUES.PLAYLISTS_LIMIT,
  500,
  'name'
);

export const AlbumPaginationSchema = createPaginationSchema(
  DEFAULT_VALUES.ALBUMS_LIMIT,
  500,
  'name'
);

export const ArtistPaginationSchema = createPaginationSchema(
  DEFAULT_VALUES.ALBUMS_LIMIT, // Use ALBUMS_LIMIT for artists as well
  500,
  'name'
);

export const SongPaginationSchema = z.object({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.SONGS_LIMIT),
  offset: OffsetSchema,
  sort: z.enum(['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating'])
    .optional()
    .default('title'),
  order: OrderSchema,
  starred: z.boolean().optional(),
});

export const GenrePaginationSchema = createPaginationSchema(
  DEFAULT_VALUES.ALBUMS_LIMIT, // Use ALBUMS_LIMIT for genres as well
  500,
  'name'
);

export const PlaylistTracksPaginationSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.PLAYLIST_TRACKS_LIMIT),
  offset: OffsetSchema,
  format: z.enum(['json', 'm3u']).optional().default('json'),
});

// User preferences pagination
export const StarredItemsPaginationSchema = z.object({
  type: z.enum(['songs', 'albums', 'artists']),
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.STARRED_ITEMS_LIMIT),
  offset: OffsetSchema,
});

export const TopRatedItemsPaginationSchema = z.object({
  type: z.enum(['songs', 'albums', 'artists']),
  minRating: z.number().min(1).max(5).optional().default(4),
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.TOP_RATED_LIMIT),
  offset: OffsetSchema,
});

// Listening history pagination
export const RecentlyPlayedPaginationSchema = z.object({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.RECENTLY_PLAYED_LIMIT),
  offset: OffsetSchema,
  timeRange: z.enum(['today', 'week', 'month', 'all']).optional().default('all'),
});

export const MostPlayedPaginationSchema = z.object({
  type: z.enum(['songs', 'albums', 'artists']).optional().default('songs'),
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.MOST_PLAYED_LIMIT),
  offset: OffsetSchema,
  minPlayCount: z.number().min(1).optional().default(1),
});

// Tag pagination
export const TagsPaginationSchema = z.object({
  limit: createLimitSchema(1, 500, DEFAULT_VALUES.TAGS_LIMIT),
  offset: OffsetSchema,
  sort: z.enum(['tagName', 'tagValue', 'albumCount', 'songCount']).optional().default('tagName'),
  order: OrderSchema,
  tagName: z.string().optional(),
});

// Search pagination (smaller limits for performance)
export const SearchPaginationSchema = z.object({
  artistCount: z.number().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
  albumCount: z.number().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
  songCount: z.number().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
});

export const SimpleSearchPaginationSchema = z.object({
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.SEARCH_LIMIT),
});