/**
 * Navidrome MCP Server - Validation Schema Definitions
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
import {
  EnhancedSearchSchema,
  ItemTypeSchema,
  RatingSchema,
  UrlSchema,
  StringArraySchema,
  OptionalStringArraySchema,
  NonEmptyStringArraySchema,
  OptionalBooleanSchema,
  createLimitSchema,
  createTimeoutSchema,
} from './common.js';

// User preferences validation
export const StarItemSchema = z.object({
  id: z.string().min(1),
  type: ItemTypeSchema,
});

export const SetRatingSchema = z.object({
  id: z.string().min(1),
  type: ItemTypeSchema,
  rating: RatingSchema,
});

// Playlist management validation
export const CreatePlaylistSchema = z.object({
  name: z.string().min(1, 'Playlist name is required'),
  comment: z.string().optional(),
  public: OptionalBooleanSchema.default(false),
});

export const UpdatePlaylistSchema = z.object({
  id: z.string().min(1, 'Playlist ID is required'),
  name: z.string().min(1).optional(),
  comment: z.string().optional(),
  public: OptionalBooleanSchema,
});

export const AddTracksToPlaylistSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  ids: OptionalStringArraySchema,
  albumIds: OptionalStringArraySchema,
  artistIds: OptionalStringArraySchema,
  discs: z.array(z.object({
    albumId: z.string(),
    discNumber: z.number(),
  })).optional(),
});

export const RemoveTracksFromPlaylistSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  trackIds: NonEmptyStringArraySchema,
});

export const ReorderPlaylistTrackSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  trackId: z.string().min(1, 'Track ID is required'),
  insert_before: z.number().min(0, 'Insert position must be non-negative'),
});

// Queue management validation
export const SetQueueSchema = z.object({
  songIds: StringArraySchema,
  current: z.number().min(0).optional().default(0),
  position: z.number().min(0).optional().default(0),
});

// Search validation schemas - import enhanced schemas from common.js
export const SearchAllSchema = EnhancedSearchSchema.extend({
  artistCount: z.number().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
  albumCount: z.number().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
  songCount: z.number().min(0).max(100).optional().default(DEFAULT_VALUES.SEARCH_ALL_LIMIT),
});

// These are now imported from common.js to avoid duplication
// export const SearchSongsSchema - defined in common.js
// export const SearchAlbumsSchema - defined in common.js  
// export const SearchArtistsSchema - defined in common.js

// Tag validation schemas
export const SearchByTagsSchema = z.object({
  tagName: z.string().min(1),
  tagValue: z.string().optional(),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.TAG_SEARCH_LIMIT),
});

export const TagDistributionSchema = z.object({
  tagNames: z.array(z.string()).optional(),
  limit: createLimitSchema(1, 50, DEFAULT_VALUES.TAG_DISTRIBUTION_LIMIT),
  distributionLimit: createLimitSchema(1, 100, DEFAULT_VALUES.TAG_DISTRIBUTION_VALUES_LIMIT),
});

export const UniqueTagsSchema = z.object({
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.UNIQUE_TAGS_LIMIT),
  minUsage: z.number().min(1).optional().default(1),
});

// Radio validation schemas
export const ValidateRadioStreamSchema = z.object({
  url: UrlSchema,
  timeout: createTimeoutSchema(1000, 30000, 8000),
  followRedirects: OptionalBooleanSchema.default(true),
});

// Last.fm validation schemas
export const SimilarArtistsSchema = z.object({
  artist: z.string(),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.SIMILAR_ARTISTS_LIMIT),
});

export const SimilarTracksSchema = z.object({
  artist: z.string(),
  track: z.string(),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.SIMILAR_TRACKS_LIMIT),
});

export const ArtistInfoSchema = z.object({
  artist: z.string(),
  lang: z.string().optional().default('en'),
});

export const TopTracksByArtistSchema = z.object({
  artist: z.string(),
  limit: createLimitSchema(1, 50, DEFAULT_VALUES.TOP_TRACKS_BY_ARTIST_LIMIT),
});

export const TrendingMusicSchema = z.object({
  type: z.enum(['artists', 'tracks', 'tags']),
  limit: createLimitSchema(1, 100, DEFAULT_VALUES.TRENDING_MUSIC_LIMIT),
  page: z.number().min(1).optional().default(1),
});

// Lyrics validation schema
export const GetLyricsSchema = z.object({
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  durationMs: z.number().min(0).optional(),
  id: z.string().optional(),
});

// Test connection schema
export const TestConnectionSchema = z.object({
  includeServerInfo: OptionalBooleanSchema.default(false),
});

// Song playlists schema
export const GetSongPlaylistsSchema = z.object({
  songId: z.string().min(1, 'Song ID is required'),
});