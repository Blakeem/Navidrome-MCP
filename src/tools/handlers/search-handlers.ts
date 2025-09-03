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
    description: 'Search across all content types (artists, albums, songs) using a single query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for',
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
      },
      required: ['query'],
    },
  },
  {
    name: 'search_songs',
    description: 'Search for songs by title, artist, or album',
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
          maximum: 100,
          default: 100,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_albums',
    description: 'Search for albums by name or artist',
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
          maximum: 100,
          default: 100,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_artists',
    description: 'Search for artists by name',
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
          maximum: 100,
          default: 100,
        },
      },
      required: ['query'],
    },
  },
];

// Factory function for creating search tool category with dependencies  
export function createSearchToolCategory(_client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'search_all':
          return await searchAll(config, args);
        case 'search_songs':
          return await searchSongs(config, args);
        case 'search_albums':
          return await searchAlbums(config, args);
        case 'search_artists':
          return await searchArtists(config, args);
        default:
          throw new Error(`Unknown search tool: ${name}`);
      }
    }
  };
}