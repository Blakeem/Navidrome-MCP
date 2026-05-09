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
  playSongs,
  playAlbums,
  playAlbumsSearch,
  playSongsSearch,
  next,
  previous,
  seek,
  nowPlaying,
  getPlayQueue,
  clearPlayQueue,
  shufflePlayQueue,
  moveInPlayQueue,
  removeFromPlayQueue,
} from '../playback.js';

// Tool definitions for the playback category (Stage 2 + Stage 3 + Stage 4 — 17 tools).
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
    name: 'play_songs',
    description: "Play one or many songs through the local speakers via mpv. `mode: 'replace'` (default) clears the play queue and starts playback; `mode: 'append'` adds to the end of the queue without clearing or unpausing. `shuffle: true` randomizes only the new batch before queueing.",
    inputSchema: {
      type: 'object',
      properties: {
        songIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Navidrome song IDs to play, in order.',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: "'replace' clears the queue and starts playback; 'append' adds to the end without clearing or unpausing. Defaults to 'replace'.",
          default: 'replace',
        },
        shuffle: {
          type: 'boolean',
          description: 'When true, randomize the new batch with Fisher-Yates before queueing. Defaults to false.',
          default: false,
        },
      },
      required: ['songIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'play_albums',
    description: "Play one or many albums through the local speakers via mpv. `mode: 'replace'` (default) clears the play queue and starts playback; `mode: 'append'` adds to the end without clearing or unpausing. `shuffle` controls track ordering: 'none' = input album order with natural track order; 'albums' = randomize album order, natural track order within each; 'songs' = fully randomize all tracks across all albums.",
    inputSchema: {
      type: 'object',
      properties: {
        albumIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Navidrome album IDs to play, in order.',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: "'replace' clears the queue and starts playback; 'append' adds to the end without clearing or unpausing. Defaults to 'replace'.",
          default: 'replace',
        },
        shuffle: {
          type: 'string',
          enum: ['none', 'albums', 'songs'],
          description: "'none' keeps input order; 'albums' shuffles the album order only; 'songs' flattens all tracks then shuffles. Defaults to 'none'.",
          default: 'none',
        },
      },
      required: ['albumIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'play_albums_search',
    description: "Play albums matching search filters via the local mpv player. Pass any filter from `search_albums` (query, genre, artist, year range, starred, etc.) plus `mode` and `shuffle`. Use this when you don't have explicit album IDs in hand. For 'N random albums' use `sort: 'random'` and `limit: N`.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for in album names or artists',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of albums to return',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of albums to skip for pagination',
          minimum: 0,
          default: 0,
        },
        // Enhanced filtering options
        genre: {
          type: 'string',
          description: 'Filter by music genre (e.g., "Rock", "Jazz", "Classical")',
        },
        mediaType: {
          type: 'string',
          description: 'Filter by media type (e.g., "CD", "Vinyl", "Digital")',
        },
        country: {
          type: 'string',
          description: 'Filter by release country (e.g., "US", "UK", "Germany")',
        },
        releaseType: {
          type: 'string',
          description: 'Filter by release type (e.g., "Album", "EP", "Single")',
        },
        recordLabel: {
          type: 'string',
          description: 'Filter by record label (e.g., "Columbia Records", "Sony Music")',
        },
        mood: {
          type: 'string',
          description: 'Filter by musical mood (e.g., "Energetic", "Melancholy", "Upbeat")',
        },
        // Advanced sorting options
        sort: {
          type: 'string',
          enum: ['name', 'artist', 'year', 'songCount', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
          description: 'Sort field for results',
          default: 'name',
        },
        order: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          description: 'Sort order',
          default: 'ASC',
        },
        randomSeed: {
          type: 'number',
          description: 'Seed for consistent random ordering (use with sort=random)',
        },
        // Year filtering
        yearFrom: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results from this year onwards',
        },
        yearTo: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results up to this year',
        },
        // Boolean filters
        starred: {
          type: 'boolean',
          description: 'Filter for starred/favorited items only',
        },
        // Playback-specific args
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: "'replace' clears the queue and starts playback; 'append' adds to the end without clearing or unpausing. Defaults to 'replace'.",
          default: 'replace',
        },
        shuffle: {
          type: 'string',
          enum: ['none', 'albums', 'songs'],
          description: "'none' keeps search-result album order; 'albums' shuffles the album order only; 'songs' flattens all tracks then shuffles. Defaults to 'none'.",
          default: 'none',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'play_songs_search',
    description: "Play songs matching search filters via the local mpv player. Pass any filter from `search_songs` plus `mode` and `shuffle`. Use this when you don't have explicit song IDs in hand. For 'play all my starred songs' use `starred: true, limit: 500`.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to look for in song titles, artists, or albums',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of songs to return',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of songs to skip for pagination',
          minimum: 0,
          default: 0,
        },
        // Enhanced filtering options
        genre: {
          type: 'string',
          description: 'Filter by music genre (e.g., "Rock", "Jazz", "Classical")',
        },
        mediaType: {
          type: 'string',
          description: 'Filter by media type (e.g., "CD", "Vinyl", "Digital")',
        },
        country: {
          type: 'string',
          description: 'Filter by release country (e.g., "US", "UK", "Germany")',
        },
        releaseType: {
          type: 'string',
          description: 'Filter by release type (e.g., "Album", "EP", "Single")',
        },
        recordLabel: {
          type: 'string',
          description: 'Filter by record label (e.g., "Columbia Records", "Sony Music")',
        },
        mood: {
          type: 'string',
          description: 'Filter by musical mood (e.g., "Energetic", "Melancholy", "Upbeat")',
        },
        // Advanced sorting options
        sort: {
          type: 'string',
          enum: ['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating', 'recently_added', 'starred_at', 'random'],
          description: 'Sort field for results',
          default: 'title',
        },
        order: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          description: 'Sort order',
          default: 'ASC',
        },
        randomSeed: {
          type: 'number',
          description: 'Seed for consistent random ordering (use with sort=random)',
        },
        // Year filtering
        yearFrom: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results from this year onwards',
        },
        yearTo: {
          type: 'number',
          minimum: 1900,
          maximum: new Date().getFullYear(),
          description: 'Filter results up to this year',
        },
        // Boolean filters
        starred: {
          type: 'boolean',
          description: 'Filter for starred/favorited items only',
        },
        // Playback-specific args
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: "'replace' clears the queue and starts playback; 'append' adds to the end without clearing or unpausing. Defaults to 'replace'.",
          default: 'replace',
        },
        shuffle: {
          type: 'boolean',
          description: 'When true, randomize the matched songs with Fisher-Yates before queueing. Defaults to false.',
          default: false,
        },
      },
      required: [],
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
  {
    name: 'get_play_queue',
    description: "Return the current live mpv play queue with track metadata and the index of the currently-playing track. Read-only; does not start mpv if it isn't running.",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'clear_play_queue',
    description: 'Clear the live play queue and stop playback. Use to fully halt audio output.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'shuffle_play_queue',
    description: 'Randomize the order of items in the current live play queue. Does not change membership.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'move_in_play_queue',
    description: 'Move the play-queue entry at index `from` so that it takes the place of the entry at index `to`.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'number',
          minimum: 0,
          description: 'Source index of the entry to move.',
        },
        to: {
          type: 'number',
          minimum: 0,
          description: 'Destination index for the entry.',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_from_play_queue',
    description: 'Remove the play-queue entry at the given index. mpv auto-advances if the removed track was currently playing.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          minimum: 0,
          description: 'Index of the play-queue entry to remove.',
        },
      },
      required: ['index'],
      additionalProperties: false,
    },
  },
];

/**
 * Factory for the playback ToolCategory. Wires the Stage 2 + Stage 3 + Stage 4
 * playback tools to their underlying engine calls. `config` is forwarded to
 * the search-driven playback tools so they can reuse the existing
 * `searchAlbums` / `searchSongs` implementations.
 */
export function createPlaybackToolCategory(client: NavidromeClient, config: Config): ToolCategory {
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
        case 'play_songs':
          return playSongs(client, args);
        case 'play_albums':
          return playAlbums(client, args);
        case 'play_albums_search':
          return playAlbumsSearch(client, config, args);
        case 'play_songs_search':
          return playSongsSearch(client, config, args);
        case 'next':
          return next(args);
        case 'previous':
          return previous(args);
        case 'seek':
          return seek(args);
        case 'now_playing':
          return nowPlaying(args);
        case 'get_play_queue':
          return getPlayQueue(args);
        case 'clear_play_queue':
          return clearPlayQueue(args);
        case 'shuffle_play_queue':
          return shufflePlayQueue(args);
        case 'move_in_play_queue':
          return moveInPlayQueue(args);
        case 'remove_from_play_queue':
          return removeFromPlayQueue(args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    },
  };
}
