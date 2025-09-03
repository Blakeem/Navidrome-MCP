import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';

// Tool category interfaces
export interface ToolCategory {
  tools: Tool[];
  handleToolCall(name: string, args: unknown): Promise<unknown>;
}

export interface ToolHandler {
  (client: NavidromeClient, config: Config, name: string, args: unknown): Promise<unknown>;
}

// Registry for all tool categories
export class ToolRegistry {
  private categories: Map<string, ToolCategory> = new Map();
  private allTools: Tool[] = [];

  register(categoryName: string, category: ToolCategory): void {
    this.categories.set(categoryName, category);
    this.allTools.push(...category.tools);
  }

  getAllTools(): Tool[] {
    return [...this.allTools];
  }

  async handleToolCall(name: string, args: unknown): Promise<unknown> {
    for (const category of this.categories.values()) {
      const tool = category.tools.find(t => t.name === name);
      if (tool) {
        return category.handleToolCall(name, args);
      }
    }
    throw new Error(`Unknown tool: ${name}`);
  }
}

// Utility function to create consistent tool responses
export function createToolResponse(result: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// Import tool category factory functions
import { createTestToolCategory } from '../test.js';
import { createLibraryToolCategory } from '../library.js';

// Import all existing tool functions to create category wrappers
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
  batchAddTracksToPlaylist,
} from '../playlist-management.js';
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from '../search.js';
import {
  starItem,
  unstarItem,
  setRating,
  listStarredItems,
  listTopRated,
} from '../user-preferences.js';
import {
  getQueue,
  setQueue,
  clearQueue,
} from '../queue-management.js';
import {
  listRecentlyPlayed,
  listMostPlayed,
} from '../listening-history.js';
import {
  listRadioStations,
  createRadioStation,
  deleteRadioStation,
  getRadioStation,
  playRadioStation,
  getCurrentRadioInfo,
  batchCreateRadioStations,
} from '../radio.js';
import { validateRadioStream } from '../radio-validation.js';
import {
  listTags,
  getTag,
  searchByTags,
  getTagDistribution,
  listUniqueTags,
} from '../tags.js';
import {
  getSimilarArtists,
  getSimilarTracks,
  getArtistInfo,
  getTopTracksByArtist,
  getTrendingMusic,
} from '../lastfm-discovery.js';
import {
  discoverRadioStations,
  getRadioFilters,
  getStationByUuid,
  clickStation,
  voteStation,
} from '../radio-discovery.js';
import { getLyrics } from '../lyrics.js';
import { DEFAULT_VALUES } from '../../constants/defaults.js';

