/**
 * Navidrome MCP Server - Listening History Tool Handlers
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
import { listRecentlyPlayed, listMostPlayed } from '../listening-history.js';

const tools: Tool[] = [
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
          description: 'Rolling window ending now. today: since local midnight on the server host. week: last 7 days. month: last 30 days, not the calendar month. all: no cutoff.',
          enum: ['today', 'week', 'month', 'all'],
          default: 'all',
        },
        verbose: {
          type: 'boolean',
          description: 'When false (default) each track carries only identity fields (plus playDate, the last play time) to save context. Set true for full per-track metadata (genres, year, rating, path, etc.).',
          default: false,
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
        verbose: {
          type: 'boolean',
          description: 'When false (default) each item carries only identity fields (plus playCount) to save context; set true for full per-item metadata (genres, year, rating, path, etc.).',
          default: false,
        },
      },
    },
  },
];

export function createListeningHistoryToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_recently_played':
          return await listRecentlyPlayed(client, args);
        case 'list_most_played':
          return await listMostPlayed(client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(`listening-history ${name}`));
      }
    },
  };
}
