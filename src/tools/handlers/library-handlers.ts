/**
 * Navidrome MCP Server - Library Tool Handlers
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
import {
  getSong,
  getAlbum,
  getArtist,
  getSongPlaylists,
} from '../media-library.js';
import { getUserDetails, setActiveLibraries } from '../library.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';

const tools: Tool[] = [
  {
    name: 'get_song',
    description: 'Returns the full record for a single song by ID. Same fields as search_songs with verbose=true. Use this when you already have the song ID and want the canonical SongDTO without searching. To list a song\'s containing playlists, use get_song_playlists.',
    inputSchema: {
      type: 'object',
      properties: {
        songId: {
          type: 'string',
          description: 'The song ID, as returned by search_songs or list_* tools.',
        },
      },
      required: ['songId'],
    },
  },
  {
    name: 'get_album',
    description: 'Returns the full record for a single album by ID. Same fields as search_albums with verbose=true. Use this when you already have the album ID. Does NOT include the album\'s tracks. To list them, call search_songs with the album name as query and keep the songs whose albumId equals this album\'s id (compact song results carry albumId).',
    inputSchema: {
      type: 'object',
      properties: {
        albumId: {
          type: 'string',
          description: 'The album ID, as returned by search_albums or list_* tools.',
        },
      },
      required: ['albumId'],
    },
  },
  {
    name: 'get_artist',
    description: 'Returns the full record for a single artist by ID. Same fields as search_artists with verbose=true. For a Last.fm biography, similar artists, and top tracks, use the Last.fm tools (get_artist_info, get_similar_artists, get_top_tracks_by_artist).',
    inputSchema: {
      type: 'object',
      properties: {
        artistId: {
          type: 'string',
          description: 'The artist ID, as returned by search_artists or list_* tools.',
        },
      },
      required: ['artistId'],
    },
  },
  {
    name: 'get_song_playlists',
    description: 'Get all playlists that contain a specific song',
    inputSchema: {
      type: 'object',
      properties: {
        songId: {
          type: 'string',
          description: 'The unique ID of the song',
        },
      },
      required: ['songId'],
    },
  },
  {
    name: 'get_user_details',
    description: 'Get user information including available libraries with active status flags. Library filtering affects all search and list operations. When multiple libraries are active, results combine content from all active libraries. Use this to separate different music collections (e.g., personal vs family music). Note: the server authenticates as a single Navidrome account, so the active-library selection is process-global. Under the HTTP transport it is shared across ALL connected sessions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_active_libraries',
    description: 'Set which libraries are active for filtering music content. Library filtering affects all search and list operations. When multiple libraries are active, results combine content from all active libraries. Use this to separate different music collections (e.g., personal vs family music). Note: the server authenticates as a single Navidrome account, so this selection is process-global. Under the HTTP transport a set_active_libraries call changes the active-library filter for ALL connected sessions, not just the caller.',
    inputSchema: {
      type: 'object',
      properties: {
        libraryIds: {
          type: 'array',
          items: {
            type: 'number',
          },
          description: 'Array of library IDs to set as active',
          minItems: 1,
        },
      },
      required: ['libraryIds'],
    },
  },
];

export function createLibraryToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'get_song':
          return await getSong(client, args);
        case 'get_album':
          return await getAlbum(client, args);
        case 'get_artist':
          return await getArtist(client, args);
        case 'get_song_playlists':
          return await getSongPlaylists(client, args);
        case 'get_user_details':
          return getUserDetails();
        case 'set_active_libraries':
          return await setActiveLibraries(args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}
