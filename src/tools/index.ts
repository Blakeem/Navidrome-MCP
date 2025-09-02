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
  batchAddTracksToPlaylist,
} from './playlist-management.js';
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from './search.js';
import {
  starItem,
  unstarItem,
  setRating,
  listStarredItems,
  listTopRated,
} from './user-preferences.js';
import {
  getQueue,
  setQueue,
  clearQueue,
} from './queue-management.js';
import {
  listRecentlyPlayed,
  listMostPlayed,
} from './listening-history.js';
import {
  getSimilarArtists,
  getSimilarTracks,
  getArtistInfo,
  getTopTracksByArtist,
  getTrendingMusic,
} from './lastfm-discovery.js';
import { validateRadioStream } from './radio-validation.js';
import {
  listRadioStations,
  createRadioStation,
  deleteRadioStation,
  getRadioStation,
  playRadioStation,
  getCurrentRadioInfo,
  batchCreateRadioStations,
} from './radio.js';
import {
  listTags,
  getTag,
  searchByTags,
  getTagDistribution,
  listUniqueTags,
} from './tags.js';
import {
  discoverRadioStations,
  getRadioFilters,
  getStationByUuid,
  clickStation,
  voteStation,
} from './radio-discovery.js';
import { getLyrics } from './lyrics.js';

