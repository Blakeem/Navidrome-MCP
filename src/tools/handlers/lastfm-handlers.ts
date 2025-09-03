import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';

// Import tool functions
import {
  getSimilarArtists,
  getSimilarTracks,
  getArtistInfo,
  getTopTracksByArtist,
  getTrendingMusic,
} from '../lastfm-discovery.js';

// Tool definitions for LastFM discovery category
const tools: Tool[] = [
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
];

// Factory function for creating LastFM tool category with dependencies  
export function createLastFmToolCategory(_client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
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
  };
}