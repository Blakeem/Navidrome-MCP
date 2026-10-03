/**
 * Navidrome MCP Server - Queue Tool Handlers
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
  getSavedQueue,
  saveQueue,
  clearSavedQueue,
} from '../queue-management.js';

// Tool definitions for the saved-queue category
const tools: Tool[] = [
  {
    name: 'get_saved_queue',
    description: 'Read the saved playback queue stored on the Navidrome server. This is the queue shown in the web interface and synced across Navidrome clients — it is not live playback state and reading it does not affect any audio.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'save_queue',
    description: 'Save a playback queue to the Navidrome server so it appears in the web interface and syncs to other Navidrome clients. Does not start playback.',
    inputSchema: {
      type: 'object',
      properties: {
        songIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of song IDs to save into the queue',
        },
        current: {
          type: 'number',
          description: 'Index of current track (0-based)',
          minimum: 0,
          default: 0,
        },
        position: {
          type: 'number',
          description: 'Playback position in milliseconds within the current track',
          minimum: 0,
          default: 0,
        },
      },
      required: ['songIds'],
    },
  },
  {
    name: 'clear_saved_queue',
    description: 'Clear the saved playback queue stored on the Navidrome server (the queue shown in the web interface). Does not affect live playback.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Factory function for creating queue tool category with dependencies  
export function createQueueToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'get_saved_queue':
          return await getSavedQueue(client, args);
        case 'save_queue':
          return await saveQueue(client, args);
        case 'clear_saved_queue':
          return await clearSavedQueue(client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(`queue ${name}`));
      }
    }
  };
}