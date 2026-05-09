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

interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

interface SavedQueueResult {
  current: number;
  position: number;
  trackCount: number;
  tracks: QueueTrack[];
  updatedAt?: string;
  message?: string;
  queue?: null;
}

interface SaveQueueResult {
  success: boolean;
  message: string;
  trackCount: number;
  current: number;
}

interface ClearSavedQueueResult {
  success: boolean;
  message: string;
}

export async function getSavedQueue(client: NavidromeClient, _args: unknown): Promise<SavedQueueResult> {
  logger.info('Getting saved queue from Navidrome server');

  const response = await client.request<{ current?: number; position?: number; items?: QueueTrack[]; updatedAt?: string }>('/queue');

  if (response === null || response === undefined || Object.keys(response).length === 0) {
    return {
      current: 0,
      position: 0,
      trackCount: 0,
      tracks: [],
      message: 'Saved queue is empty',
      queue: null,
    };
  }

  const result: SavedQueueResult = {
    current: response.current ?? 0,
    position: response.position ?? 0,
    trackCount: response.items?.length ?? 0,
    tracks: (response.items ?? []).map((track: QueueTrack) => ({
      id: track.id,
      title: track.title ?? '',
      artist: track.artist ?? '',
      album: track.album ?? '',
      duration: track.duration ?? 0,
    })),
  };
  if (response.updatedAt !== null && response.updatedAt !== undefined && response.updatedAt !== '') {
    result.updatedAt = response.updatedAt;
  }
  return result;
}

export async function saveQueue(client: NavidromeClient, args: unknown): Promise<SaveQueueResult> {
  const { songIds, current = 0, position = 0 } = SaveQueueSchema.parse(args);

  logger.info(`Saving queue with ${songIds.length} tracks to Navidrome server`);

  await client.request('/queue', {
    method: 'POST',
    body: JSON.stringify({
      ids: songIds,
      current,
      position,
    }),
  });

  return {
    success: true,
    message: `Saved queue updated with ${songIds.length} tracks`,
    trackCount: songIds.length,
    current,
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
