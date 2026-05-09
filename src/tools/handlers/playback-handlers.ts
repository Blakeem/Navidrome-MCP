/**
 * Navidrome MCP Server - Playback Tool Handlers
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

import {
  pause,
  resume,
  setVolume,
  playbackStatus,
  playSong,
  playAlbum,
  next,
  previous,
  seek,
  nowPlaying,
} from '../playback.js';

// Tool definitions for the playback category (Stage 2 — 10 tools).
const tools: Tool[] = [
  {
    name: 'pause',
    description: 'Pause local audio playback (mpv). Spawns mpv on first call. Position is preserved so resume continues from the same spot.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'resume',
    description: 'Resume local audio playback (mpv). Spawns mpv on first call.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'set_volume',
    description: "Set mpv's internal playback volume on a 0-100 scale. Lazy-spawns mpv if needed. Values outside the range are clamped.",
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'number',
          description: 'Target volume (0 = mute, 100 = full). Clamped to range.',
          minimum: 0,
          maximum: 100,
        },
      },
      required: ['level'],
      additionalProperties: false,
    },
  },
  {
    name: 'playback_status',
    description: 'Probe the playback engine. Returns whether mpv is currently spawned, its detected path/version, and current volume/idle state. Does NOT spawn mpv if the engine is not already running.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'play_song',
    description: 'Play a single song through the local speakers via mpv. Replaces any currently playing audio. Verifies the song exists in Navidrome before loading.',
    inputSchema: {
      type: 'object',
      properties: {
        songId: {
          type: 'string',
          description: 'Navidrome song ID to play.',
          minLength: 1,
        },
      },
      required: ['songId'],
      additionalProperties: false,
    },
  },
  {
    name: 'play_album',
    description: 'Play an entire album through the local speakers via mpv. Replaces any currently playing audio. Tracks load in album order unless `shuffle` is true.',
    inputSchema: {
      type: 'object',
      properties: {
        albumId: {
          type: 'string',
          description: 'Navidrome album ID to play.',
          minLength: 1,
        },
        shuffle: {
          type: 'boolean',
          description: 'When true, randomize the play order once before queueing. Defaults to false.',
          default: false,
        },
      },
      required: ['albumId'],
      additionalProperties: false,
    },
  },
  {
    name: 'next',
    description: 'Skip to the next track in the local mpv playlist.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'previous',
    description: 'Skip to the previous track in the local mpv playlist.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'seek',
    description: "Move the playback position within the current track. `mode: 'absolute'` jumps to the given second; `mode: 'relative'` (default) offsets from the current position (negative seeks backwards).",
    inputSchema: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: 'Target time or offset in seconds.',
        },
        mode: {
          type: 'string',
          enum: ['absolute', 'relative'],
          description: "Seek mode. Defaults to 'relative'.",
          default: 'relative',
        },
      },
      required: ['seconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'now_playing',
    description: "Report the current local playback state — title, artist, album, position, duration, paused, and queue index/length. Reads from the engine's property cache; does NOT spawn mpv if it isn't already running.",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

/**
 * Factory for the playback ToolCategory. Wires the 10 Stage 2 tools to
 * their underlying engine calls.
 */
export function createPlaybackToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'pause':
          return pause(args);
        case 'resume':
          return resume(args);
        case 'set_volume':
          return setVolume(args);
        case 'playback_status':
          return playbackStatus(args);
        case 'play_song':
          return playSong(client, args);
        case 'play_album':
          return playAlbum(client, args);
        case 'next':
          return next(args);
        case 'previous':
          return previous(args);
        case 'seek':
          return seek(args);
        case 'now_playing':
          return nowPlaying(args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    },
  };
}
