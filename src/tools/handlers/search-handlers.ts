/**
 * Navidrome MCP Server - Search Tool Handlers
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

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';
import { DEFAULT_VALUES } from '../../constants/defaults.js';
import { SEARCH_QUERY_MAX_LENGTH } from '../../schemas/index.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from '../search/index.js';

const FILTER_OPTIONS_TIP = 'TIP: Use \'get_filter_options\' to discover available values for genre, mediaType, country, releaseType, recordLabel, and mood filters in your library';

const TAG_FILTER_PROPERTIES = {
  genre: {
    type: 'string',
    description: 'Filter by music genre (e.g., "Rock", "Jazz", "Classical")',
  },
  mediaType: {
    type: 'string',
    description: 'Filter by media type (e.g., "CD", "Vinyl", "Digital")',
  },
  country: {
    type: 'string',
    description: 'Filter by release country as an ISO 3166-1 alpha-2 code (e.g., "US", "GB", "DE", "JP"). Use get_filter_options(filterType="countries") to see codes available in your library.',
  },
  releaseType: {
    type: 'string',
    description: 'Filter by release type (lowercase, MusicBrainz convention: "album", "ep", "single", "compilation", "live", "soundtrack", "demo", "remix", etc.). Use get_filter_options(filterType="releaseTypes") to see values available in your library.',
  },
  recordLabel: {
    type: 'string',
    description: 'Filter by record label (e.g., "Columbia Records", "Sony Music")',
  },
  mood: {
    type: 'string',
    description: 'Filter by musical mood (e.g., "Energetic", "Melancholy", "Upbeat")',
  },
} as const;

const ORDER_PROPERTY = {
  type: 'string',
  enum: ['ASC', 'DESC'],
  description: 'Sort order',
  default: 'ASC',
} as const;

const RANDOM_SEED_PROPERTY = {
  type: 'number',
  description: 'Seed for consistent random ordering (use with sort=random)',
} as const;

const STARRED_PROPERTY = {
  type: 'boolean',
  description: 'true returns only starred items. false returns only unstarred items. Omit for no starred filter.',
} as const;

// The year filters take a single year. Navidrome has no year-range filter, so a multi-year query takes one call per year.
const YEAR_MINIMUM = 1900;
// Computed once at load, so across New Year the published maximum can lag the Zod refine by a day. Zod stays authoritative.
const MAX_YEAR = new Date().getFullYear() + 1;

export const SONG_FILTER_PROPERTIES = {
  query: {
    type: 'string',
    maxLength: SEARCH_QUERY_MAX_LENGTH,
    description: 'Search terms to look for in song titles, artists, albums, or credited participants (composer, producer, etc.). Navidrome runs a full-text match, so a query like "love" can also match songs by a composer named "Rich Love".',
  },
  limit: {
    type: 'integer',
    description: 'Maximum number of songs to return',
    minimum: 1,
    maximum: 500,
    default: 100,
  },
  offset: {
    type: 'integer',
    description: 'Number of songs to skip for pagination',
    minimum: 0,
    default: 0,
  },
  ...TAG_FILTER_PROPERTIES,
  sort: {
    type: 'string',
    enum: ['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
    description: 'Sort field for results',
    default: 'title',
  },
  order: ORDER_PROPERTY,
  randomSeed: RANDOM_SEED_PROPERTY,
  year: {
    type: 'integer',
    minimum: YEAR_MINIMUM,
    maximum: MAX_YEAR,
    description: 'Filter to songs from this exact year.',
  },
  starred: STARRED_PROPERTY,
} as const;

export const ALBUM_FILTER_PROPERTIES = {
  query: {
    type: 'string',
    maxLength: SEARCH_QUERY_MAX_LENGTH,
    description: 'Search terms to look for in album names or artists',
  },
  limit: {
    type: 'integer',
    description: 'Maximum number of albums to return',
    minimum: 1,
    maximum: 500,
    default: 100,
  },
  offset: {
    type: 'integer',
    description: 'Number of albums to skip for pagination',
    minimum: 0,
    default: 0,
  },
  ...TAG_FILTER_PROPERTIES,
  sort: {
    type: 'string',
    enum: ['name', 'artist', 'year', 'songCount', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
    description: 'Sort field for results',
    default: 'name',
  },
  order: ORDER_PROPERTY,
  randomSeed: RANDOM_SEED_PROPERTY,
  year: {
    type: 'integer',
    minimum: YEAR_MINIMUM,
    maximum: MAX_YEAR,
    description: 'Filter to albums whose release years [minYear, maxYear] contain this year.',
  },
  starred: STARRED_PROPERTY,
} as const;

const tools: Tool[] = [
  {
    name: 'search_all',
    description: `Search across all content types (artists, albums, songs) with advanced filtering and sorting options. Leave query empty to list all results.\n\nNote: \`totalArtists\`, \`totalAlbums\`, and \`totalSongs\` in the response are *match counts* for the current query and filters (how many items in the library would match if you paginated through all of them), not total library size. To see library totals, use get_user_details. A slice that is not fetched carries no total.\n\nArtists are omitted when a tag or year filter is set. search_artists finds artists by name.\n\n${FILTER_OPTIONS_TIP}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          maxLength: SEARCH_QUERY_MAX_LENGTH,
          description: 'Search terms to look for in titles, names, and artists',
        },
        artistCount: {
          type: 'integer',
          description: 'Maximum number of artists to return',
          minimum: 0,
          maximum: 100,
          default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
        },
        albumCount: {
          type: 'integer',
          description: 'Maximum number of albums to return',
          minimum: 0,
          maximum: 100,
          default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
        },
        songCount: {
          type: 'integer',
          description: 'Maximum number of songs to return',
          minimum: 0,
          maximum: 100,
          default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
        },
        offset: {
          type: 'integer',
          description: 'Number of items to skip per type for pagination. The same offset is applied to all three sub-fetches (songs/albums/artists), so a single value pages forward across all types together. For deep single-type pagination, use search_songs/search_albums/search_artists.',
          minimum: 0,
          default: 0,
        },
        ...TAG_FILTER_PROPERTIES,
        sort: {
          type: 'string',
          enum: ['name', 'title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
          description: 'Sort field for results. For the artist slice, year, duration, artist, album, recently_added and random fall back to name.',
          default: 'name',
        },
        order: ORDER_PROPERTY,
        randomSeed: RANDOM_SEED_PROPERTY,
        year: {
          type: 'integer',
          minimum: YEAR_MINIMUM,
          maximum: MAX_YEAR,
          description: 'Filter to a single year. Songs match the exact year. Albums match when [minYear, maxYear] contains this year. Artists have no year, so a year filter omits the artist slice.',
        },
        starred: STARRED_PROPERTY,
        verbose: {
          type: 'boolean',
          description: 'When false (default) songs carry id, title, artist, artistId, album, albumId, durationFormatted and a lyrics flag when the file has lyrics, albums carry id, name, artist, artistId, songCount and durationFormatted, and artists carry id, name, albumCount and songCount. Set true for full per-item metadata such as genres, year, rating and starred.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'search_songs',
    description: `Search for songs by title with advanced filtering and sorting options. Leave query empty to list all songs.\n\nNote: the query runs Navidrome's full-text match on the song row. It matches title, artist, album AND credited participant names (composer, producer, etc.). Searching "love" can return a song whose composer is named "Rich Love" even if "love" is not in the title.\n\n${FILTER_OPTIONS_TIP}`,
    inputSchema: {
      type: 'object',
      properties: {
        ...SONG_FILTER_PROPERTIES,
        verbose: {
          type: 'boolean',
          description: 'When false (default) each song carries only id, title, artist, artistId, album, albumId, durationFormatted and a lyrics flag when the file has lyrics. Set true to add addedDate, genre, genres, duration, year, path, trackNumber, playCount, rating, starred, starredAt, playDate, albumArtist and albumArtistId.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'search_albums',
    description: `Search for albums by name with advanced filtering and sorting options. Leave query empty to list all albums.\n\n${FILTER_OPTIONS_TIP}`,
    inputSchema: {
      type: 'object',
      properties: {
        ...ALBUM_FILTER_PROPERTIES,
        verbose: {
          type: 'boolean',
          description: 'When false (default) each album carries only id, name, artist, artistId, songCount and durationFormatted. Set true to add albumArtist, albumArtistId, releaseYear, genre, genres, compilation, playCount, rating, starred and starredAt.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'search_artists',
    description: 'Search for artists by name with sorting options and a starred filter. Leave query empty to list all artists.\n\nsearch_artists has no genre or other tag filters. For tag-filtered lookups use search_albums or search_songs. list_tag_values lists the tag values they filter by.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          maxLength: SEARCH_QUERY_MAX_LENGTH,
          description: 'Search terms to look for in artist names',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of artists to return',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'integer',
          description: 'Number of artists to skip for pagination',
          minimum: 0,
          default: 0,
        },
        sort: {
          type: 'string',
          enum: ['name', 'albumCount', 'songCount', 'playCount', 'rating'],
          description: 'Sort field for results',
          default: 'name',
        },
        order: ORDER_PROPERTY,
        // /api/artist ignores tag and year filters, so search_artists offers neither.
        starred: STARRED_PROPERTY,
        verbose: {
          type: 'boolean',
          description: 'When false (default) each artist carries only id, name, albumCount and songCount. Set true to add playCount, genres, biography, rating, starred and starredAt.',
          default: false,
        },
      },
      required: [],
    },
  },
];

export function createSearchToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'search_all':
          return await searchAll(client, args);
        case 'search_songs':
          return await searchSongs(client, args);
        case 'search_albums':
          return await searchAlbums(client, args);
        case 'search_artists':
          return await searchArtists(client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}
