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

// The Last.fm tools register only when Last.fm is configured, so get_artist names them only then.
function buildGetArtistTool(hasLastFm: boolean): Tool {
  const lastFmSentence = hasLastFm
    ? ' For a Last.fm biography, similar artists, and top tracks, use the Last.fm tools (get_artist_info, get_similar_artists, get_top_tracks_by_artist).'
    : '';
  return {
    name: 'get_artist',
    description: `Returns the full record for a single artist by ID. Same fields as search_artists with verbose=true.${lastFmSentence}`,
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
  };
}

const staticTools: Tool[] = [
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
    description: 'Returns the full record for a single album by ID. Same fields as search_albums with verbose=true. Use this when you already have the album ID. Does NOT include the album\'s tracks. To list them, call search_songs with the album name as query and sort=\'album\', then keep the songs whose albumId equals this album\'s id (compact song results carry albumId, and sort=album returns them in disc and track order).',
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
    description: 'Get user information including available libraries with active status flags. Library filtering affects all search and list operations. When multiple libraries are active, results combine content from all active libraries. Use this to separate different music collections (e.g., personal vs family music). Note: the server authenticates as a single Navidrome account, so the active-library selection is process-global. Under the HTTP transport it is shared across ALL connected sessions. summary.totalSongs, totalAlbums and totalArtists count the active libraries only. totalArtists counts every credited participant, composers included, so it exceeds the search_artists total, which counts album and track artists. Per-library counts are in libraries.available[].stats.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_active_libraries',
    description: 'Set which libraries are active for filtering music content. Library filtering affects all search and list operations. When multiple libraries are active, results combine content from all active libraries. Use this to separate different music collections (e.g., personal vs family music). Note: the server authenticates as a single Navidrome account, so this selection is process-global. Under the HTTP transport a set_active_libraries call changes the active-library filter for ALL connected sessions, not just the caller. The selection lasts until the server restarts. The startup default is the Default libraries setting on the config page (library.defaultLibraryIds in settings.json).',
    inputSchema: {
      type: 'object',
      properties: {
        libraryIds: {
          type: 'array',
          items: {
            type: 'integer',
            minimum: 1,
          },
          description: 'Library IDs to set as active, from get_user_details libraries.available[].id. The call fails if any ID is unknown.',
          minItems: 1,
        },
      },
      required: ['libraryIds'],
      additionalProperties: false,
    },
  },
];

export function createLibraryToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  const tools: Tool[] = [...staticTools, buildGetArtistTool(config.features.lastfm)];

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
          return await getUserDetails(client);
        case 'set_active_libraries':
          return await setActiveLibraries(client, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}