export function registerTools(server: Server, client: NavidromeClient, config: Config): void {
  // Check feature configurations
  const hasLastFm = ((): boolean => {
    const apiKey = process.env['LASTFM_API_KEY'];
    const configured = !!(apiKey && apiKey.trim());
    if (!configured && config.debug) {
      console.warn('[DEBUG] Last.fm tools disabled: LASTFM_API_KEY not configured');
    }
    return configured;
  })();

  const hasRadioBrowser = ((): boolean => {
    const userAgent = process.env['RADIO_BROWSER_USER_AGENT'];
    const configured = !!(userAgent && userAgent.trim());
    if (!configured && config.debug) {
      console.warn('[DEBUG] Radio Browser discovery tools disabled: RADIO_BROWSER_USER_AGENT not configured');
    }
    return configured;
  })();

  const hasLyrics = ((): boolean => {
    const provider = process.env['LYRICS_PROVIDER'];
    const userAgent = process.env['LRCLIB_USER_AGENT'];
    const configured = !!(provider && provider.trim() && userAgent && userAgent.trim());
    if (!configured && config.debug) {
      console.warn('[DEBUG] Lyrics tools disabled: LYRICS_PROVIDER and LRCLIB_USER_AGENT must be configured');
    }
    return configured;
  })();

  // Define core tools (always available)
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
            default: 20,
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
    {
      name: 'discover_radio_stations',
      description: 'Find internet radio stations via Radio Browser API. Search by query, tags/genres, country, language, codec, bitrate, and more.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for station names',
          },
          tag: {
            type: 'string',
            description: 'Filter by tag/genre (e.g., "jazz", "rock", "classical")',
          },
          countryCode: {
            type: 'string',
            description: 'ISO country code (e.g., "US", "GB", "FR")',
          },
          language: {
            type: 'string',
            description: 'Language code (e.g., "english", "spanish", "french")',
          },
          codec: {
            type: 'string',
            description: 'Audio codec (e.g., "MP3", "AAC", "OGG")',
          },
          bitrateMin: {
            type: 'number',
            description: 'Minimum bitrate in kbps',
            minimum: 0,
          },
          isHttps: {
            type: 'boolean',
            description: 'Filter for HTTPS streams only',
          },
          order: {
            type: 'string',
            description: 'Sort order',
            enum: ['name', 'votes', 'clickcount', 'bitrate', 'lastcheckok', 'random'],
          },
          reverse: {
            type: 'boolean',
            description: 'Reverse sort order',
          },
          offset: {
            type: 'number',
            description: 'Pagination offset',
            minimum: 0,
          },
          limit: {
            type: 'number',
            description: 'Maximum results (1-500)',
            minimum: 1,
            maximum: 500,
            default: 50,
          },
          hideBroken: {
            type: 'boolean',
            description: 'Hide broken stations',
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
  ];

  // Add conditional tools based on configuration
  if (hasLastFm) {
    tools.push(
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
              default: 20,
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
              default: 20,
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
              default: 20,
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
      }
    );
  }

  if (hasRadioBrowser) {
    tools.push(
      {
        name: 'discover_radio_stations',
        description: 'Find internet radio stations via Radio Browser API. Search by query, tags/genres, country, language, codec, bitrate, and more.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for station names',
            },
            tag: {
              type: 'string',
              description: 'Filter by tag/genre (e.g., "jazz", "rock", "classical")',
            },
            countryCode: {
              type: 'string',
              description: 'ISO country code (e.g., "US", "GB", "FR")',
            },
            language: {
              type: 'string',
              description: 'Language code (e.g., "english", "spanish", "french")',
            },
            codec: {
              type: 'string',
              description: 'Audio codec (e.g., "MP3", "AAC", "OGG")',
            },
            bitrateMin: {
              type: 'number',
              description: 'Minimum bitrate in kbps',
              minimum: 0,
            },
            isHttps: {
              type: 'boolean',
              description: 'Filter for HTTPS streams only',
            },
            order: {
              type: 'string',
              description: 'Sort order',
              enum: ['name', 'votes', 'clickcount', 'bitrate', 'lastcheckok', 'random'],
            },
            reverse: {
              type: 'boolean',
              description: 'Reverse sort order',
            },
            offset: {
              type: 'number',
              description: 'Pagination offset',
              minimum: 0,
            },
            limit: {
              type: 'number',
              description: 'Maximum results (1-500)',
              minimum: 1,
              maximum: 500,
              default: 50,
            },
            hideBroken: {
              type: 'boolean',
              description: 'Hide broken stations',
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
      }
    );
  }

  if (hasLyrics) {
    tools.push({
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
    });
  }

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

    if (name === 'batch_add_tracks_to_playlist') {
      const result = await batchAddTracksToPlaylist(client, args ?? {});
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

    if (name === 'star_item') {
      const result = await starItem(client, config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'unstar_item') {
      const result = await unstarItem(client, config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'set_rating') {
      const result = await setRating(client, config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_starred_items') {
      const result = await listStarredItems(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_top_rated') {
      const result = await listTopRated(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_queue') {
      const result = await getQueue(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'set_queue') {
      const result = await setQueue(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'clear_queue') {
      const result = await clearQueue(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_recently_played') {
      const result = await listRecentlyPlayed(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_most_played') {
      const result = await listMostPlayed(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_similar_artists' && hasLastFm) {
      const result = await getSimilarArtists(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_similar_tracks' && hasLastFm) {
      const result = await getSimilarTracks(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_artist_info' && hasLastFm) {
      const result = await getArtistInfo(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_top_tracks_by_artist' && hasLastFm) {
      const result = await getTopTracksByArtist(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_trending_music' && hasLastFm) {
      const result = await getTrendingMusic(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_radio_stations') {
      const result = await listRadioStations(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'create_radio_station') {
      const result = await createRadioStation(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'delete_radio_station') {
      const result = await deleteRadioStation(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_radio_station') {
      const result = await getRadioStation(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'play_radio_station') {
      const result = await playRadioStation(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_current_radio_info') {
      const result = await getCurrentRadioInfo(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'batch_create_radio_stations') {
      const result = await batchCreateRadioStations(config, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_tags') {
      const result = await listTags(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_tag') {
      const result = await getTag(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'search_by_tags') {
      const result = await searchByTags(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_tag_distribution') {
      const result = await getTagDistribution(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'list_unique_tags') {
      const result = await listUniqueTags(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'validate_radio_stream') {
      const result = await validateRadioStream(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'discover_radio_stations' && hasRadioBrowser) {
      const result = await discoverRadioStations(client, args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_radio_filters' && hasRadioBrowser) {
      const result = await getRadioFilters(args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_station_by_uuid' && hasRadioBrowser) {
      const result = await getStationByUuid(args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'click_station' && hasRadioBrowser) {
      const result = await clickStation(args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'vote_station' && hasRadioBrowser) {
      const result = await voteStation(args ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === 'get_lyrics' && hasLyrics) {
      const result = await getLyrics(args ?? {});
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
