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

import { getLyricsByIdentity, LRCLIB_CONFIG_KEYS, searchLyricsCandidates } from '../lyrics.js';

function buildGetLyricsTool(hasLrclib: boolean): Tool {
  const properties: Record<string, unknown> = {
    songId: {
      type: 'string',
      description: hasLrclib
        ? "Navidrome song ID. Returns timed lyrics from the audio file, then timed lyrics from LRCLIB found with that song's metadata, then plain lyrics from the file, then plain lyrics from LRCLIB. Required unless lrclibId is given."
        : 'Navidrome song ID. Reads the lyrics stored in the audio file.',
    },
  };

  if (hasLrclib) {
    properties['lrclibId'] = {
      type: 'string',
      description: 'LRCLIB record ID, as returned by search_lyrics. Fetches that record directly. Required unless songId is given.',
    };
  }

  return {
    name: 'get_lyrics',
    description: hasLrclib
      ? 'Get the lyrics of ONE song, identified by a Navidrome song ID or by an LRCLIB record ID. The result carries timed lines (synced) when the source has them and plain text (unsynced) otherwise. To look lyrics up from a title and an artist name, call search_lyrics first.'
      : 'Get the lyrics of ONE song from its own audio file, identified by a Navidrome song ID. The result carries timed lines (synced) when the file has them and plain text (unsynced) otherwise.',
    inputSchema: {
      type: 'object',
      properties,
      required: hasLrclib ? [] : ['songId'],
    },
  };
}

function buildSearchLyricsTool(): Tool {
  return {
    name: 'search_lyrics',
    description: 'Search LRCLIB for the lyrics of a track by title and artist. Returns candidate records, each with an lrclibId to pass to get_lyrics. Also returns the matching library song and the kind of lyrics its file carries.',
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
          description: 'Album name (improves match ranking)',
        },
        durationMs: {
          type: 'number',
          description: 'Song duration in milliseconds (improves match ranking)',
          minimum: 0,
        },
      },
      required: ['title', 'artist'],
    },
  };
}

export const LRCLIB_TOOL_NAMES = [buildSearchLyricsTool().name];

export function createLyricsToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  const hasLrclib = config.features.lyrics;
  // Without LRCLIB the category still serves the lyrics stored in the audio
  // files, so only the LRCLIB-backed search drops out.
  const tools: Tool[] = hasLrclib
    ? [buildGetLyricsTool(true), buildSearchLyricsTool()]
    : [buildGetLyricsTool(false)];

  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'get_lyrics':
          return await getLyricsByIdentity(config, client, args);
        case 'search_lyrics':
          if (!hasLrclib) {
            throw new Error(ErrorFormatter.configMissing('LRCLIB lyrics', LRCLIB_CONFIG_KEYS));
          }
          return await searchLyricsCandidates(config, client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}
