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

import {
  getSimilarArtists,
  getSimilarTracks,
  getArtistInfo,
  getTopTracksByArtist,
  getTrendingMusic,
} from '../lastfm-discovery.js';
import { getArtistAlbums, getAlbumInfo } from '../artist-discography.js';

const LASTFM_CATALOG_NOTE =
  "Results come from Last.fm's global catalog, not the Navidrome library, and carry no Navidrome IDs. " +
  'Resolve names with search_artists or search_songs before playing them or adding them to a playlist.';

const LASTFM_URL_VERBOSE_PROPERTY = {
  type: 'boolean',
  description: 'Add the Last.fm URL to each row. No extra requests.',
  default: false,
};

const tools: Tool[] = [
  {
    name: 'get_similar_artists',
    description: `Get similar artists using Last.fm API. ${LASTFM_CATALOG_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        artist: {
          type: 'string',
          description: 'Name of the artist to find similar artists for',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of similar artists to return (1-100)',
          minimum: 1,
          maximum: 100,
          default: 100,
        },
        verbose: LASTFM_URL_VERBOSE_PROPERTY,
      },
      required: ['artist'],
    },
  },
  {
    name: 'get_similar_tracks',
    description: `Get similar tracks using Last.fm API. ${LASTFM_CATALOG_NOTE}`,
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
          type: 'integer',
          description: 'Maximum number of similar tracks to return (1-100)',
          minimum: 1,
          maximum: 100,
          default: 100,
        },
        verbose: LASTFM_URL_VERBOSE_PROPERTY,
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
          description: 'Language for the biography (ISO 639-1 code). Falls back to English when Last.fm has no biography in that language.',
          default: 'en',
        },
        verbose: {
          type: 'boolean',
          description: 'Add the Last.fm artist URL. No extra requests.',
          default: false,
        },
      },
      required: ['artist'],
    },
  },
  {
    name: 'get_top_tracks_by_artist',
    description: `Get top tracks for an artist from Last.fm. ${LASTFM_CATALOG_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        artist: {
          type: 'string',
          description: 'Name of the artist',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of top tracks to return (1-50)',
          minimum: 1,
          maximum: 50,
          default: 10,
        },
        verbose: LASTFM_URL_VERBOSE_PROPERTY,
      },
      required: ['artist'],
    },
  },
  {
    name: 'get_trending_music',
    description: `Get trending music charts from Last.fm. ${LASTFM_CATALOG_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of chart to get',
          enum: ['artists', 'tracks', 'tags'],
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of items to return (1-100)',
          minimum: 1,
          maximum: 100,
          default: 100,
        },
        page: {
          type: 'integer',
          description: 'Page number for pagination',
          minimum: 1,
          default: 1,
        },
        verbose: LASTFM_URL_VERBOSE_PROPERTY,
      },
      required: ['type'],
    },
  },
  {
    name: 'get_artist_albums',
    description:
      "Get an artist's full discography with release types, years, and genres (MusicBrainz), popularity " +
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
      "get_artist_albums. For a row with source 'musicbrainz', pass its mbid (a MusicBrainz release-group ID). " +
      "For a row with source 'lastfm-only', which carries no mbid, pass artist and album names. " +
      'Works for albums NOT in the library (the discovery case). For owned albums get_album works too.',
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
          description: "MusicBrainz release-group MBID (UUID), e.g. the mbid of a get_artist_albums row with source 'musicbrainz'. Not valid for 'lastfm-only' rows.",
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

export const LASTFM_TOOL_NAMES = tools.map((tool) => tool.name);

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
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}