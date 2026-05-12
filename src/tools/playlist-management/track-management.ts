/**
 * Navidrome MCP Server - Playlist Track Management Operations
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
import type {
  AddTracksToPlaylistRequest,
  AddTracksToPlaylistResponse,
  RemoveTracksFromPlaylistResponse,
  ReorderPlaylistTrackRequest,
  ReorderPlaylistTrackResponse,
} from '../../types/index.js';
import {
  AddTracksToPlaylistSchema,
  RemoveTracksFromPlaylistSchema,
  ReorderPlaylistTrackSchema,
} from '../../schemas/index.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';

/**
 * Add tracks to a playlist
 */
export async function addTracksToPlaylist(client: NavidromeClient, args: unknown): Promise<AddTracksToPlaylistResponse> {
  const params = AddTracksToPlaylistSchema.parse(args);
  logger.debug('Tool addTracksToPlaylist called with args:', params);

  try {
    const requestBody: AddTracksToPlaylistRequest = {};
    if (params.songIds !== undefined) requestBody.ids = params.songIds;
    if (params.albumIds !== undefined) requestBody.albumIds = params.albumIds;
    if (params.artistIds !== undefined) requestBody.artistIds = params.artistIds;
    if (params.discs !== undefined) requestBody.discs = params.discs;

    const response = await client.request<{ added: number }>(
      `/playlist/${encodeURIComponent(params.playlistId)}/tracks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    );

    const addedCount = response.added ?? 0;
    return {
      added: addedCount,
      message: `Successfully added ${addedCount} track${addedCount !== 1 ? 's' : ''} to playlist`,
      success: addedCount > 0,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('add_tracks_to_playlist', error));
  }
}


/**
 * Remove tracks from a playlist
 */
export async function removeTracksFromPlaylist(client: NavidromeClient, args: unknown): Promise<RemoveTracksFromPlaylistResponse> {
  const params = RemoveTracksFromPlaylistSchema.parse(args);
  logger.debug('Tool removeTracksFromPlaylist called with args:', params);

  try {
    const queryParams = new URLSearchParams();
    params.trackIds.forEach(id => queryParams.append('id', id));

    const response = await client.request<{ ids: string[] }>(`/playlist/${encodeURIComponent(params.playlistId)}/tracks?${queryParams.toString()}`, {
      method: 'DELETE',
    });

    const removedIds = response.ids ?? params.trackIds;
    return {
      ids: removedIds,
      message: `Successfully removed ${removedIds.length} track${removedIds.length !== 1 ? 's' : ''} from playlist`,
      success: removedIds.length > 0,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('remove_tracks_from_playlist', error));
  }
}

/**
 * Reorder a track in the playlist.
 *
 * Navidrome's reorder endpoint uses 1-based position IDs. Calling with
 * `insert_before=0` returns HTTP 500 (Batch 2 #1) — the schema now blocks that
 * at parse time. The API response itself is sparse — just `{"id":"<trackId>"}`
 * (string), so we synthesize a confirmation from the request parameters
 * (Batch 2 #29) instead of issuing another round-trip just to enrich it.
 */
export async function reorderPlaylistTrack(client: NavidromeClient, args: unknown): Promise<ReorderPlaylistTrackResponse> {
  const params = ReorderPlaylistTrackSchema.parse(args);
  logger.debug('Tool reorderPlaylistTrack called with args:', params);

  try {
    const requestBody: ReorderPlaylistTrackRequest = {
      insert_before: params.insert_before.toString(),
    };

    // Navidrome returns `{"id":"4"}` (string) with Content-Type: text/plain.
    // The client transparently sniffs the body so we can read `response.id`
    // directly. The id echoed back is the input trackId, not the new position.
    const response = await client.request<{ id?: number | string }>(`/playlist/${encodeURIComponent(params.playlistId)}/tracks/${encodeURIComponent(params.trackId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const previousPosition = parseInt(params.trackId, 10);
    const newPosition = params.insert_before;
    const echoedId = typeof response.id === 'number'
      ? response.id
      : typeof response.id === 'string'
        ? parseInt(response.id, 10) || previousPosition
        : previousPosition;

    return {
      playlistId: params.playlistId,
      id: echoedId,
      previousPosition,
      newPosition,
      message: `Moved track from position ${previousPosition} to position ${newPosition}`,
      success: true,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('reorder_playlist_track', error));
  }
}