// Main registration function
export function registerTools(server: Server, client: NavidromeClient, config: Config): void {
  const registry = new ToolRegistry();

  // Use feature flags from config for conditional tools
  const hasLastFm = config.features.lastfm;
  const hasRadioBrowser = config.features.radioBrowser;
  const hasLyrics = config.features.lyrics;

  // Register refactored tool categories
  registry.register('test', createTestToolCategory(client, config));
  registry.register('library', createLibraryToolCategory(client, config));

  // Create and register playlist management tools
  registry.register('playlist-management', {
    tools: [
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
        name: 'batch_add_tracks_to_playlist',
        description: 'Batch add multiple sets of tracks to a playlist',
        inputSchema: {
          type: 'object',
          properties: {
            playlistId: {
              type: 'string',
              description: 'The unique ID of the playlist',
            },
            trackSets: {
              type: 'array',
              description: 'Array of track sets to add to the playlist',
              items: {
                type: 'object',
                properties: {
                  ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of song IDs to add',
                  },
                  albumIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of album IDs to add (all tracks)',
                  },
                  artistIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of artist IDs to add (all tracks)',
                  },
                  discs: {
                    type: 'array',
                    description: 'Array of specific discs to add',
                    items: {
                      type: 'object',
                      properties: {
                        albumId: { type: 'string' },
                        discNumber: { type: 'number' },
                      },
                      required: ['albumId', 'discNumber'],
                    },
                  },
                },
              },
            },
          },
          required: ['playlistId', 'trackSets'],
        },
      },
    ],
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
        case 'batch_add_tracks_to_playlist':
          return await batchAddTracksToPlaylist(client, args);
        default:
          throw new Error(`Unknown playlist tool: ${name}`);
      }
    }
  });

  // Register all remaining tool categories
  registry.register('search', {
    tools: [
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
              default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
            },
            albumCount: {
              type: 'number',
              description: 'Maximum number of albums to return',
              minimum: 0,
              maximum: 100,
              default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
            },
            songCount: {
              type: 'number',
              description: 'Maximum number of songs to return',
              minimum: 0,
              maximum: 100,
              default: DEFAULT_VALUES.SEARCH_ALL_LIMIT,
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
              default: 100,
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
              default: 100,
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
              default: 100,
            },
          },
          required: ['query'],
        },
      },
    ],
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'search_all':
          return await searchAll(config, args);
        case 'search_songs':
          return await searchSongs(config, args);
        case 'search_albums':
          return await searchAlbums(config, args);
        case 'search_artists':
          return await searchArtists(config, args);
        default:
          throw new Error(`Unknown search tool: ${name}`);
      }
    }
  });

  registry.register('user-preferences', {
    tools: [
      {
        name: 'star_item',
        description: 'Star/favorite a song, album, or artist',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The unique ID of the item to star',
            },
            type: {
              type: 'string',
              description: 'The type of item to star',
              enum: ['song', 'album', 'artist'],
            },
          },
          required: ['id', 'type'],
        },
      },
      {
        name: 'unstar_item',
        description: 'Unstar/unfavorite a song, album, or artist',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The unique ID of the item to unstar',
            },
            type: {
              type: 'string',
              description: 'The type of item to unstar',
              enum: ['song', 'album', 'artist'],
            },
          },
          required: ['id', 'type'],
        },
      },
      {
        name: 'set_rating',
        description: 'Set a rating (0-5 stars) for a song, album, or artist',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The unique ID of the item to rate',
            },
            type: {
              type: 'string',
              description: 'The type of item to rate',
              enum: ['song', 'album', 'artist'],
            },
            rating: {
              type: 'number',
              description: 'Rating from 0-5 stars (0 removes rating)',
              minimum: 0,
              maximum: 5,
            },
          },
          required: ['id', 'type', 'rating'],
        },
      },
      {
        name: 'list_starred_items',
        description: 'List starred/favorited songs, albums, or artists',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Type of starred items to list',
              enum: ['songs', 'albums', 'artists'],
            },
            limit: {
              type: 'number',
              description: 'Maximum number of items to return (1-500)',
              minimum: 1,
              maximum: 500,
              default: 100,
            },
            offset: {
              type: 'number',
              description: 'Number of items to skip for pagination',
              minimum: 0,
              default: 0,
            },
          },
          required: ['type'],
        },
      },
      {
        name: 'list_top_rated',
        description: 'List top-rated songs, albums, or artists',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Type of items to list',
              enum: ['songs', 'albums', 'artists'],
            },
            minRating: {
              type: 'number',
              description: 'Minimum rating to include (1-5)',
              minimum: 1,
              maximum: 5,
              default: 4,
            },
            limit: {
              type: 'number',
              description: 'Maximum number of items to return (1-500)',
              minimum: 1,
              maximum: 500,
              default: 100,
            },
            offset: {
              type: 'number',
              description: 'Number of items to skip for pagination',
              minimum: 0,
              default: 0,
            },
          },
          required: ['type'],
        },
      },
    ],
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'star_item':
          return await starItem(client, config, args);
        case 'unstar_item':
          return await unstarItem(client, config, args);
        case 'set_rating':
          return await setRating(client, config, args);
        case 'list_starred_items':
          return await listStarredItems(client, args);
        case 'list_top_rated':
          return await listTopRated(client, args);
        default:
          throw new Error(`Unknown user preference tool: ${name}`);
      }
    }
  });

  registry.register('queue-management', {
    tools: [
      {
        name: 'get_queue',
        description: 'Get the current playback queue',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'set_queue',
        description: 'Set the playback queue with specified songs',
        inputSchema: {
          type: 'object',
          properties: {
            songIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of song IDs to add to queue',
            },
            current: {
              type: 'number',
              description: 'Index of current track (0-based)',
              minimum: 0,
              default: 0,
            },
            position: {
              type: 'number',
              description: 'Playback position in seconds',
              minimum: 0,
              default: 0,
            },
          },
          required: ['songIds'],
        },
      },
      {
        name: 'clear_queue',
        description: 'Clear the playback queue',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'get_queue':
          return await getQueue(client, args);
        case 'set_queue':
          return await setQueue(client, args);
        case 'clear_queue':
          return await clearQueue(client, args);
        default:
          throw new Error(`Unknown queue tool: ${name}`);
      }
    }
  });

  registry.register('listening-history', {
    tools: [
      {
        name: 'list_recently_played',
        description: 'List recently played tracks with time filtering',
        inputSchema: {
          type: 'object',
          properties: {
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
            timeRange: {
              type: 'string',
              description: 'Time range for recently played tracks',
              enum: ['today', 'week', 'month', 'all'],
              default: 'all',
            },
          },
        },
      },
      {
        name: 'list_most_played',
        description: 'List most played songs, albums, or artists',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Type of items to list',
              enum: ['songs', 'albums', 'artists'],
              default: 'songs',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of items to return (1-500)',
              minimum: 1,
              maximum: 500,
              default: 100,
            },
            offset: {
              type: 'number',
              description: 'Number of items to skip for pagination',
              minimum: 0,
              default: 0,
            },
            minPlayCount: {
              type: 'number',
              description: 'Minimum play count to include',
              minimum: 1,
              default: 1,
            },
          },
        },
      },
    ],
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_recently_played':
          return await listRecentlyPlayed(client, args);
        case 'list_most_played':
          return await listMostPlayed(client, args);
        default:
          throw new Error(`Unknown listening history tool: ${name}`);
      }
    }
  });

  registry.register('radio', {
    tools: [
      {
        name: 'list_radio_stations',
        description: 'List all internet radio stations from Navidrome',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'create_radio_station',
        description: 'Create a new internet radio station in Navidrome',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Station name (required)',
            },
            streamUrl: {
              type: 'string',
              description: 'Stream URL (required) - must be valid HTTP/HTTPS URL',
            },
            homePageUrl: {
              type: 'string',
              description: 'Optional homepage URL for the station',
            },
            validateBeforeAdd: {
              type: 'boolean',
              description: 'Validate stream URL before adding (default: false)',
            },
          },
          required: ['name', 'streamUrl'],
        },
      },
      {
        name: 'delete_radio_station',
        description: 'Delete an internet radio station by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The unique ID of the radio station to delete',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_radio_station',
        description: 'Get detailed information about a specific radio station by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The unique ID of the radio station',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'play_radio_station',
        description: 'Start playing a radio station by setting it in the playback queue',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The unique ID of the radio station to play',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_current_radio_info',
        description: 'Get information about currently playing radio station and stream metadata',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'batch_create_radio_stations',
        description: 'Batch create multiple internet radio stations in Navidrome',
        inputSchema: {
          type: 'object',
          properties: {
            stations: {
              type: 'array',
              description: 'Array of radio stations to create',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Station name (required)',
                  },
                  streamUrl: {
                    type: 'string',
                    description: 'Stream URL (required)',
                  },
                  homePageUrl: {
                    type: 'string',
                    description: 'Optional homepage URL',
                  },
                },
                required: ['name', 'streamUrl'],
              },
            },
            validateBeforeAdd: {
              type: 'boolean',
              description: 'Validate all stream URLs before adding (default: false)',
            },
          },
          required: ['stations'],
        },
      },
    ],
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_radio_stations':
          return await listRadioStations(config, args);
        case 'create_radio_station':
          return await createRadioStation(config, args);
        case 'delete_radio_station':
          return await deleteRadioStation(config, args);
        case 'get_radio_station':
          return await getRadioStation(config, args);
        case 'play_radio_station':
          return await playRadioStation(config, args);
        case 'get_current_radio_info':
          return await getCurrentRadioInfo(config, args);
        case 'batch_create_radio_stations':
          return await batchCreateRadioStations(config, args);
        default:
          throw new Error(`Unknown radio tool: ${name}`);
      }
    }
  });

  registry.register('radio-validation', {
    tools: [
      {
        name: 'validate_radio_stream',
        description: 'Tests if a radio stream URL is valid, accessible, and streams audio content. Checks HTTP response, content type, streaming headers, and attempts to verify audio data.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              description: 'The radio stream URL to validate (required)',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 8000, max: 30000)',
              minimum: 1000,
              maximum: 30000,
              default: 8000,
            },
            followRedirects: {
              type: 'boolean',
              description: 'Follow HTTP redirects (default: true)',
              default: true,
            },
          },
          required: ['url'],
        },
      },
    ],
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'validate_radio_stream':
          return await validateRadioStream(client, args);
        default:
          throw new Error(`Unknown radio validation tool: ${name}`);
      }
    }
  });

  registry.register('tags', {
    tools: [
      {
        name: 'list_tags',
        description: 'List all metadata tags with optional filtering by tag name and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of tags to return (1-500)',
              minimum: 1,
              maximum: 500,
              default: 100,
            },
            offset: {
              type: 'number',
              description: 'Number of tags to skip for pagination',
              minimum: 0,
              default: 0,
            },
            sort: {
              type: 'string',
              description: 'Field to sort by',
              enum: ['tagName', 'tagValue', 'albumCount', 'songCount'],
              default: 'tagName',
            },
            order: {
              type: 'string',
              description: 'Sort order',
              enum: ['ASC', 'DESC'],
              default: 'ASC',
            },
            tagName: {
              type: 'string',
              description: 'Filter by specific tag name (e.g., "genre", "composer", "label")',
            },
          },
        },
      },
      {
        name: 'get_tag',
        description: 'Get detailed information about a specific tag by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The unique ID of the tag',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_by_tags',
        description: 'Search for songs/albums by specific tag criteria (e.g., find all songs with genre "Jazz" or composer "Bach")',
        inputSchema: {
          type: 'object',
          properties: {
            tagName: {
              type: 'string',
              description: 'Tag name to search by (e.g., "genre", "composer", "label")',
            },
            tagValue: {
              type: 'string',
              description: 'Optional tag value to match exactly',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of matching tags to return',
              minimum: 1,
              maximum: 100,
              default: 100,
            },
          },
          required: ['tagName'],
        },
      },
      {
        name: 'get_tag_distribution',
        description: 'Analyze tag usage patterns and distribution across the music library',
        inputSchema: {
          type: 'object',
          properties: {
            tagNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific tag names to analyze (if omitted, analyzes all)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of tag names to analyze',
              minimum: 1,
              maximum: 50,
              default: 10,
            },
            distributionLimit: {
              type: 'number',
              description: 'Maximum number of tag values to show in distribution (prevents huge output)',
              minimum: 1,
              maximum: 100,
              default: 20,
            },
          },
        },
      },
      {
        name: 'list_unique_tags',
        description: 'List all unique tag names with statistics (how many unique values, total usage)',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of tag names to return',
              minimum: 1,
              maximum: 100,
              default: 100,
            },
            minUsage: {
              type: 'number',
              description: 'Minimum song count to include a tag name',
              minimum: 1,
              default: 1,
            },
          },
        },
      },
    ],
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_tags':
          return await listTags(client, args);
        case 'get_tag':
          return await getTag(client, args);
        case 'search_by_tags':
          return await searchByTags(client, args);
        case 'get_tag_distribution':
          return await getTagDistribution(client, args);
        case 'list_unique_tags':
          return await listUniqueTags(client, args);
        default:
          throw new Error(`Unknown tags tool: ${name}`);
      }
    }
  });

  // Add conditional tools based on configuration  
  if (hasLastFm) {
    registry.register('lastfm-discovery', {
      tools: [
        {
          name: 'get_similar_artists',
          description: 'Get similar artists using Last.fm API',
          inputSchema: {
            type: 'object',
            properties: {
              artist: {
                type: 'string',
                description: 'Name of the artist to find similar artists for',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of similar artists to return (1-100)',
                minimum: 1,
                maximum: 100,
                default: 100,
              },
            },
            required: ['artist'],
          },
        },
        {
          name: 'get_similar_tracks',
          description: 'Get similar tracks using Last.fm API',
          inputSchema: {
            type: 'object',
            properties: {
              artist: {
                type: 'string',
                description: 'Name of the track artist',
              },
              track: {
                type: 'string',
                description: 'Name of the track',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of similar tracks to return (1-100)',
                minimum: 1,
                maximum: 100,
                default: 100,
              },
            },
            required: ['artist', 'track'],
          },
        },
        {
          name: 'get_artist_info',
          description: 'Get detailed artist information from Last.fm',
          inputSchema: {
            type: 'object',
            properties: {
              artist: {
                type: 'string',
                description: 'Name of the artist to get information for',
              },
              lang: {
                type: 'string',
                description: 'Language for the biography (ISO 639 code)',
                default: 'en',
              },
            },
            required: ['artist'],
          },
        },
        {
          name: 'get_top_tracks_by_artist',
          description: 'Get top tracks for an artist from Last.fm',
          inputSchema: {
            type: 'object',
            properties: {
              artist: {
                type: 'string',
                description: 'Name of the artist',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of top tracks to return (1-50)',
                minimum: 1,
                maximum: 50,
                default: 10,
              },
            },
            required: ['artist'],
          },
        },
        {
          name: 'get_trending_music',
          description: 'Get trending music charts from Last.fm',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of chart to get',
                enum: ['artists', 'tracks', 'tags'],
              },
              limit: {
                type: 'number',
                description: 'Maximum number of items to return (1-100)',
                minimum: 1,
                maximum: 100,
                default: 100,
              },
              page: {
                type: 'number',
                description: 'Page number for pagination',
                minimum: 1,
                default: 1,
              },
            },
            required: ['type'],
          },
        },
      ],
      async handleToolCall(name: string, args: unknown): Promise<unknown> {
        switch (name) {
          case 'get_similar_artists':
            return await getSimilarArtists(config, args);
          case 'get_similar_tracks':
            return await getSimilarTracks(config, args);
          case 'get_artist_info':
            return await getArtistInfo(config, args);
          case 'get_top_tracks_by_artist':
            return await getTopTracksByArtist(config, args);
          case 'get_trending_music':
            return await getTrendingMusic(config, args);
          default:
            throw new Error(`Unknown Last.fm tool: ${name}`);
        }
      }
    });
  }

  if (hasRadioBrowser) {
    registry.register('radio-discovery', {
      tools: [
        {
          name: 'discover_radio_stations',
          description: 'Discover internet radio stations worldwide via Radio Browser API. Search by genre/tag, country, language, quality, and more. Returns validated streams with metadata, sorted by popularity by default.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query for station names (e.g., "BBC", "Classic FM", "Jazz FM")',
              },
              tag: {
                type: 'string',
                description: 'Filter by music genre/tag (e.g., "jazz", "rock", "classical", "electronic", "hip-hop", "country", "reggae", "latin")',
              },
              countryCode: {
                type: 'string',
                description: 'ISO 2-letter country code (e.g., "US"=United States, "GB"=United Kingdom, "FR"=France, "DE"=Germany, "JP"=Japan, "AU"=Australia)',
              },
              language: {
                type: 'string',
                description: 'Broadcast language (e.g., "english", "spanish", "french", "german", "japanese", "portuguese", "italian")',
              },
              codec: {
                type: 'string',
                description: 'Audio codec preference (e.g., "MP3" for best compatibility, "AAC" for better quality, "OGG" for open standard)',
              },
              bitrateMin: {
                type: 'number',
                description: 'Minimum audio quality in kbps (e.g., 128 for standard quality, 256 for high quality, 320 for maximum quality)',
                minimum: 0,
              },
              isHttps: {
                type: 'boolean',
                description: 'Require secure HTTPS streams (recommended for security)',
              },
              order: {
                type: 'string',
                description: 'Sort results by: "votes"=popularity, "name"=alphabetical, "clickcount"=most played, "bitrate"=quality, "lastcheckok"=reliability, "random"=shuffle',
                enum: ['name', 'votes', 'clickcount', 'bitrate', 'lastcheckok', 'random'],
                default: 'votes',
              },
              reverse: {
                type: 'boolean',
                description: 'Reverse sort order (true=descending/best first, false=ascending)',
                default: true,
              },
              offset: {
                type: 'number',
                description: 'Skip first N results for pagination',
                minimum: 0,
              },
              limit: {
                type: 'number',
                description: 'Maximum number of stations to return (15=quick discovery, 50=extensive search, 500=maximum)',
                minimum: 1,
                maximum: 500,
                default: DEFAULT_VALUES.RADIO_DISCOVERY_LIMIT,
              },
              hideBroken: {
                type: 'boolean',
                description: 'Hide stations that failed recent connectivity checks (recommended: true)',
                default: true,
              },
            },
          },
        },
        {
          name: 'get_radio_filters',
          description: 'Get available filter options for radio station discovery (tags, countries, languages, codecs)',
          inputSchema: {
            type: 'object',
            properties: {
              kinds: {
                type: 'array',
                description: 'Filter types to retrieve',
                items: {
                  type: 'string',
                  enum: ['tags', 'countries', 'languages', 'codecs'],
                },
                default: ['tags', 'countries', 'languages', 'codecs'],
              },
            },
          },
        },
        {
          name: 'get_station_by_uuid',
          description: 'Get detailed information about a specific radio station by its UUID',
          inputSchema: {
            type: 'object',
            properties: {
              stationUuid: {
                type: 'string',
                description: 'The unique UUID of the radio station',
              },
            },
            required: ['stationUuid'],
          },
        },
        {
          name: 'click_station',
          description: 'Register a play click for a radio station (helps with popularity metrics). Call this when starting playback.',
          inputSchema: {
            type: 'object',
            properties: {
              stationUuid: {
                type: 'string',
                description: 'The unique UUID of the radio station',
              },
            },
            required: ['stationUuid'],
          },
        },
        {
          name: 'vote_station',
          description: 'Vote for a radio station to increase its popularity',
          inputSchema: {
            type: 'object',
            properties: {
              stationUuid: {
                type: 'string',
                description: 'The unique UUID of the radio station',
              },
            },
            required: ['stationUuid'],
          },
        },
      ],
      async handleToolCall(name: string, args: unknown): Promise<unknown> {
        switch (name) {
          case 'discover_radio_stations':
            return await discoverRadioStations(config, client, args);
          case 'get_radio_filters':
            return await getRadioFilters(config, args);
          case 'get_station_by_uuid':
            return await getStationByUuid(config, args);
          case 'click_station':
            return await clickStation(config, args);
          case 'vote_station':
            return await voteStation(config, args);
          default:
            throw new Error(`Unknown radio discovery tool: ${name}`);
        }
      }
    });
  }

  if (hasLyrics) {
    registry.register('lyrics', {
      tools: [
        {
          name: 'get_lyrics',
          description: 'Get lyrics for a song (both synced and unsynced). Returns timed lyrics for karaoke-style display when available.',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Song title',
              },
              artist: {
                type: 'string',
                description: 'Artist name',
              },
              album: {
                type: 'string',
                description: 'Album name (improves match accuracy)',
              },
              durationMs: {
                type: 'number',
                description: 'Song duration in milliseconds (improves match accuracy)',
                minimum: 0,
              },
              id: {
                type: 'string',
                description: 'LRCLIB record ID if known',
              },
            },
            required: ['title', 'artist'],
          },
        },
      ],
      async handleToolCall(name: string, args: unknown): Promise<unknown> {
        switch (name) {
          case 'get_lyrics':
            return await getLyrics(config, args);
          default:
            throw new Error(`Unknown lyrics tool: ${name}`);
        }
      }
    });
  }

  // Register MCP handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.getAllTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await registry.handleToolCall(name, args ?? {});
    return createToolResponse(result);
  });
}