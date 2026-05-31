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

// Navidrome IDs are UUID-shaped (alphanumeric, hyphen, underscore). Reject
// anything else outright at validation time, BEFORE the value reaches a URL
// builder — an ID containing `?`, `&`, `..`, or `/` would otherwise inject
// query params or path segments into the request. encodeURIComponent at the
// call sites is defense-in-depth on top of this regex.
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// Basic ID validation schema
export const IdSchema = z.object({
  id: z.string().min(1, 'ID is required').regex(ID_PATTERN, 'ID contains invalid characters'),
});

// Required ID with custom message
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/explicit-module-boundary-types -- schema factory; return type inferred by zod, explicit annotation would be unwieldy
export const createIdSchema = (resourceType: string) => z.object({
  id: z.string()
    .min(1, `${resourceType} ID is required`)
    .regex(ID_PATTERN, `${resourceType} ID contains invalid characters`),
});

// Search query schema
export const SearchQuerySchema = z.object({
  query: z.string().min(1, 'Search query is required'),
});

// Item type enums for user preferences. Both schemas accept BOTH the singular
// form ('song'/'album'/'artist') and the plural form ('songs'/'albums'/'artists')
// because LLM call-sites mix them up — `star_item` uses singular, `list_starred_items`
// uses plural, and that distinction is one of the most common LLM bugs in
// Subsonic-style APIs. The runtime transform normalizes to the form each
// downstream caller expects: ItemTypeSchema → singular (Subsonic /star, /unstar,
// /setRating use singular), ItemListTypeSchema → plural (we use plural to
// switch on the /song vs /album vs /artist endpoint).
const ITEM_TYPE_VARIANTS = ['song', 'album', 'artist', 'songs', 'albums', 'artists'] as const;

export const ItemTypeSchema = z.enum(ITEM_TYPE_VARIANTS).transform((v): 'song' | 'album' | 'artist' => {
  if (v === 'songs') return 'song';
  if (v === 'albums') return 'album';
  if (v === 'artists') return 'artist';
  return v;
});

export const ItemListTypeSchema = z.enum(ITEM_TYPE_VARIANTS).transform((v): 'songs' | 'albums' | 'artists' => {
  if (v === 'song') return 'songs';
  if (v === 'album') return 'albums';
  if (v === 'artist') return 'artists';
  return v;
});

// Common limit validation patterns. `.int()` is required: limit/offset feed
// `_start`/`_end` in the Navidrome REST URL, and a non-integer (e.g. `50.5`)
// is silently dropped by Navidrome — the param is ignored and the endpoint
// returns the ENTIRE unpaginated result set. Reject non-integers up front.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/explicit-module-boundary-types -- schema factory; return type inferred by zod, explicit annotation would be unwieldy
export const createLimitSchema = (min = 1, max = 500, defaultValue?: number) => {
  if (defaultValue !== undefined) {
    return z.number().int().min(min).max(max).optional().default(defaultValue);
  }
  return z.number().int().min(min).max(max);
};

// Offset schema for pagination (see createLimitSchema for why `.int()`)
export const OffsetSchema = z.number().int().min(0).optional().default(0);

// Order enum
export const OrderSchema = z.enum(['ASC', 'DESC']).optional().default('ASC');

// Common sort fields (can be extended per tool)
export const SortSchema = z.string().optional().default('name');

// Boolean flag schema
export const OptionalBooleanSchema = z.boolean().optional();
export const RequiredBooleanSchema = z.boolean();

