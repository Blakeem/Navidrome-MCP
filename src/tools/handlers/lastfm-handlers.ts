/**
 * Navidrome MCP Server - Last.fm Tool Handlers
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
  getSimilarArtists,
  getSimilarTracks,
  getArtistInfo,
  getTopTracksByArtist,
  getTrendingMusic,
  getArtistAlbums,
  getAlbumInfo,
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
  {
    name: 'get_artist_albums',
    description:
      "Get an artist's full discography with release types/years (MusicBrainz), genres and popularity " +
      '(Last.fm), and an inLibrary flag for each album (Navidrome). Answers "what full albums by X am I ' +
      'missing?" in one call (use onlyMissing). Defaults to studio albums only; for electronic/synthwave ' +
      'artists where EPs are first-class releases consider includeTypes: ["album","ep"].',
    inputSchema: {
      type: 'object',
      properties: {
        artist: {
          type: 'string',
          description: 'Artist name. Required unless mbid is given.',
        },
        mbid: {
          type: 'string',
          description: 'MusicBrainz artist MBID (UUID); skips artist name resolution.',
        },
        includeTypes: {
          type: 'array',
          items: { type: 'string', enum: ['album', 'ep', 'single'] },
          minItems: 1,
          description: 'MusicBrainz primary release types to include.',
          default: ['album'],
        },
        excludeSecondary: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'live', 'compilation', 'soundtrack', 'remix', 'dj-mix', 'demo',
              'mixtape/street', 'interview', 'audiobook', 'audio drama', 'spokenword', 'field recording',
            ],
          },
          description: 'MusicBrainz secondary types to drop. Pass [] to keep everything (live albums, compilations, remix albums, ...).',
          default: ['live', 'compilation', 'soundtrack', 'remix', 'dj-mix', 'demo'],
        },
        onlyMissing: {
          type: 'boolean',
          description: 'Return only albums NOT in the Navidrome library.',
          default: false,
        },
        includeUnverified: {
          type: 'boolean',
          description: 'Also include long-tail Last.fm-only albums MusicBrainz lacks (typeUnverified: true).',
          default: false,
        },
        verbose: {
          type: 'boolean',
          description: 'Add raw playcount, Last.fm URL, and MusicBrainz disambiguation per album. No extra requests.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'get_album_info',
    description:
      'Deep-dive on ONE album: full tracklist with durations, release year/type, genres, wiki summary, ' +
      "Last.fm popularity, and whether it's in the Navidrome library. The natural follow-up to " +
      "get_artist_albums — pass that result's album mbid (a MusicBrainz release-group ID) or artist+album " +
      'names. Works for albums NOT in the library (the discovery case); for owned albums get_album works too.',
    inputSchema: {
      type: 'object',
      properties: {
        artist: {
          type: 'string',
          description: 'Artist name. Required together with album unless mbid is given.',
        },
        album: {
          type: 'string',
          description: 'Album title. Required together with artist unless mbid is given.',
        },
        mbid: {
          type: 'string',
          description: 'MusicBrainz release-group MBID (UUID) — e.g. the mbid field from get_artist_albums output.',
        },
        verbose: {
          type: 'boolean',
          description: 'Add full wiki text, Last.fm URL, full tag list, and tracklist release provenance. No extra requests.',
          default: false,
        },
      },
      required: [],
    },
  },
];

// Factory function for creating LastFM tool category with dependencies
export function createLastFmToolCategory(client: NavidromeClient, config: Config): ToolCategory {
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
        case 'get_artist_albums':
          return await getArtistAlbums(client, config, args);
        case 'get_album_info':
          return await getAlbumInfo(client, config, args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(`Last.fm ${name}`));
      }
    }
  };
}