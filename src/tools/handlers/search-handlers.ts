import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';
import { DEFAULT_VALUES } from '../../constants/defaults.js';

// Import tool functions
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from '../search.js';

// Tool definitions for search category
const tools: Tool[] = [
  {
    name: 'search_all',
    description: 'Search across all content types (artists, albums, songs) with advanced filtering and sorting options. Leave query empty to list all results.',
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
          description: 'Filter by release country (e.g., "US", "UK", "Germany")',
        },
        releaseType: {
          type: 'string',
          description: 'Filter by release type (e.g., "Album", "EP", "Single")',
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
        // Year filtering
        yearFrom: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results from this year onwards',
        },
        yearTo: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results up to this year',
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
    description: 'Search for songs by title with advanced filtering and sorting options. Leave query empty to list all songs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for in song titles, artists, or albums',
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
          description: 'Filter by release country (e.g., "US", "UK", "Germany")',
        },
        releaseType: {
          type: 'string',
          description: 'Filter by release type (e.g., "Album", "EP", "Single")',
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
        // Year filtering
        yearFrom: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results from this year onwards',
        },
        yearTo: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results up to this year',
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
    description: 'Search for albums by name with advanced filtering and sorting options. Leave query empty to list all albums.',
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
          description: 'Filter by release country (e.g., "US", "UK", "Germany")',
        },
        releaseType: {
          type: 'string',
          description: 'Filter by release type (e.g., "Album", "EP", "Single")',
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
        // Year filtering
        yearFrom: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results from this year onwards',
        },
        yearTo: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results up to this year',
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
    description: 'Search for artists by name with advanced filtering and sorting options. Leave query empty to list all artists.',
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
          description: 'Filter by release country (e.g., "US", "UK", "Germany")',
        },
        releaseType: {
          type: 'string',
          description: 'Filter by release type (e.g., "Album", "EP", "Single")',
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
        // Year filtering
        yearFrom: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results from this year onwards',
        },
        yearTo: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results up to this year',
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
          throw new Error(`Unknown search tool: ${name}`);
      }
    }
  };
}