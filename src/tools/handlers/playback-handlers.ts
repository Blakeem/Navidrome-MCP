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
  playQueueIndex,
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
    description: "ONE-SHOT search + enqueue for albums — runs the album search AND pipes every matched album's tracks into mpv in a single call. PREFER THIS over the two-step pattern (`search_albums` or `list_starred_items` → `play_albums`); passing matched IDs back through the LLM wastes context tokens. Common intents → invocation: 'play 5 random starred albums' → `{starred: true, sort: 'random', limit: 5}`; 'queue up some jazz' → `{genre: 'Jazz', limit: 10}`; 'shuffle my 2024 releases' → `{year: 2024, shuffle: 'songs'}`; 'add this artist's albums to the queue' → `{query: '<artist>', mode: 'append'}`. Accepts every `search_albums` filter (query, genre, mediaType, country, releaseType, recordLabel, mood, year, starred, sort, order, randomSeed) plus `mode` ('replace' | 'append', default 'replace') and `shuffle` ('none' | 'albums' | 'songs', default 'none'). Use the two-step pattern only when you need to show the user the album list first before playing.",
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
        // Single-year filter. Navidrome's REST API has no range filter — for
        // multi-year queries, call the tool once per year and merge client-side.
        year: {
          type: 'number',
          minimum: 1900,
          description: 'Filter to a single year. Albums match if [minYear, maxYear] contains this year; songs match the exact year column.',
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
    description: "ONE-SHOT search + enqueue for songs — runs the song search AND pipes the matched track IDs into mpv in a single call. PREFER THIS over the two-step pattern (`search_songs` or `list_starred_items` → `play_songs`); passing matched IDs back through the LLM wastes context tokens, especially for large result sets. Common intents → invocation: 'play all my starred songs' → `{starred: true, limit: 500}`; 'play 50 random rock songs' → `{genre: 'Rock', sort: 'random', limit: 50}`; 'queue up my top-rated tracks' → `{sort: 'rating', order: 'DESC', limit: 100}`; 'shuffle recent additions' → `{sort: 'recently_added', order: 'DESC', limit: 100, shuffle: true}`; 'add songs by this artist' → `{query: '<artist>', mode: 'append'}`. Accepts every `search_songs` filter (query, genre, mediaType, country, releaseType, recordLabel, mood, year, starred, sort, order, randomSeed) plus `mode` ('replace' | 'append', default 'replace') and `shuffle` (boolean, default false). Use the two-step pattern only when you need to show the user the song list first before playing.",
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
        // Single-year filter. Navidrome's REST API has no range filter — for
        // multi-year queries, call the tool once per year and merge client-side.
        year: {
          type: 'number',
          minimum: 1900,
          description: 'Filter to a single year. Albums match if [minYear, maxYear] contains this year; songs match the exact year column.',
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
    description: "Report the current local playback state — title, artist, album, position, duration, paused, and queue index/length. Reads from the engine's property cache; does NOT spawn mpv if it isn't already running. `duration` is reconciled against Navidrome's pre-scanned per-song metadata, so it's accurate from the first poll even for VBR streams where mpv would otherwise report a partial value during its scan.",
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
  {
    name: 'play_queue_index',
    description: 'Start playing the existing play-queue entry at the given index (jumps the play head without changing queue contents). Unpauses if paused. Use this to skip to a non-adjacent track; for adjacent moves prefer `next`/`previous`.',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          minimum: 0,
          description: 'Zero-based queue index of the entry to play.',
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
          return getPlayQueue(client, args);
        case 'clear_play_queue':
          return clearPlayQueue(args);
        case 'shuffle_play_queue':
          return shufflePlayQueue(args);
        case 'move_in_play_queue':
          return moveInPlayQueue(args);
        case 'remove_from_play_queue':
          return removeFromPlayQueue(args);
        case 'play_queue_index':
          return playQueueIndex(args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    },
  };
}
