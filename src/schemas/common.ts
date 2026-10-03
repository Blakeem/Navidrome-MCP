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
// builder. An ID containing `?`, `&`, `..`, or `/` would otherwise inject
// query params or path segments into the request. encodeURIComponent at the
// call sites is defense-in-depth on top of this regex.
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// Basic ID validation schema
export const IdSchema = z.object({
  id: z.string().min(1, 'ID is required').regex(ID_PATTERN, 'ID contains invalid characters'),
});

// Required ID with custom message. Generic over the literal field name so the
// computed key stays a precise `{ [field]: string }` shape rather than widening
// to an index signature (which would trip noPropertyAccessFromIndexSignature /
// noUncheckedIndexedAccess at every call site). The cast restores the literal
// key that the `[fieldName]` computed-property syntax erases.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/explicit-module-boundary-types -- schema factory; return type inferred by zod, explicit annotation would be unwieldy
export const createIdSchema = <F extends string = 'id'>(resourceType: string, fieldName: F = 'id' as F) =>
  z.object({
    [fieldName]: z.string()
      .min(1, `${resourceType} ID is required`)
      .regex(ID_PATTERN, `${resourceType} ID contains invalid characters`),
  } as { [K in F]: z.ZodString });

// Item type enums for user preferences. Both schemas accept BOTH the singular
// form ('song'/'album'/'artist') and the plural form ('songs'/'albums'/'artists')
// because LLM call-sites mix them up. `star_item` uses singular, `list_starred_items`
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
// is silently dropped by Navidrome. The param is ignored and the endpoint
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

// Boolean flag schema
export const OptionalBooleanSchema = z.boolean().optional();

// Verbosity flag for list/search tools. Default false = compact: tools return
// only identity fields per item (ids, title/name, artist, album, duration) to
// keep large array responses under the tool-result token cap. Set true to get
// the full per-item metadata (path, genres, year, bitrate, rating, etc.).
export const VerboseSchema = z.boolean().optional().default(false);

export const SEARCH_QUERY_MAX_LENGTH = 500;

// Optional because the search tools double as filtered listing when no query is given.
const OptionalSearchQuerySchema = z.string()
  .max(SEARCH_QUERY_MAX_LENGTH, `Query must be ${SEARCH_QUERY_MAX_LENGTH} characters or fewer`)
  .optional()
  .default('');

// Enhanced search schema with filtering and sorting options
export const EnhancedSearchSchema = z.object({
  query: OptionalSearchQuerySchema,

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
  
  // Single-year filter. Navidrome's REST API does NOT support year ranges.
  // /api/album?year=N matches albums whose [minYear, maxYear] contains N
  // (or whose maxYear == N when minYear is 0); /api/song?year=N matches the
  // exact `year` column. /api/artist has no year column at all and ignores
  // this param. Use refine so the upper bound re-evaluates at validate time
  // rather than once at module load.
  year: z.number().int().min(1900).refine(y => y <= new Date().getFullYear() + 1, {
    message: 'year must not be more than one year in the future',
  }).optional(),

  // Boolean filters
  starred: OptionalBooleanSchema,
});

// Rating validation
export const RatingSchema = z.number().int().min(0).max(5);

// String array schemas
export const StringArraySchema = z.array(z.string());
export const NonEmptyIdArraySchema = z
  .array(z.string().min(1, 'ID is required').regex(ID_PATTERN, 'ID contains invalid characters'))
  .min(1, 'At least one item is required');

// Individual search tool schemas (query optional for listing functionality)
export const SearchSongsSchema = EnhancedSearchSchema.extend({
  limit: createLimitSchema(1, 500, 100),
  offset: OffsetSchema,
  sort: z.enum([
    'title', 'artist', 'album', 'year', 'duration',
    'playCount', 'rating', 'recently_added', 'starred_at', 'random'
  ]).optional().default('title'),
  verbose: VerboseSchema,
});

export const SearchAlbumsSchema = EnhancedSearchSchema.extend({
  limit: createLimitSchema(1, 500, 100),
  offset: OffsetSchema,
  sort: z.enum([
    'name', 'artist', 'year', 'songCount', 'duration',
    'playCount', 'rating', 'recently_added', 'starred_at', 'random'
  ]).optional().default('name'),
  verbose: VerboseSchema,
});

// /api/artist ignores tag and year filters, so a set value fails here instead of returning unfiltered artists.
const ArtistUnsupportedFilterSchema = z.undefined(
  'search_artists does not filter by tag or year. Use search_albums or search_songs for tag-filtered lookups, and list_tag_values for the tag values.',
);

export const SearchArtistsSchema = EnhancedSearchSchema.extend({
  genre: ArtistUnsupportedFilterSchema,
  mediaType: ArtistUnsupportedFilterSchema,
  country: ArtistUnsupportedFilterSchema,
  releaseType: ArtistUnsupportedFilterSchema,
  recordLabel: ArtistUnsupportedFilterSchema,
  mood: ArtistUnsupportedFilterSchema,
  year: ArtistUnsupportedFilterSchema,
  limit: createLimitSchema(1, 500, 100),
  offset: OffsetSchema,
  sort: z.enum([
    'name', 'albumCount', 'songCount', 'playCount', 'rating', 'random'
  ]).optional().default('name'),
  verbose: VerboseSchema,
});

// Common validation schemas for different resource types
export const PlaylistIdSchema = createIdSchema('Playlist', 'playlistId');
export const RadioStationIdSchema = createIdSchema('Radio station', 'stationId');
export const StationUuidSchema = createIdSchema('Station', 'stationUuid');
export const SongIdSchema = createIdSchema('Song', 'songId');
export const ArtistIdSchema = createIdSchema('Artist', 'artistId');
export const AlbumIdSchema = createIdSchema('Album', 'albumId');