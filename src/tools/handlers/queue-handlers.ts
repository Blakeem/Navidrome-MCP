import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';

// Import tool functions
import {
  getQueue,
  setQueue,
  clearQueue,
} from '../queue-management.js';
import {
  listRecentlyPlayed,
  listMostPlayed,
} from '../listening-history.js';

// Tool definitions for queue management and listening history categories
const tools: Tool[] = [
  {
    name: 'get_queue',
    description: 'Get the current playback queue',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_queue',
    description: 'Set the playback queue with specified songs',
    inputSchema: {
      type: 'object',
      properties: {
        songIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of song IDs to add to queue',
        },
        current: {
          type: 'number',
          description: 'Index of current track (0-based)',
          minimum: 0,
          default: 0,
        },
        position: {
          type: 'number',
          description: 'Playback position in seconds',
          minimum: 0,
          default: 0,
        },
      },
      required: ['songIds'],
    },
  },
  {
    name: 'clear_queue',
    description: 'Clear the playback queue',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_recently_played',
    description: 'List recently played tracks with time filtering',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tracks to return (1-500)',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of tracks to skip for pagination',
          minimum: 0,
          default: 0,
        },
        timeRange: {
          type: 'string',
          description: 'Time range for recently played tracks',
          enum: ['today', 'week', 'month', 'all'],
          default: 'all',
        },
      },
    },
  },
  {
    name: 'list_most_played',
    description: 'List most played songs, albums, or artists',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of items to list',
          enum: ['songs', 'albums', 'artists'],
          default: 'songs',
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
        minPlayCount: {
          type: 'number',
          description: 'Minimum play count to include',
          minimum: 1,
          default: 1,
        },
      },
    },
  },
];

// Factory function for creating queue tool category with dependencies  
export function createQueueToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'get_queue':
          return await getQueue(client, args);
        case 'set_queue':
          return await setQueue(client, args);
        case 'clear_queue':
          return await clearQueue(client, args);
        case 'list_recently_played':
          return await listRecentlyPlayed(client, args);
        case 'list_most_played':
          return await listMostPlayed(client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(`queue ${name}`));
      }
    }
  };
}