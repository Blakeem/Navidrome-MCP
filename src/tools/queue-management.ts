/**
 * Navidrome MCP Server - Saved Queue Tools (Navidrome cross-device sync)
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

import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import { SaveQueueSchema } from '../schemas/validation.js';
import { formatDuration } from '../transformers/shared-transformers.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';

/** Raw shape returned by Navidrome's `/queue` GET endpoint. */
interface RawQueueTrack {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  /** Seconds; float for sub-second precision on some formats. */
  duration?: number;
}

/** Queue track as exposed to the LLM. Mirrors the convention used by the
 *  rest of the song surface (Batch 1): keep raw `duration` (seconds) AND
 *  add `durationFormatted` (M:SS) so callers don't have to format on their
 *  side and never have to guess units. */
interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  durationFormatted: string;
}

interface SavedQueueResult {
  current: number;
  position: number;
  trackCount: number;
  tracks: QueueTrack[];
  /** ISO 8601 timestamp; null when the queue was never saved or was
   *  cleared (Navidrome returns Go's zero-time sentinel here). */
  updatedAt: string | null;
  message?: string;
  queue?: null;
}

interface SaveQueueResult {
  success: boolean;
  message: string;
  trackCount: number;
}

interface ClearSavedQueueResult {
  success: boolean;
  message: string;
}

export async function getSavedQueue(client: NavidromeClient, _args: unknown): Promise<SavedQueueResult> {
  logger.info('Getting saved queue from Navidrome server');

  const response = await client.request<{ current?: number; position?: number; items?: RawQueueTrack[]; updatedAt?: string } | null | undefined>('/queue');

  if (response === null || response === undefined || Object.keys(response).length === 0) {
    return {
      current: 0,
      position: 0,
      trackCount: 0,
      tracks: [],
      // Cleared/never-saved queues have no meaningful `updatedAt`; expose
      // null rather than the Go zero-time sentinel that Navidrome returns
      // here in the same code path.
      updatedAt: null,
      message: 'Saved queue is empty',
      queue: null,
    };
  }

  return {
    current: response.current ?? 0,
    position: response.position ?? 0,
    trackCount: response.items?.length ?? 0,
    tracks: (response.items ?? []).map((track: RawQueueTrack) => {
      const duration = track.duration ?? 0;
      return {
        id: track.id,
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
        // Keep both representations: raw seconds for math, formatted M:SS
        // for display. Matches every other song-bearing tool response.
        duration,
        durationFormatted: formatDuration(duration),
      };
    }),
    // Map Go's zero-time sentinel ('0001-01-01T00:00:00Z') AND empty strings
    // to null so a freshly-cleared (or never-saved) queue doesn't surface a
    // fake 1-Jan-0001 timestamp OR an empty-string placeholder. Same Go
    // zero-time convention library.ts uses for library createdAt/updatedAt.
    updatedAt: response.updatedAt === '' ? null : nullIfGoZeroTime(response.updatedAt ?? null),
  };
}

export async function saveQueue(client: NavidromeClient, args: unknown): Promise<SaveQueueResult> {
  const { songIds, current = 0, position = 0 } = SaveQueueSchema.parse(args);

  logger.debug('Tool saveQueue called with args:', { songIdCount: songIds.length, current, position });
  logger.info(`Saving queue with ${songIds.length} tracks to Navidrome server`);

  await client.request('/queue', {
    method: 'POST',
    body: JSON.stringify({
      ids: songIds,
      current,
      position,
    }),
  });

  // Note: `current` (LLM-supplied) is not echoed back. trackCount is derived
  // from songIds.length and is genuinely useful confirmation of how many
  // tracks were sent.
  return {
    success: true,
    message: `Saved queue updated with ${songIds.length} tracks`,
    trackCount: songIds.length,
  };
}

export async function clearSavedQueue(client: NavidromeClient, _args: unknown): Promise<ClearSavedQueueResult> {
  logger.info('Clearing saved queue on Navidrome server');

  await client.request('/queue', {
    method: 'DELETE',
  });

  return {
    success: true,
    message: 'Saved queue cleared',
  };
}
