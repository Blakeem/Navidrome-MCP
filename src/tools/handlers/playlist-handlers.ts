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
    description: 'Get all tracks in a playlist (supports JSON or M3U export). Returns tracks with two IDs: \'id\' (playlist position ID for reordering/removing) and \'mediaFileId\' (actual song ID for playback/metadata operations).',
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