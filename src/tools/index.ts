/**
 * Navidrome MCP Server - Tool Registry
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

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { testConnection } from './test.js';
import { listSongs } from './library.js';

export function registerTools(server: Server, client: NavidromeClient): void {
  // Define available tools
  const tools: Tool[] = [
    {
      name: 'test_connection',
      description: 'Test the connection to the Navidrome server',
      inputSchema: {
        type: 'object',
        properties: {
          includeServerInfo: {
            type: 'boolean',
            description: 'Include detailed server information in the response',
            default: false,
          },
        },
      },
    },
    {
      name: 'list_songs',
      description: 'List songs from the Navidrome music library with filtering and pagination',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of songs to return (1-500)',
            minimum: 1,
            maximum: 500,
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Number of songs to skip for pagination',
            minimum: 0,
            default: 0,
          },
          sort: {
            type: 'string',
            description: 'Field to sort by',
            enum: ['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating'],
            default: 'title',
          },
          order: {
            type: 'string',
            description: 'Sort order',
            enum: ['ASC', 'DESC'],
            default: 'ASC',
          },
          starred: {
            type: 'boolean',
            description: 'Filter for starred songs only',
          },
        },
      },
    },
  ];

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Register call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'test_connection') {
      const result = await testConnection(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_songs') {
      const result = await listSongs(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });
}
