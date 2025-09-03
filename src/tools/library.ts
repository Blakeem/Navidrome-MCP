/**
 * Navidrome MCP Server - Library Tools
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

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { transformSongsToDTO } from '../transformers/song-transformer.js';
import type { SongDTO } from '../types/index.js';
import { DEFAULT_VALUES } from '../constants/defaults.js';
import type { ToolCategory } from './handlers/registry.js';
import {
  listAlbums,
  listArtists,
  listGenres,
  getSong,
  getAlbum,
  getArtist,
  getSongPlaylists,
} from './media-library.js';

const ListSongsSchema = z.object({
  limit: z.number().min(1).max(500).optional().default(DEFAULT_VALUES.SONGS_LIMIT),
  offset: z.number().min(0).optional().default(0),
  sort: z
    .enum(['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating'])
    .optional()
    .default('title'),
  order: z.enum(['ASC', 'DESC']).optional().default('ASC'),
  starred: z.boolean().optional(),
});

// Using the clean DTO for song data
export type Song = SongDTO;

export interface ListSongsResult {
  songs: SongDTO[];
  total: number;
  offset: number;
  limit: number;
}

export async function listSongs(client: NavidromeClient, args: unknown): Promise<ListSongsResult> {
  const params = ListSongsSchema.parse(args);

  try {
    // Build query parameters for Navidrome API
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    if (params.starred !== undefined) {
      queryParams.set('starred', params.starred.toString());
    }

    const rawSongs = await client.request<unknown>(`/song?${queryParams.toString()}`);
    const songs = transformSongsToDTO(rawSongs);

    return {
      songs,
      total: songs.length, // Note: Navidrome doesn't return total count in this endpoint
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch songs: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Tool definitions for library category
const tools: Tool[] = [
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
          default: DEFAULT_VALUES.SONGS_LIMIT,
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
          default: DEFAULT_VALUES.ALBUMS_LIMIT,
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
          default: 100,
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
          default: 100,
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
];

// Factory function for creating library tool category with dependencies  
export function createLibraryToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_songs':
          return await listSongs(client, args);
        case 'list_albums':
          return await listAlbums(client, args);
        case 'list_artists':
          return await listArtists(client, args);
        case 'list_genres':
          return await listGenres(client, config, args);
        case 'get_song':
          return await getSong(client, args);
        case 'get_album':
          return await getAlbum(client, args);
        case 'get_artist':
          return await getArtist(client, args);
        case 'get_song_playlists':
          return await getSongPlaylists(client, args);
        default:
          throw new Error(`Unknown library tool: ${name}`);
      }
    }
  };
}
