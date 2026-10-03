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

const PLAYLIST_ID_PROPERTY = {
  type: 'string',
  minLength: 1,
  description: 'The playlist ID, as returned by the `list_playlists` tool.',
} as const;

const tools: Tool[] = [
  {
    name: 'list_playlists',
    description: 'List all playlists accessible to the user with clean, LLM-friendly data',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of playlists to return (1-500)',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'integer',
          description: 'Number of playlists to skip for pagination',
          minimum: 0,
          default: 0,
        },
        sort: {
          type: 'string',
          description: 'Field to sort by: name, songCount, duration, createdAt or updatedAt',
          enum: ['name', 'songCount', 'duration', 'createdAt', 'updatedAt'],
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
            'When true, return only playlists containing at least one track in the currently active libraries (useful when the user asks what they can play). Default false returns all playlists. Only the first 500 playlists in the requested sort order are checked. The response carries truncated: true when more exist.',
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
        playlistId: PLAYLIST_ID_PROPERTY,
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'create_playlist',
    description: 'Create a new playlist with a name, optional comment, and visibility setting',
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
    description: 'Update a playlist\'s metadata (name, comment, public). Pass at least one of name, comment or public.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: PLAYLIST_ID_PROPERTY,
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
        playlistId: PLAYLIST_ID_PROPERTY,
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'get_playlist_tracks',
    description: 'Get all tracks in a playlist (supports JSON or M3U export). Response shape is discriminated by `format`: JSON mode returns `{ format: "json", tracks, total }` with each track exposing a `position` (its 1-based position in the playlist, a string) and a `songId` (the stable song ID for playback/metadata). remove_tracks_from_playlist and reorder_playlist_track take the `position`. Duplicate songs each occupy their own position. IMPORTANT: positions SHIFT after any add/remove/reorder, so you MUST call get_playlist_tracks again for fresh positions before each mutation and must never reuse positions across mutations. M3U mode returns `{ format: "m3u", m3uContent }`, the raw .m3u text payload (no tracks/total arrays, since they would be redundant with the playlist body). M3U mode ignores limit and offset and always returns the whole playlist.\n\nBy default each track is compact to keep large playlists under the response size cap. Set `verbose: true` for full per-track metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: PLAYLIST_ID_PROPERTY,
        limit: {
          type: 'integer',
          description: 'Maximum number of tracks to return (1-500)',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'integer',
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
          description: 'When false (default) each track carries only identity fields (position, songId, title, artist, album, durationFormatted) to save context. Set true for full per-track metadata (path, bitRate, raw duration, playlistId, trackNumber, year, genre, albumArtist).',
          default: false,
        },
      },
      required: ['playlistId'],
    },
  },
  {
    name: 'add_tracks_to_playlist',
    description: 'Add multiple types of content to a playlist in a single efficient operation. Supports any combination of individual songs, complete albums, every track whose album artist is a given artist, or specific disc tracks. At least one of songIds, albumIds, artistIds or discs must be non-empty. An unknown song ID fails the call and adds nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: PLAYLIST_ID_PROPERTY,
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
          description: 'Artist IDs. Adds every track whose album artist is that artist. Featured and track-artist appearances are not included. Add those by songIds, for example from search_songs.',
        },
        discs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              albumId: { type: 'string' },
              discNumber: { type: 'integer', minimum: 1 },
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
    description: 'Remove tracks from a playlist by position. `positions` takes the 1-based `position` values from get_playlist_tracks, never song IDs. Duplicate songs each occupy their own position. Positions SHIFT after any add/remove/reorder, so call get_playlist_tracks again for fresh positions before each mutation and never reuse positions across mutations. Remove at most 500 tracks per call. For larger clears, batch into repeated calls and re-read positions between batches.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: PLAYLIST_ID_PROPERTY,
        positions: {
          type: 'array',
          items: { type: 'string' },
          description: 'The 1-based `position` values from get_playlist_tracks to remove (max 500 per call)',
          minItems: 1,
          maxItems: 500,
        },
      },
      required: ['playlistId', 'positions'],
    },
  },
  {
    name: 'reorder_playlist_track',
    description: 'Reorder a track within a playlist to a new position. `position` takes the 1-based `position` value from get_playlist_tracks. Positions SHIFT after any mutation, so re-read get_playlist_tracks before reordering. When making several moves, re-read between them rather than reusing stale positions. Use insertBefore=1 to move a track to the first slot and insertBefore=N+1 to send it to the end of an N-track playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: PLAYLIST_ID_PROPERTY,
        position: {
          type: 'string',
          description: 'The current 1-based position of the track to move (the `position` value from get_playlist_tracks)',
        },
        insertBefore: {
          type: 'integer',
          description: 'Target 1-based position to insert the track before. 1 = first slot, N+1 = append to an N-track playlist.',
          minimum: 1,
        },
      },
      required: ['playlistId', 'position', 'insertBefore'],
    },
  },
];

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
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}