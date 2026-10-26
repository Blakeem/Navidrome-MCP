/**
 * Navidrome MCP Server - Playback Tool Handlers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { ALBUM_FILTER_PROPERTIES, SONG_FILTER_PROPERTIES } from './search-handlers.js';
import { respawnWebForPlay } from './respawn-on-play.js';

/**
 * Tools that load new content respawn the web player first, since powering it off also quits mpv.
 * Queue navigators and mutators skip it, since a powered-off player leaves no queue to act on.
 */
const PLAYBACK_STARTERS = new Set([
  'play_songs',
  'play_albums',
  'play_albums_search',
  'play_songs_search',
  'play_playlist',
]);

import {
  pause,
  resume,
  setVolume,
  listAudioDevices,
  setAudioDevice,
  playbackStatus,
  playSongs,
  playAlbums,
  playAlbumsSearch,
  playSongsSearch,
  playPlaylist,
  next,
  previous,
  seek,
  nowPlaying,
  getPlayQueuePage,
  clearPlayQueue,
  shufflePlayQueue,
  moveInPlayQueue,
  removeFromPlayQueue,
  playQueueIndex,
} from '../playback.js';

const QUEUE_MODE_DESCRIPTION = "'replace' clears the queue and starts playback. 'append' adds to the end without clearing or unpausing. When the queue holds a radio stream, 'append' acts as 'replace': the station is removed, playback starts, and the result carries `demoted: true`. When the selected audio output is not connected, 'replace' and an 'append' acting as 'replace' keep playback paused, and the result carries `paused: true` and `message`. When no track is current (the queue is empty, finished, or mpv just started), 'append' loads the first new track paused, so use 'replace' or call resume to start playback. When web-player guests have unplayed songs queued, a 'replace' adds those songs back after the new songs on mpv 0.36 or newer. A guest song that already waits in the new queue drops. Defaults to 'replace'.";

const ALBUM_SHUFFLE_PROPERTIES = {
  shuffleAlbums: {
    type: 'boolean',
    description: 'Shuffle the album order. Each album keeps its disc and track order unless shuffleSongs is also true. Defaults to false.',
    default: false,
  },
  shuffleSongs: {
    type: 'boolean',
    description: 'Shuffle the tracks. Alone, it shuffles every track across all albums. With shuffleAlbums, it shuffles the album order and the tracks within each album. Defaults to false.',
    default: false,
  },
};

