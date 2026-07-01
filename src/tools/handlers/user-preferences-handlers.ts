/**
 * Navidrome MCP Server - User Preferences Tool Handlers
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
        itemId: {
          type: 'string',
          description: 'The ID of the item to star — a song, album, or artist ID matching the `type` field.',
        },
        type: {
          type: 'string',
          description: 'The type of item to star',
          enum: ['song', 'album', 'artist'],
        },
      },
      required: ['itemId', 'type'],
    },
  },
  {
    name: 'unstar_item',
    description: 'Unstar/unfavorite a song, album, or artist',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'The ID of the item to unstar — a song, album, or artist ID matching the `type` field.',
        },
        type: {
          type: 'string',
          description: 'The type of item to unstar',
          enum: ['song', 'album', 'artist'],
        },
      },
      required: ['itemId', 'type'],
    },
  },
  {
    name: 'set_rating',
    description: 'Set a rating (0-5 stars) for a song, album, or artist',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'The ID of the item to rate — a song, album, or artist ID matching the `type` field.',
        },
        type: {
          type: 'string',
          description: 'The type of item to rate',
          enum: ['song', 'album', 'artist'],
        },
        rating: {
          type: 'integer',
          description: 'Rating from 0-5 stars (0 removes rating)',
          minimum: 0,
          maximum: 5,
        },
      },
      required: ['itemId', 'type', 'rating'],
    },
  },
  {
    name: 'list_starred_items',
    description: "List starred/favorited songs, albums, or artists. If the goal is to PLAY the starred items (not just show them), use `play_songs_search`/`play_albums_search` with `{starred: true, ...}` instead — those tools search AND enqueue in one shot, avoiding a context-heavy round-trip of IDs through the LLM.",
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
        verbose: {
          type: 'boolean',
          description: 'When false (default) each item carries only identity fields (plus its starred state) to save context; set true for full per-item metadata (genres, year, rating, path, etc.).',
          default: false,
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
          type: 'integer',
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