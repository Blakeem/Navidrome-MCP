import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';

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
          throw new Error(`Unknown lyrics tool: ${name}`);
      }
    }
  };
}