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

type DiscEntry = NonNullable<AddTracksToPlaylistRequest['discs']>[number];

// One song read per album. An album with more songs than this resolves only the discs among its first rows.
const DISC_LOOKUP_SONG_CAP = 1000;

/**
 * Navidrome matches a disc on album, release date and disc number, so each requested disc expands to one
 * entry per release date its songs carry. A disc with no songs is omitted.
 */
async function resolveDiscReleaseDates(
  client: NavidromeClient,
  discs: ReadonlyArray<{ albumId: string; discNumber: number }>,
): Promise<DiscEntry[]> {
  const resolved: DiscEntry[] = [];
  const albumIds = [...new Set(discs.map((disc) => disc.albumId))];
  for (const albumId of albumIds) {
    const endpoint = `/song?album_id=${encodeURIComponent(albumId)}&_start=0&_end=${DISC_LOOKUP_SONG_CAP}`;
    const songs = await client.request<unknown>(endpoint);
    if (!Array.isArray(songs)) {
      throw new Error(`Unexpected response shape from ${endpoint}: expected array`);
    }
    for (const disc of discs.filter((entry) => entry.albumId === albumId)) {
      const releaseDates = new Set<string>();
      for (const song of songs) {
        if (typeof song !== 'object' || song === null) continue;
        const record = song as Record<string, unknown>;
        if (record['discNumber'] !== disc.discNumber) continue;
        releaseDates.add(typeof record['releaseDate'] === 'string' ? record['releaseDate'] : '');
      }
      for (const releaseDate of releaseDates) {
        resolved.push({ albumId, discNumber: disc.discNumber, releaseDate });
      }
    }
  }
  return resolved;
}

/**
 * Add tracks to a playlist
 */
export async function addTracksToPlaylist(client: NavidromeClient, args: unknown): Promise<AddTracksToPlaylistResponse> {
  try {
    const params = AddTracksToPlaylistSchema.parse(args);
    logger.debug('Tool addTracksToPlaylist called with args:', params);

    const requestBody: AddTracksToPlaylistRequest = {};
    if (params.songIds !== undefined) requestBody.ids = params.songIds;
    if (params.albumIds !== undefined) requestBody.albumIds = params.albumIds;
    if (params.artistIds !== undefined) requestBody.artistIds = params.artistIds;
    if (params.discs !== undefined) {
      const discs = await resolveDiscReleaseDates(client, params.discs);
      if (discs.length > 0) requestBody.discs = discs;
    }

    const response = await client.request<{ added?: number }>(
      `/playlist/${encodeURIComponent(params.playlistId)}/tracks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    );

    // Navidrome does not dedupe, so added=0 means no requested ID matched a track.
    const addedCount = response.added ?? 0;
    return {
      added: addedCount,
      message:
        addedCount > 0
          ? `Added ${addedCount} track${addedCount !== 1 ? 's' : ''} to playlist`
          : 'No tracks added. None of the given song, album, artist or disc IDs matched a track. Artist IDs match album-artist credits only.',
      success: true,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('add_tracks_to_playlist', error));
  }
}


/**
 * Remove tracks from a playlist
 */
export async function removeTracksFromPlaylist(client: NavidromeClient, args: unknown): Promise<RemoveTracksFromPlaylistResponse> {
  try {
    const params = RemoveTracksFromPlaylistSchema.parse(args);
    logger.debug('Tool removeTracksFromPlaylist called with args:', params);

    const queryParams = new URLSearchParams();
    params.positions.forEach(position => queryParams.append('id', position));

    const response = await client.request<{ id?: string; ids?: string[] | null }>(`/playlist/${encodeURIComponent(params.playlistId)}/tracks?${queryParams.toString()}`, {
      method: 'DELETE',
    });

    // Navidrome echoes `{id}` for one id and `{ids}` for several, and answers a miss with 404/500.
    const removedPositions = response.ids ?? (response.id !== undefined ? [response.id] : params.positions);
    return {
      positions: removedPositions,
      message: `Removed ${removedPositions.length} track${removedPositions.length !== 1 ? 's' : ''} from playlist`,
      success: true,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('remove_tracks_from_playlist', error));
  }
}

/**
 * Reorder a track in the playlist. `insertBefore` names the slot the track lands before, while Navidrome
 * moves the row to a final position and does not bounds-check it, so this converts and validates first.
 */
export async function reorderPlaylistTrack(client: NavidromeClient, args: unknown): Promise<ReorderPlaylistTrackResponse> {
  try {
    const params = ReorderPlaylistTrackSchema.parse(args);
    logger.debug('Tool reorderPlaylistTrack called with args:', params);

    const trackPosition = Number.parseInt(params.position, 10);

    const tracksPath = `/playlist/${encodeURIComponent(params.playlistId)}/tracks`;
    const { total } = await client.requestWithMeta<unknown>(`${tracksPath}?_start=0&_end=1`);
    if (total === null) {
      throw new Error('Navidrome did not report the playlist size (no X-Total-Count header), so the move cannot be checked');
    }
    if (trackPosition > total || params.insertBefore > total + 1) {
      throw new Error(
        `Position out of range for a playlist of ${total} tracks. position must be 1 to ${total} and insertBefore must be 1 to ${total + 1}. Re-read get_playlist_tracks for the current positions.`,
      );
    }

    const finalPosition = params.insertBefore > trackPosition ? params.insertBefore - 1 : params.insertBefore;
    if (finalPosition === trackPosition) {
      return {
        previousPosition: trackPosition,
        newPosition: trackPosition,
        message: `Track is already at position ${trackPosition}. Nothing moved.`,
        success: true,
      };
    }

    const requestBody: ReorderPlaylistTrackRequest = {
      insert_before: finalPosition.toString(),
    };
    await client.request<unknown>(`${tracksPath}/${encodeURIComponent(params.position)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    return {
      previousPosition: trackPosition,
      newPosition: finalPosition,
      message: `Moved track from position ${trackPosition} to position ${finalPosition}`,
      success: true,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('reorder_playlist_track', error));
  }
}
