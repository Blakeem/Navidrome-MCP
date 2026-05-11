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
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';

/**
 * List all playlists accessible to the user. `offset`/`limit` are NOT echoed
 * — the LLM just sent them and tracks its own pagination state. `total` is
 * server-derived (X-Total-Count) so the LLM can plan further pages.
 */
export async function listPlaylists(client: NavidromeClient, args: unknown): Promise<{
  playlists: PlaylistDTO[];
  total: number;
}> {
  const params = PlaylistPaginationSchema.parse(args);
  logger.debug('Tool listPlaylists called with args:', params);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    const { data, total } = await client.requestWithMeta<unknown>(`/playlist?${queryParams.toString()}`);
    const playlists = transformPlaylistsToDTO(data);

    return {
      playlists,
      total: total ?? playlists.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_playlists', error));
  }
}

/**
 * Get a specific playlist by ID
 */
export async function getPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = PlaylistIdSchema.parse(args);
  logger.debug('Tool getPlaylist called with args:', params);

  try {
    const rawPlaylist = await client.request<unknown>(`/playlist/${encodeURIComponent(params.id)}`);
    return transformToPlaylistDTO(rawPlaylist as RawPlaylist);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_playlist', error));
  }
}

/**
 * Create a new playlist
 */
export async function createPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = CreatePlaylistSchema.parse(args);
  logger.debug('Tool createPlaylist called with args:', params);

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
    throw new Error(ErrorFormatter.toolExecution('create_playlist', error));
  }
}

/**
 * Update a playlist's metadata
 */
export async function updatePlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = UpdatePlaylistSchema.parse(args);
  logger.debug('Tool updatePlaylist called with args:', params);

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

    const rawPlaylist = await client.request<unknown>(`/playlist/${encodeURIComponent(params.id)}`, {
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
    throw new Error(ErrorFormatter.toolExecution('update_playlist', error));
  }
}

/**
 * Delete a playlist (owner or admin only). The deleted id is intentionally
 * NOT echoed in the response — the LLM just sent it. The success flag plus
 * the message ("Successfully deleted playlist") is enough to confirm the
 * round trip; the id is captured in the DEBUG log for diagnostics.
 */
export async function deletePlaylist(client: NavidromeClient, args: unknown): Promise<{ success: boolean; message: string }> {
  const params = PlaylistIdSchema.parse(args);
  logger.debug('Tool deletePlaylist called with args:', params);

  try {
    await client.request<unknown>(`/playlist/${encodeURIComponent(params.id)}`, {
      method: 'DELETE',
    });

    return {
      success: true,
      message: 'Successfully deleted playlist',
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('delete_playlist', error));
  }
}