/**
 * Navidrome MCP Server - Lyrics Tool Handlers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
        ? "Navidrome song ID. Returns timed lyrics from the audio file, then timed lyrics from LRCLIB found with that song's metadata, then plain lyrics from the file, then plain lyrics from LRCLIB. Pass songId or lrclibId, not both."
        : 'Navidrome song ID. Reads the lyrics stored in the audio file.',
    },
  };

  if (hasLrclib) {
    properties['lrclibId'] = {
      type: 'string',
      description: 'LRCLIB record ID, as returned by search_lyrics. Fetches that record directly. Pass lrclibId or songId, not both.',
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
