import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';

// Import tool functions
import {
  starItem,
  unstarItem,
  setRating,
  listStarredItems,
  listTopRated,
} from '../user-preferences.js';

// Tool definitions for user preferences category
const tools: Tool[] = [
  {
    name: 'star_item',
    description: 'Star/favorite a song, album, or artist',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the item to star',
        },
        type: {
          type: 'string',
          description: 'The type of item to star',
          enum: ['song', 'album', 'artist'],
        },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'unstar_item',
    description: 'Unstar/unfavorite a song, album, or artist',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the item to unstar',
        },
        type: {
          type: 'string',
          description: 'The type of item to unstar',
          enum: ['song', 'album', 'artist'],
        },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'set_rating',
    description: 'Set a rating (0-5 stars) for a song, album, or artist',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the item to rate',
        },
        type: {
          type: 'string',
          description: 'The type of item to rate',
          enum: ['song', 'album', 'artist'],
        },
        rating: {
          type: 'number',
          description: 'Rating from 0-5 stars (0 removes rating)',
          minimum: 0,
          maximum: 5,
        },
      },
      required: ['id', 'type', 'rating'],
    },
  },
  {
    name: 'list_starred_items',
    description: 'List starred/favorited songs, albums, or artists',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of starred items to list',
          enum: ['songs', 'albums', 'artists'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (1-500)',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip for pagination',
          minimum: 0,
          default: 0,
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'list_top_rated',
    description: 'List top-rated songs, albums, or artists',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of items to list',
          enum: ['songs', 'albums', 'artists'],
        },
        minRating: {
          type: 'number',
          description: 'Minimum rating to include (1-5)',
          minimum: 1,
          maximum: 5,
          default: 4,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of items to return (1-500)',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of items to skip for pagination',
          minimum: 0,
          default: 0,
        },
      },
      required: ['type'],
    },
  },
];

// Factory function for creating user preferences tool category with dependencies  
export function createUserPreferencesToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'star_item':
          return await starItem(client, config, args);
        case 'unstar_item':
          return await unstarItem(client, config, args);
        case 'set_rating':
          return await setRating(client, config, args);
        case 'list_starred_items':
          return await listStarredItems(client, args);
        case 'list_top_rated':
          return await listTopRated(client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(`user preference ${name}`));
      }
    }
  };
}