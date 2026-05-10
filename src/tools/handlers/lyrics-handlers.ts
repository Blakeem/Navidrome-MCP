/**
 * Navidrome MCP Server - Lyrics Tool Handlers
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
import { getLyrics } from '../lyrics.js';

// Tool definitions for lyrics category
const tools: Tool[] = [
  {
    name: 'get_lyrics',
    description: 'Get lyrics for a song (both synced and unsynced). Returns timed lyrics for karaoke-style display when available.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Song title',
        },
        artist: {
          type: 'string',
          description: 'Artist name',
        },
        album: {
          type: 'string',
          description: 'Album name (improves match accuracy)',
        },
        durationMs: {
          type: 'number',
          description: 'Song duration in milliseconds (improves match accuracy)',
          minimum: 0,
        },
        id: {
          type: 'string',
          description: 'LRCLIB record ID if known',
        },
      },
      required: ['title', 'artist'],
    },
  },
];

// Factory function for creating lyrics tool category with dependencies  
export function createLyricsToolCategory(_client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'get_lyrics':
          return await getLyrics(config, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}