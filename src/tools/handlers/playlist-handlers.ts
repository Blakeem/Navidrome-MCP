/**
 * Navidrome MCP Server - Playlist Tool Handlers
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
import {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  getPlaylistTracks,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistTrack,
} from '../playlist-management.js';

// Tool definitions for playlist management category
const tools: Tool[] = [
  {
    name: 'list_playlists',
    description: 'List all playlists accessible to the user with clean, LLM-friendly data',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of playlists to return (1-500)',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of playlists to skip for pagination',
          minimum: 0,
          default: 0,
        },
        sort: {
          type: 'string',
          description: 'Field to sort by',
          default: 'name',
        },
        order: {
          type: 'string',
          description: 'Sort order',
          enum: ['ASC', 'DESC'],
          default: 'ASC',
        },
        onlyWithPlayableTracks: {
          type: 'boolean',
          description:
            'When true, return only playlists containing at least one track in the currently active libraries (useful when the user asks what they can play). Default false returns all playlists.',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_playlist',
    description: 'Get detailed information about a specific playlist by ID',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          description: 'The playlist ID, as returned by the `list_playlists` tool.',
        },
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'create_playlist',
    description: 'Create a new playlist with a name, optional description, and visibility setting',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the playlist',
        },
        comment: {
          type: 'string',
          description: 'Optional description or comment for the playlist',
        },
        public: {
          type: 'boolean',
          description: 'Whether the playlist should be public',
          default: false,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_playlist',
    description: 'Update a playlist\'s metadata (name, description, visibility)',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          description: 'The playlist ID, as returned by the `list_playlists` tool.',
        },
        name: {
          type: 'string',
          description: 'New name for the playlist',
        },
        comment: {
          type: 'string',
          description: 'New description or comment',
        },
        public: {
          type: 'boolean',
          description: 'New public visibility setting',
        },
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'delete_playlist',
    description: 'Delete a playlist (owner or admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          description: 'The playlist ID, as returned by the `list_playlists` tool.',
        },
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'get_playlist_tracks',
    description: 'Get all tracks in a playlist (supports JSON or M3U export). Response shape is discriminated by `format`: JSON mode returns `{ format: "json", tracks, total }` with each track exposing both an `id` (1-based playlist position used for reordering/removing) and a `mediaFileId` (actual song ID for playback/metadata). M3U mode returns `{ format: "m3u", m3uContent }` — the raw .m3u text payload (no tracks/total arrays, since they would be redundant with the playlist body).\n\nBy default each track is compact (id, mediaFileId, title, artist, album, durationFormatted) to keep large playlists under the response size cap. Set `verbose: true` for full per-track metadata (path, bitRate, raw duration, playlistId, trackNumber, year, genre, albumArtist).',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          description: 'The unique ID of the playlist',
        },
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
        format: {
          type: 'string',
          description: 'Output format: json for structured data, m3u for playlist file',
          enum: ['json', 'm3u'],
          default: 'json',
        },
        verbose: {
          type: 'boolean',
          description: 'When false (default) each track carries only identity fields (id, mediaFileId, title, artist, album, durationFormatted) to save context; set true for full per-track metadata (path, bitRate, raw duration, playlistId, trackNumber, year, genre, albumArtist).',
          default: false,
        },
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'add_tracks_to_playlist',
    description: 'Add multiple types of content to a playlist in a single efficient operation. Supports any combination of individual songs, complete albums, artist discographies, or specific disc tracks.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          description: 'The unique ID of the playlist',
        },
        songIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of individual song IDs to add',
        },
        albumIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of album IDs to add (all tracks from each album)',
        },
        artistIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of artist IDs to add (complete discographies)',
        },
        discs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              albumId: { type: 'string' },
              discNumber: { type: 'number' },
            },
            required: ['albumId', 'discNumber'],
          },
          description: 'Array of specific discs to add',
        },
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'remove_tracks_from_playlist',
    description: 'Remove tracks from a playlist by track position IDs',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          description: 'The unique ID of the playlist',
        },
        trackIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of track position IDs to remove',
          minItems: 1,
        },
      },
      required: ['playlistId', 'trackIds'],
    },
  },
  {
    name: 'reorder_playlist_track',
    description: 'Reorder a track within a playlist to a new position. Positions are 1-based and match the `id` field returned by get_playlist_tracks. Use insert_before=1 to move a track to the first slot; insert_before=N+1 to send it to the end of an N-track playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: {
          type: 'string',
          description: 'The unique ID of the playlist',
        },
        trackId: {
          type: 'string',
          description: 'The current 1-based track position ID to move (matches the `id` field from get_playlist_tracks)',
        },
        insert_before: {
          type: 'number',
          description: 'Target 1-based position to insert the track before. 1 = first slot, N+1 = append to an N-track playlist.',
          minimum: 1,
        },
      },
      required: ['playlistId', 'trackId', 'insert_before'],
    },
  },
];

// Factory function for creating playlist tool category with dependencies  
export function createPlaylistToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_playlists':
          return await listPlaylists(client, args);
        case 'get_playlist':
          return await getPlaylist(client, args);
        case 'create_playlist':
          return await createPlaylist(client, args);
        case 'update_playlist':
          return await updatePlaylist(client, args);
        case 'delete_playlist':
          return await deletePlaylist(client, args);
        case 'get_playlist_tracks':
          return await getPlaylistTracks(client, args);
        case 'add_tracks_to_playlist':
          return await addTracksToPlaylist(client, args);
        case 'remove_tracks_from_playlist':
          return await removeTracksFromPlaylist(client, args);
        case 'reorder_playlist_track':
          return await reorderPlaylistTrack(client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(`playlist ${name}`));
      }
    }
  };
}