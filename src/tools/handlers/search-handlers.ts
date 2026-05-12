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
import { ErrorFormatter } from '../../utils/error-formatter.js';

// Import tool functions
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from '../search/index.js';

// Tool definitions for search category
const tools: Tool[] = [
  {
    name: 'search_all',
    description: 'Search across all content types (artists, albums, songs) with advanced filtering and sorting options. Leave query empty to list all results.\n\nNote: `totalArtists`, `totalAlbums`, and `totalSongs` in the response are *match counts* for the current query and filters (how many items in the library would match if you paginated through all of them) — NOT total library size. To see library totals, use get_user_details.\n\nTIP: Use \'get_filter_options\' to discover available values for genre, mediaType, country, releaseType, recordLabel, and mood filters in your library',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for in titles, names, and artists',
        },
        artistCount: {
          type: 'number',
          description: 'Maximum number of artists to return',
          minimum: 0,
          maximum: 100,
          default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
        },
        albumCount: {
          type: 'number',
          description: 'Maximum number of albums to return',
          minimum: 0,
          maximum: 100,
          default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
        },
        songCount: {
          type: 'number',
          description: 'Maximum number of songs to return',
          minimum: 0,
          maximum: 100,
          default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip per type for pagination. The same offset is applied to all three sub-fetches (songs/albums/artists), so a single value pages forward across all types together. For deep single-type pagination, use search_songs/search_albums/search_artists.',
          minimum: 0,
          default: 0,
        },
        // Text-based filters - resolved to IDs internally
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
        // Advanced sorting options
        sort: {
          type: 'string',
          enum: ['name', 'title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
          description: 'Sort field for results',
          default: 'name',
        },
        order: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          description: 'Sort order',
          default: 'ASC',
        },
        randomSeed: {
          type: 'number',
          description: 'Seed for consistent random ordering (use with sort=random)',
        },
        // Single-year filter. Navidrome's REST API has no range filter — for
        // multi-year queries, call the tool once per year and merge client-side.
        year: {
          type: 'number',
          minimum: 1900,
          description: 'Filter to a single year. For albums, matches anything whose [minYear, maxYear] contains this year. For songs, matches the exact year. (No effect on artists — Navidrome does not store year on artists.)',
        },
        // Boolean filters
        starred: {
          type: 'boolean',
          description: 'Filter for starred/favorited items only',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_songs',
    description: 'Search for songs by title with advanced filtering and sorting options. Leave query empty to list all songs.\n\nNote: the query runs Navidrome\'s full-text match on the song row — it matches title, artist, album AND credited participant names (composer, producer, etc.). Searching "love" can return a song whose composer is named "Rich Love" even if "love" is not in the title.\n\nTIP: Use \'get_filter_options\' to discover available values for genre, mediaType, country, releaseType, recordLabel, and mood filters in your library',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for in song titles, artists, albums, or credited participants (composer, producer, etc.). Navidrome runs a full-text match, so a query like "love" can also match songs by a composer named "Rich Love".',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of songs to return',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of songs to skip for pagination',
          minimum: 0,
          default: 0,
        },
        // Enhanced filtering options
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
        // Advanced sorting options
        sort: {
          type: 'string',
          enum: ['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
          description: 'Sort field for results',
          default: 'title',
        },
        order: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          description: 'Sort order',
          default: 'ASC',
        },
        randomSeed: {
          type: 'number',
          description: 'Seed for consistent random ordering (use with sort=random)',
        },
        // Single-year filter. Navidrome's REST API has no range filter — for
        // multi-year queries, call the tool once per year and merge client-side.
        year: {
          type: 'number',
          minimum: 1900,
          description: 'Filter to a single year. For albums, matches anything whose [minYear, maxYear] contains this year. For songs, matches the exact year. (No effect on artists — Navidrome does not store year on artists.)',
        },
        // Boolean filters
        starred: {
          type: 'boolean',
          description: 'Filter for starred/favorited items only',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_albums',
    description: 'Search for albums by name with advanced filtering and sorting options. Leave query empty to list all albums.\n\nTIP: Use \'get_filter_options\' to discover available values for genre, mediaType, country, releaseType, recordLabel, and mood filters in your library',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for in album names or artists',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of albums to return',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of albums to skip for pagination',
          minimum: 0,
          default: 0,
        },
        // Enhanced filtering options
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
        // Advanced sorting options
        sort: {
          type: 'string',
          enum: ['name', 'artist', 'year', 'songCount', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
          description: 'Sort field for results',
          default: 'name',
        },
        order: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          description: 'Sort order',
          default: 'ASC',
        },
        randomSeed: {
          type: 'number',
          description: 'Seed for consistent random ordering (use with sort=random)',
        },
        // Single-year filter. Navidrome's REST API has no range filter — for
        // multi-year queries, call the tool once per year and merge client-side.
        year: {
          type: 'number',
          minimum: 1900,
          description: 'Filter to a single year. For albums, matches anything whose [minYear, maxYear] contains this year. For songs, matches the exact year. (No effect on artists — Navidrome does not store year on artists.)',
        },
        // Boolean filters
        starred: {
          type: 'boolean',
          description: 'Filter for starred/favorited items only',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_artists',
    description: 'Search for artists by name with advanced filtering and sorting options. Leave query empty to list all artists.\n\nTIP: Use \'get_filter_options\' to discover available values for genre, mediaType, country, releaseType, recordLabel, and mood filters in your library',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for in artist names',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of artists to return',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of artists to skip for pagination',
          minimum: 0,
          default: 0,
        },
        // Enhanced filtering options
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
        // Advanced sorting options
        sort: {
          type: 'string',
          enum: ['name', 'albumCount', 'songCount', 'playCount', 'rating', 'random'],
          description: 'Sort field for results',
          default: 'name',
        },
        order: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          description: 'Sort order',
          default: 'ASC',
        },
        randomSeed: {
          type: 'number',
          description: 'Seed for consistent random ordering (use with sort=random)',
        },
        // No `year` field on search_artists — Navidrome stores no year column
        // on artists, so the filter would be silently ignored.
        // Boolean filters
        starred: {
          type: 'boolean',
          description: 'Filter for starred/favorited items only',
        },
      },
      required: [],
    },
  },
];

// Factory function for creating search tool category with dependencies
export function createSearchToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'search_all':
          return await searchAll(client, config, args);
        case 'search_songs':
          return await searchSongs(client, config, args);
        case 'search_albums':
          return await searchAlbums(client, config, args);
        case 'search_artists':
          return await searchArtists(client, config, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}