// Enhanced search schema with filtering and sorting options
export const EnhancedSearchSchema = SearchQuerySchema.extend({
  // Text-based filters (resolved to IDs internally)
  genre: z.string().optional(),
  mediaType: z.string().optional(),
  country: z.string().optional(), 
  releaseType: z.string().optional(),
  recordLabel: z.string().optional(),
  mood: z.string().optional(),
  
  // Advanced sorting options
  sort: z.enum([
    'name', 'title', 'artist', 'album', 'year', 'duration', 
    'playCount', 'rating', 'recently_added', 'starred_at', 'random'
  ]).optional().default('name'),
  order: OrderSchema,
  randomSeed: z.number().optional(),
  
  // Single-year filter. Navidrome's REST API does NOT support year ranges —
  // /api/album?year=N matches albums whose [minYear, maxYear] contains N
  // (or whose maxYear == N when minYear is 0); /api/song?year=N matches the
  // exact `year` column. /api/artist has no year column at all and ignores
  // this param. The previous yearFrom/yearTo schema sent year_from/year_to
  // to Navidrome, which was silently ignored. Use refine so the upper bound
  // re-evaluates at validate time rather than once at module load.
  year: z.number().int().min(1900).refine(y => y <= new Date().getFullYear() + 1, {
    message: 'year must not be more than one year in the future',
  }).optional(),

  // Boolean filters
  starred: OptionalBooleanSchema,
});

// Rating validation
export const RatingSchema = z.number().int().min(0).max(5);

// Duration validation for timeouts
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/explicit-module-boundary-types -- schema factory; return type inferred by zod, explicit annotation would be unwieldy
export const createTimeoutSchema = (min: number, max: number, defaultValue: number) =>
  z.number().min(min).max(max).optional().default(defaultValue);

// URL validation
export const UrlSchema = z.string().url('URL must be a valid URL');

// String array schemas
export const StringArraySchema = z.array(z.string());
export const OptionalStringArraySchema = z.array(z.string()).optional();
export const NonEmptyStringArraySchema = z.array(z.string()).min(1, 'At least one item is required');

// Individual search tool schemas (query optional for listing functionality)
export const SearchSongsSchema = EnhancedSearchSchema.extend({
  query: z.string().max(500, 'Query must be 500 characters or fewer').optional().default(''), // Override required query to be optional
  limit: createLimitSchema(1, 500, 100), // Increased max limit for browsing
  offset: OffsetSchema, // Add offset support for pagination
  sort: z.enum([
    'title', 'artist', 'album', 'year', 'duration',
    'playCount', 'rating', 'recently_added', 'starred_at', 'random'
  ]).optional().default('title'),
});

export const SearchAlbumsSchema = EnhancedSearchSchema.extend({
  query: z.string().max(500, 'Query must be 500 characters or fewer').optional().default(''), // Override required query to be optional
  limit: createLimitSchema(1, 500, 100), // Increased max limit for browsing
  offset: OffsetSchema, // Add offset support for pagination
  sort: z.enum([
    'name', 'artist', 'year', 'songCount', 'duration',
    'playCount', 'rating', 'recently_added', 'starred_at', 'random'
  ]).optional().default('name'),
});

// Artists have no year column in Navidrome, so the EnhancedSearchSchema's
// `year` field is omitted here — accepting it would be a silent no-op
// (the filter chain wouldn't send it for /api/artist anyway, but stripping
// it at the schema layer keeps the type honest for any non-LLM caller).
export const SearchArtistsSchema = EnhancedSearchSchema.omit({ year: true }).extend({
  query: z.string().max(500, 'Query must be 500 characters or fewer').optional().default(''), // Override required query to be optional
  limit: createLimitSchema(1, 500, 100), // Increased max limit for browsing
  offset: OffsetSchema, // Add offset support for pagination
  sort: z.enum([
    'name', 'albumCount', 'songCount', 'playCount', 'rating', 'random'
  ]).optional().default('name'),
});

// Common validation schemas for different resource types
export const PlaylistIdSchema = createIdSchema('Playlist');
export const SongIdSchema = createIdSchema('Song');
export const ArtistIdSchema = createIdSchema('Artist');
export const AlbumIdSchema = createIdSchema('Album');
export const TagIdSchema = createIdSchema('Tag');