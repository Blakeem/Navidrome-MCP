/**
 * Navidrome MCP Server - Tool Registry
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

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { testConnection } from './test.js';
import { listSongs } from './library.js';
import {
  listAlbums,
  listArtists,
  listGenres,
  getSong,
  getAlbum,
  getArtist,
  getSongPlaylists,
} from './media-library.js';
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
} from './playlist-management.js';
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from './search.js';

export function registerTools(server: Server, client: NavidromeClient, config: Config): void {
  // Define available tools
  const tools: Tool[] = [
    {
      name: 'test_connection',
      description: 'Test the connection to the Navidrome server',
      inputSchema: {
        type: 'object',
        properties: {
          includeServerInfo: {
            type: 'boolean',
            description: 'Include detailed server information in the response',
            default: false,
          },
        },
      },
    },
    {
      name: 'list_songs',
      description: 'List songs from the Navidrome music library with clean, LLM-friendly data (filtering and pagination supported)',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of songs to return (1-500)',
            minimum: 1,
            maximum: 500,
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Number of songs to skip for pagination',
            minimum: 0,
            default: 0,
          },
          sort: {
            type: 'string',
            description: 'Field to sort by',
            enum: ['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating'],
            default: 'title',
          },
          order: {
            type: 'string',
            description: 'Sort order',
            enum: ['ASC', 'DESC'],
            default: 'ASC',
          },
          starred: {
            type: 'boolean',
            description: 'Filter for starred songs only',
          },
        },
      },
    },
    {
      name: 'list_albums',
      description: 'List albums from the Navidrome music library with clean, LLM-friendly data',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of albums to return (1-500)',
            minimum: 1,
            maximum: 500,
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Number of albums to skip for pagination',
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
        },
      },
    },
    {
      name: 'list_artists',
      description: 'List artists from the Navidrome music library with clean, LLM-friendly data',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of artists to return (1-500)',
            minimum: 1,
            maximum: 500,
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Number of artists to skip for pagination',
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
        },
      },
    },
    {
      name: 'list_genres',
      description: 'List all genres from the Navidrome music library',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of genres to return (1-500)',
            minimum: 1,
            maximum: 500,
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Number of genres to skip for pagination',
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
        },
      },
    },
    {
      name: 'get_song',
      description: 'Get detailed information about a specific song by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the song',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_album',
      description: 'Get detailed information about a specific album by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the album',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_artist',
      description: 'Get detailed information about a specific artist by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the artist',
          },
        },
        required: ['id'],
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
            default: 20,
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
        },
      },
    },
    {
      name: 'get_playlist',
      description: 'Get detailed information about a specific playlist by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the playlist',
          },
        },
        required: ['id'],
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
          id: {
            type: 'string',
            description: 'The unique ID of the playlist to update',
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
        required: ['id'],
      },
    },
    {
      name: 'delete_playlist',
      description: 'Delete a playlist (owner or admin only)',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique ID of the playlist to delete',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_playlist_tracks',
      description: 'Get all tracks in a playlist (supports JSON or M3U export)',
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
        },
        required: ['playlistId'],
      },
    },
    {
      name: 'add_tracks_to_playlist',
      description: 'Add tracks to a playlist (supports song IDs, album IDs, artist IDs, or specific discs)',
      inputSchema: {
        type: 'object',
        properties: {
          playlistId: {
            type: 'string',
            description: 'The unique ID of the playlist',
          },
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of song IDs to add',
          },
          albumIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of album IDs to add (all tracks from albums)',
          },
          artistIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of artist IDs to add (all tracks from artists)',
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
      description: 'Reorder a track within a playlist to a new position',
      inputSchema: {
        type: 'object',
        properties: {
          playlistId: {
            type: 'string',
            description: 'The unique ID of the playlist',
          },
          trackId: {
            type: 'string',
            description: 'The track position ID to move',
          },
          insert_before: {
            type: 'number',
            description: 'New position (0-based index) to insert the track before',
            minimum: 0,
          },
        },
        required: ['playlistId', 'trackId', 'insert_before'],
      },
    },
    {
      name: 'search_all',
      description: 'Search across all content types (artists, albums, songs) using a single query',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search terms to look for',
          },
          artistCount: {
            type: 'number',
            description: 'Maximum number of artists to return',
            minimum: 0,
            maximum: 100,
            default: 20,
          },
          albumCount: {
            type: 'number',
            description: 'Maximum number of albums to return',
            minimum: 0,
            maximum: 100,
            default: 20,
          },
          songCount: {
            type: 'number',
            description: 'Maximum number of songs to return',
            minimum: 0,
            maximum: 100,
            default: 20,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_songs',
      description: 'Search for songs by title, artist, or album',
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
            maximum: 100,
            default: 20,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_albums',
      description: 'Search for albums by name or artist',
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
            maximum: 100,
            default: 20,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_artists',
      description: 'Search for artists by name',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search terms to look for in artist names',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of artists to return',
            minimum: 1,
            maximum: 100,
            default: 20,
          },
        },
        required: ['query'],
      },
    },
  ];

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Register call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'test_connection') {
      const result = await testConnection(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_songs') {
      const result = await listSongs(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_albums') {
      const result = await listAlbums(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_artists') {
      const result = await listArtists(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_genres') {
      const result = await listGenres(client, config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_song') {
      const result = await getSong(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_album') {
      const result = await getAlbum(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_artist') {
      const result = await getArtist(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_song_playlists') {
      const result = await getSongPlaylists(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_playlists') {
      const result = await listPlaylists(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_playlist') {
      const result = await getPlaylist(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'create_playlist') {
      const result = await createPlaylist(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'update_playlist') {
      const result = await updatePlaylist(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'delete_playlist') {
      const result = await deletePlaylist(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_playlist_tracks') {
      const result = await getPlaylistTracks(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'add_tracks_to_playlist') {
      const result = await addTracksToPlaylist(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'remove_tracks_from_playlist') {
      const result = await removeTracksFromPlaylist(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'reorder_playlist_track') {
      const result = await reorderPlaylistTrack(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'search_all') {
      const result = await searchAll(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'search_songs') {
      const result = await searchSongs(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'search_albums') {
      const result = await searchAlbums(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'search_artists') {
      const result = await searchArtists(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });
}
