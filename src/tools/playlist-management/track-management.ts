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
import { getPlaylistTracks } from './playlist-export.js';

/**
 * Add tracks to a playlist
 */
export async function addTracksToPlaylist(client: NavidromeClient, args: unknown): Promise<AddTracksToPlaylistResponse> {
  const params = AddTracksToPlaylistSchema.parse(args);

  try {
    // Get track count before adding
    const tracksBefore = await getPlaylistTracks(client, {
      playlistId: params.playlistId,
      limit: 500,
      offset: 0
    });
    const countBefore = tracksBefore.tracks.length;

    const requestBody: AddTracksToPlaylistRequest = {};

    if (params.ids !== undefined) {
      requestBody.ids = params.ids;
    }

    if (params.albumIds !== undefined) {
      requestBody.albumIds = params.albumIds;
    }

    if (params.artistIds !== undefined) {
      requestBody.artistIds = params.artistIds;
    }

    if (params.discs !== undefined) {
      requestBody.discs = params.discs;
    }

    const response = await client.request<{ added: number }>(`/playlist/${params.playlistId}/tracks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Get track count after adding
    const tracksAfter = await getPlaylistTracks(client, {
      playlistId: params.playlistId,
      limit: 500,
      offset: 0
    });
    const countAfter = tracksAfter.tracks.length;

    // Use actual count difference as fallback if API response is incorrect
    const apiCount = response.added || 0;
    const actualCount = countAfter - countBefore;
    const addedCount = Math.max(apiCount, actualCount);
    const success = addedCount > 0;

    return {
      added: addedCount,
      message: `Successfully added ${addedCount} track${addedCount !== 1 ? 's' : ''} to playlist`,
      success,
    };
  } catch (error) {
    throw new Error(
      `Failed to add tracks to playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Batch add multiple sets of tracks to a playlist
 */
export async function batchAddTracksToPlaylist(
  client: NavidromeClient,
  args: unknown
): Promise<{ results: AddTracksToPlaylistResponse[]; summary: string }> {
  const params = args as {
    playlistId: string;
    trackSets: Array<{
      ids?: string[];
      albumIds?: string[];
      artistIds?: string[];
      discs?: Array<{ albumId: string; discNumber: number }>;
    }>;
  };

  if (!params.playlistId) {
    throw new Error('Playlist ID is required');
  }

  if (params.trackSets === null || params.trackSets === undefined || !Array.isArray(params.trackSets)) {
    throw new Error('Track sets array is required');
  }

  if (params.trackSets.length === 0) {
    throw new Error('At least one track set must be provided');
  }

  const results: AddTracksToPlaylistResponse[] = [];
  let totalAdded = 0;
  let successCount = 0;
  let failedCount = 0;

  for (const trackSet of params.trackSets) {
    try {
      const result = await addTracksToPlaylist(client, {
        playlistId: params.playlistId,
        ...trackSet
      });

      results.push(result);

      if (result.success) {
        successCount++;
        totalAdded += result.added;
      } else {
        failedCount++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({
        added: 0,
        message: `Failed to add tracks: ${errorMessage}`,
        success: false
      });
      failedCount++;
    }
  }

  let summary = `Successfully processed ${successCount} of ${params.trackSets.length} track sets. `;
  summary += `Total tracks added: ${totalAdded}.`;
  if (failedCount > 0) {
    summary += ` ${failedCount} sets failed.`;
  }

  return {
    results,
    summary
  };
}

/**
 * Remove tracks from a playlist
 */
export async function removeTracksFromPlaylist(client: NavidromeClient, args: unknown): Promise<RemoveTracksFromPlaylistResponse> {
  const params = RemoveTracksFromPlaylistSchema.parse(args);

  try {
    const queryParams = new URLSearchParams();
    params.trackIds.forEach(id => queryParams.append('id', id));

    const response = await client.request<{ ids: string[] }>(`/playlist/${params.playlistId}/tracks?${queryParams.toString()}`, {
      method: 'DELETE',
    });

    const removedIds = response.ids ?? params.trackIds;
    return {
      ids: removedIds,
      message: `Successfully removed ${removedIds.length} track${removedIds.length !== 1 ? 's' : ''} from playlist`,
      success: removedIds.length > 0,
    };
  } catch (error) {
    throw new Error(
      `Failed to remove tracks from playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Reorder a track in the playlist
 */
export async function reorderPlaylistTrack(client: NavidromeClient, args: unknown): Promise<ReorderPlaylistTrackResponse> {
  const params = ReorderPlaylistTrackSchema.parse(args);

  try {
    const requestBody: ReorderPlaylistTrackRequest = {
      insert_before: params.insert_before.toString(),
    };

    const response = await client.request<{ id: number }>(`/playlist/${params.playlistId}/tracks/${params.trackId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    return {
      id: response.id || parseInt(params.trackId, 10),
    };
  } catch (error) {
    throw new Error(
      `Failed to reorder playlist track: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}