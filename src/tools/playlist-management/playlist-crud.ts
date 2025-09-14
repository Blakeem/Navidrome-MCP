/**
 * Navidrome MCP Server - Playlist CRUD Operations
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

import type { NavidromeClient } from '../../client/navidrome-client.js';
import {
  transformPlaylistsToDTO,
  transformToPlaylistDTO,
  type RawPlaylist,
} from '../../transformers/index.js';
import type {
  PlaylistDTO,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
} from '../../types/index.js';
import {
  PlaylistPaginationSchema,
  CreatePlaylistSchema,
  UpdatePlaylistSchema,
  PlaylistIdSchema,
} from '../../schemas/index.js';

/**
 * List all playlists accessible to the user
 */
export async function listPlaylists(client: NavidromeClient, args: unknown): Promise<{
  playlists: PlaylistDTO[];
  total: number;
  offset: number;
  limit: number;
}> {
  const params = PlaylistPaginationSchema.parse(args);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    const rawPlaylists = await client.request<unknown>(`/playlist?${queryParams.toString()}`);
    const playlists = transformPlaylistsToDTO(rawPlaylists);

    return {
      playlists,
      total: playlists.length,
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch playlists: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get a specific playlist by ID
 */
export async function getPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = PlaylistIdSchema.parse(args);

  try {
    const rawPlaylist = await client.request<unknown>(`/playlist/${params.id}`);
    return transformToPlaylistDTO(rawPlaylist as RawPlaylist);
  } catch (error) {
    throw new Error(
      `Failed to fetch playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Create a new playlist
 */
export async function createPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = CreatePlaylistSchema.parse(args);

  try {
    const requestBody: CreatePlaylistRequest = {
      name: params.name,
      public: params.public,
    };

    if (params.comment !== undefined) {
      requestBody.comment = params.comment;
    }

    const rawPlaylist = await client.request<unknown>('/playlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const playlist = transformToPlaylistDTO(rawPlaylist as RawPlaylist);

    // Fix the name if it's not properly returned from API
    if (playlist.name === null || playlist.name === undefined || playlist.name === '' || playlist.name === 'Unknown Playlist') {
      playlist.name = params.name;
    }

    // Fix the comment if it's not properly returned from API
    if (params.comment !== null && params.comment !== undefined && params.comment !== '' && (playlist.comment === null || playlist.comment === undefined || playlist.comment === '')) {
      playlist.comment = params.comment;
    }

    return playlist;
  } catch (error) {
    throw new Error(
      `Failed to create playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Update a playlist's metadata
 */
export async function updatePlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = UpdatePlaylistSchema.parse(args);

  try {
    const requestBody: UpdatePlaylistRequest = {};

    if (params.name !== undefined) {
      requestBody.name = params.name;
    }

    if (params.comment !== undefined) {
      requestBody.comment = params.comment;
    }

    if (params.public !== undefined) {
      requestBody.public = params.public;
    }

    const rawPlaylist = await client.request<unknown>(`/playlist/${params.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const playlist = transformToPlaylistDTO(rawPlaylist as RawPlaylist);

    // Fix the name if it was updated but not properly returned from API
    if (params.name !== null && params.name !== undefined && params.name !== '' && (playlist.name === null || playlist.name === undefined || playlist.name === '' || playlist.name === 'Unknown Playlist')) {
      playlist.name = params.name;
    }

    // Fix the comment if it was updated but not properly returned from API
    if (params.comment !== undefined && (playlist.comment === null || playlist.comment === undefined || playlist.comment === '')) {
      playlist.comment = params.comment;
    }

    return playlist;
  } catch (error) {
    throw new Error(
      `Failed to update playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Delete a playlist (owner or admin only)
 */
export async function deletePlaylist(client: NavidromeClient, args: unknown): Promise<{ success: boolean; id: string; message: string }> {
  const params = PlaylistIdSchema.parse(args);

  try {
    await client.request<unknown>(`/playlist/${params.id}`, {
      method: 'DELETE',
    });

    return {
      success: true,
      id: params.id,
      message: `Successfully deleted playlist with ID: ${params.id}`,
    };
  } catch (error) {
    throw new Error(
      `Failed to delete playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}