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

// An ID holding `?`, `&`, `..` or `/` would inject query params or path segments into a request URL.
// encodeURIComponent at the call sites is defense-in-depth on top of this regex.
export const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// abort stops an empty ID at its first issue, so it is not also reported as invalid characters.
export const IdStringSchema = z.string().min(1, { message: 'ID is required', abort: true }).regex(ID_PATTERN, 'ID contains invalid characters');

export const IdSchema = z.object({
  id: IdStringSchema,
});

// Generic over the literal field name so the key stays a precise `{ [field]: string }` shape, not an index
// signature. The cast restores the literal key that the `[fieldName]` computed-property syntax erases.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/explicit-module-boundary-types -- schema factory. Its return type is inferred by zod, and an explicit annotation would be unwieldy
export const createIdSchema = <F extends string>(resourceType: string, fieldName: F) =>
  z.object({
    [fieldName]: z.string()
      .min(1, { message: `${resourceType} ID is required`, abort: true })
      .regex(ID_PATTERN, `${resourceType} ID contains invalid characters`),
  } as { [K in F]: z.ZodString });

// LLMs mix singular and plural item types, so both are accepted.
// Each schema normalizes to the form its endpoints take.
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

// Navidrome drops a non-integer `_start` or `_end` and returns the whole unpaginated set, so limits must be integers.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type,@typescript-eslint/explicit-module-boundary-types -- schema factory. Its return type is inferred by zod, and an explicit annotation would be unwieldy
export const createLimitSchema = (min: number, max: number, defaultValue: number) =>
  z.number().int().min(min).max(max).optional().default(defaultValue);

// Offset schema for pagination (see createLimitSchema for why `.int()`)
export const OffsetSchema = z.number().int().min(0).optional().default(0);

export const OrderSchema = z.enum(['ASC', 'DESC']).optional().default('ASC');

export const OptionalBooleanSchema = z.boolean().optional();

// Compact output keeps large array responses under the tool-result token cap.
// True returns the full per-item metadata (path, genres, year, bitrate, rating).
export const VerboseSchema = z.boolean().optional().default(false);

export const SEARCH_QUERY_MAX_LENGTH = 500;

// Optional because the search tools double as filtered listing when no query is given.
const OptionalSearchQuerySchema = z.string()
  .max(SEARCH_QUERY_MAX_LENGTH, `Query must be ${SEARCH_QUERY_MAX_LENGTH} characters or fewer`)
  .optional()
  .default('');

export const EnhancedSearchSchema = z.object({
  query: OptionalSearchQuerySchema,

  // Text-based filters (resolved to IDs internally)
  genre: z.string().optional(),
  mediaType: z.string().optional(),
  country: z.string().optional(), 
  releaseType: z.string().optional(),
  recordLabel: z.string().optional(),
  mood: z.string().optional(),
  
  sort: z.enum([
    'name', 'title', 'artist', 'album', 'year', 'duration', 
    'playCount', 'rating', 'recently_added', 'starred_at', 'random'
  ]).optional().default('name'),
  order: OrderSchema,
  randomSeed: z.number().optional(),
  
  // Navidrome has no year ranges and /api/artist ignores year.
  // The refine reads the clock at validate time, not at module load.
  year: z.number().int().min(1900).refine(y => y <= new Date().getFullYear() + 1, {
    message: 'year must not be more than one year in the future',
  }).optional(),

  starred: OptionalBooleanSchema,
});

export const RatingSchema = z.number().int().min(0).max(5);

export const NonEmptyIdArraySchema = z.array(IdStringSchema).min(1, 'At least one item is required');

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
    'name', 'albumCount', 'songCount', 'playCount', 'rating'
  ]).optional().default('name'),
  verbose: VerboseSchema,
});

export const PlaylistIdSchema = createIdSchema('Playlist', 'playlistId');
export const RadioStationIdSchema = createIdSchema('Radio station', 'stationId');
export const StationUuidSchema = createIdSchema('Station', 'stationUuid');
export const SongIdSchema = createIdSchema('Song', 'songId');
export const ArtistIdSchema = createIdSchema('Artist', 'artistId');
export const AlbumIdSchema = createIdSchema('Album', 'albumId');