const tools: Tool[] = [
  {
    name: 'pause',
    description: 'Pause local audio playback (mpv). Reports nothing to pause when no playback is active (does not start mpv). Position is preserved so resume continues from the same spot.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'resume',
    description: 'Resume local audio playback (mpv). Reports nothing to resume when no playback is active (does not start mpv). Stays paused when the selected audio output is not connected. Use a play tool to begin.',
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
        },
      },
      required: ['level'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_audio_devices',
    description: 'List the audio outputs mpv can play to, such as speakers, HDMI, a USB DAC or a connected Bluetooth speaker. Each device has an `id` and a `name`. `selected` is the current choice, and `connected: false` means it is off or out of range. A Bluetooth speaker is listed only while the OS has it connected, so pairing alone is not enough. On Windows 10 one Bluetooth speaker can appear twice, so prefer the Stereo entry over Hands-Free. Shows one audio driver. `verbose: true` shows every driver. Does not start mpv.',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: {
          type: 'boolean',
          description: 'When true, list the devices of every audio driver. Defaults to false.',
          default: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_audio_device',
    description: 'Play through the audio output with this `id` from list_audio_devices, or `auto` for the system default. When mpv is running it switches at once and keeps the position. The choice is saved and applies each time mpv starts. If the chosen output disconnects, playback pauses. Does not start mpv.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          maxLength: 512,
          description: 'A device `id` from list_audio_devices, or `auto` for the system default.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'playback_status',
    description: 'Probe the playback engine. Returns whether mpv is currently spawned, its detected path/version, current volume/idle state, `audioDevice` (the selected audio output with its `id`, `name` and `connected`) and `audioOutputLost` (true when mpv has no working audio output). Does NOT spawn mpv if the engine is not already running.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'play_songs',
    description: "Play one or many songs through the local speakers via mpv. `mode: 'replace'` (default) clears the play queue and starts playback. When the selected audio output is not connected, playback stays paused and the result carries `paused: true` and `message`. `mode: 'append'` adds to the end of the queue without clearing or unpausing. `shuffle: true` randomizes only the new batch before queueing. `skipped` counts requested IDs that are unknown or outside the active libraries.",
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
          description: QUEUE_MODE_DESCRIPTION,
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
    description: "Play one or many albums through the local speakers via mpv. `mode: 'replace'` (default) clears the play queue and starts playback. When the selected audio output is not connected, playback stays paused and the result carries `paused: true` and `message`. `mode: 'append'` adds to the end without clearing or unpausing. With neither shuffle flag, albums play in input order with natural track order. `shuffleAlbums` randomizes album order. `shuffleSongs` randomizes tracks.",
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
          description: QUEUE_MODE_DESCRIPTION,
          default: 'replace',
        },
        ...ALBUM_SHUFFLE_PROPERTIES,
      },
      required: ['albumIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'play_albums_search',
    description: "ONE-SHOT search + enqueue for albums. Runs the album search AND pipes every matched album's tracks into mpv in a single call. PREFER THIS over the two-step pattern (`search_albums` or `list_starred_items` → `play_albums`), since passing matched IDs back through the LLM wastes context tokens. Accepts every `search_albums` filter (query, genre, mediaType, country, releaseType, recordLabel, mood, year, starred, sort, order, randomSeed) plus `mode` ('replace' | 'append', default 'replace'), `shuffleAlbums` (boolean, default false) and `shuffleSongs` (boolean, default false). Example invocations: `{starred: true, sort: 'random', limit: 5}`, `{genre: 'Jazz', limit: 10}`, `{year: 2024, shuffleSongs: true}`, `{query: '<artist>', mode: 'append'}`. Use the two-step pattern only when you need to show the album list first before playing.",
    inputSchema: {
      type: 'object',
      properties: {
        ...ALBUM_FILTER_PROPERTIES,
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: QUEUE_MODE_DESCRIPTION,
          default: 'replace',
        },
        ...ALBUM_SHUFFLE_PROPERTIES,
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'play_songs_search',
    description: "ONE-SHOT search + enqueue for songs. Runs the song search AND pipes the matched track IDs into mpv in a single call. PREFER THIS over the two-step pattern (`search_songs` or `list_starred_items` → `play_songs`), since passing matched IDs back through the LLM wastes context tokens, especially for large result sets. Accepts every `search_songs` filter (query, genre, mediaType, country, releaseType, recordLabel, mood, year, starred, sort, order, randomSeed) plus `mode` ('replace' | 'append', default 'replace') and `shuffle` (boolean, default false). Example invocations: `{starred: true, limit: 500}`, `{genre: 'Rock', sort: 'random', limit: 50}`, `{sort: 'rating', order: 'DESC', limit: 100}`, `{sort: 'recently_added', order: 'DESC', limit: 100, shuffle: true}`, `{query: '<artist>', mode: 'append'}`. Use the two-step pattern only when you need to show the song list first before playing.",
    inputSchema: {
      type: 'object',
      properties: {
        ...SONG_FILTER_PROPERTIES,
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: QUEUE_MODE_DESCRIPTION,
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
    name: 'play_playlist',
    description: "ONE-SHOT load a Navidrome playlist into the local mpv queue. Fetches every track in the playlist AND enqueues them in a single call. PREFER THIS over the two-step pattern (`get_playlist_tracks` → `play_songs`), since passing every `songId` back through the LLM wastes context tokens, especially for long playlists. Takes a `playlistId` (a Navidrome playlist ID, NOT a playlist name). Obtain it from the `list_playlists` tool. `mode: 'replace'` (default) clears the queue and starts playback. When the selected audio output is not connected, playback stays paused and the result carries `paused: true` and `message`. `mode: 'append'` adds to the end without clearing or unpausing. `shuffle: true` Fisher-Yates the playlist's tracks before queueing. Throws if the playlist has no tracks.",
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          minLength: 1,
          description: 'The playlist ID, as returned by the `list_playlists` tool.',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: QUEUE_MODE_DESCRIPTION,
          default: 'replace',
        },
        shuffle: {
          type: 'boolean',
          description: "When true, randomize the playlist's tracks with Fisher-Yates before queueing. Defaults to false.",
          default: false,
        },
      },
      required: ['playlistId'],
      additionalProperties: false,
    },
  },
  {
    name: 'next',
    description: 'Skip to the next track in the play queue. On the last entry it stops playback and reports `stopped: true`. When no entry is current it changes nothing and says so (does not start mpv).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'previous',
    description: 'Skip to the previous track in the play queue. On the first entry it restarts the track. When no entry is current it changes nothing and says so (does not start mpv).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'seek',
    description: "Move the playback position within the current track. `mode: 'absolute'` jumps to the given second, which must be 0 or more. `mode: 'relative'` (default) offsets from the current position (negative seeks backwards). A target past the end of the track skips to the next track. Reports nothing to seek when no playback is active (does not start mpv).",
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
    description: "Report the current local playback state: songId, title, artist, album, position, duration, paused, and queue index/length. `paused` is omitted when no entry is current. Reads from the engine's property cache. Does NOT spawn mpv if it isn't already running. `title`/`artist`/`album` and `duration` are reconciled against Navidrome's per-song metadata (by songId), so they're accurate from the first poll. That holds even during the brief track-load window where mpv would otherwise report the raw stream URL as the title, or a partial VBR duration during its scan. For radio, `isRadio` is true, `duration` is omitted since a live stream has no length, and `radioStation.name` names the saved station that play_radio_station played, or \"Unknown station\" when the stream matches none.",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_play_queue',
    description: "Return one page of the current live mpv play queue with track metadata and the index of the currently-playing track. Read-only. Does not start mpv if it isn't running. `length` is the full queue count and `currentIndex` is the absolute index, whatever the page. Pass now_playing's `queueIndex` as `offset` to read the upcoming tracks.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          default: 100,
          description: 'Maximum number of queue entries to return.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          default: 0,
          description: 'Zero-based queue index of the first entry to return.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'clear_play_queue',
    description: 'Clear the live play queue and stop playback. Use to fully halt audio output. Succeeds without starting mpv when nothing is playing.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'shuffle_play_queue',
    description: 'Randomize the order of items in the current live play queue. Does not change membership. The currently-playing track keeps playing (it is not restarted) and is moved to the top of the queue. The rest of the queue is shuffled around it. Reports an empty queue when nothing is playing (does not start mpv).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'move_in_play_queue',
    description: 'Move the play-queue entry at index `from` so it ends at index `to`. Reordering never changes what is currently playing. The play head stays on the same track and follows it if it was the one moved. Reports an empty queue when nothing is playing (does not start mpv).',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'integer',
          minimum: 0,
          description: 'Source index of the entry to move.',
        },
        to: {
          type: 'integer',
          minimum: 0,
          description: 'Final zero-based index of the moved entry, from 0 to the queue length minus 1. A larger value is rejected.',
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_from_play_queue',
    description: 'Remove the play-queue entry at the given index. mpv auto-advances if the removed track was currently playing. Reports an empty queue when nothing is playing (does not start mpv).',
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'integer',
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
    description: "Jump directly to the play-queue entry at the given index, like clicking a track row in the web UI. Does NOT reorder the queue, only moves the play head. Unpauses if paused. When the selected audio output is not connected, playback stays paused and the result carries `paused: true` and `message`. An index past the end is rejected. Reports an empty queue when nothing is playing (does not start mpv). Discovery flow: call `get_play_queue` first to find the index of the target track. For adjacent moves prefer `next`/`previous`.",
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'integer',
          minimum: 0,
          description: 'Zero-based queue index of the entry to play.',
        },
      },
      required: ['index'],
      additionalProperties: false,
    },
  },
];

export const PLAYBACK_TOOL_NAMES = tools.map((tool) => tool.name);

export function createPlaybackToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      if (PLAYBACK_STARTERS.has(name)) {
        await respawnWebForPlay(config);
      }
      switch (name) {
        case 'pause':
          return pause(args);
        case 'resume':
          return resume(args);
        case 'set_volume':
          return setVolume(args);
        case 'list_audio_devices':
          return listAudioDevices(args);
        case 'set_audio_device':
          return setAudioDevice(args);
        case 'playback_status':
          return playbackStatus(args);
        case 'play_songs':
          return playSongs(client, args);
        case 'play_albums':
          return playAlbums(client, args);
        case 'play_albums_search':
          return playAlbumsSearch(client, args);
        case 'play_songs_search':
          return playSongsSearch(client, args);
        case 'play_playlist':
          return playPlaylist(client, args);
        case 'next':
          return next(args);
        case 'previous':
          return previous(args);
        case 'seek':
          return seek(args);
        case 'now_playing':
          return nowPlaying(args, client);
        case 'get_play_queue':
          return getPlayQueuePage(client, args);
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
