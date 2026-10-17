/**
 * Navidrome MCP Server - Saved Queue Tools (Navidrome cross-device sync)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import { SaveQueueSchema } from '../schemas/index.js';
import { transformSongsToDTO } from '../transformers/index.js';
import type { SongDTO } from '../types/index.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { assertKnownSongIds } from './queue-sources.js';

/** Navidrome's `/queue` GET body. `items` holds full media file rows. */
interface RawSavedQueue {
  current?: number;
  /** Milliseconds within the current track. */
  position?: number;
  items?: unknown;
  updatedAt?: string;
}

interface SavedQueueResult {
  currentIndex: number;
  position: number;
  trackCount: number;
  tracks: SongDTO[];
  updatedAt: string | null;
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
  try {
    logger.info('Getting saved queue from Navidrome server');

    const response = await client.request<RawSavedQueue | null | undefined>('/queue');
    const record: RawSavedQueue = response ?? {};
    const tracks = transformSongsToDTO(record.items);

    return {
      currentIndex: record.current ?? 0,
      position: (record.position ?? 0) / 1000,
      trackCount: tracks.length,
      tracks,
      // A cleared or never-saved queue carries Go's zero time or an empty string as its timestamp.
      updatedAt: record.updatedAt === '' ? null : nullIfGoZeroTime(record.updatedAt ?? null),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_saved_queue', error));
  }
}

export async function saveQueue(client: NavidromeClient, args: unknown): Promise<SaveQueueResult> {
  try {
    const { songIds, currentIndex, position } = SaveQueueSchema.parse(args);
    const positionMs = Math.round(position * 1000);

    logger.debug('Tool saveQueue called with args:', { songIdCount: songIds.length, currentIndex, position });
    logger.info(`Saving queue with ${songIds.length} tracks to Navidrome server`);

    // Navidrome drops an unknown ID, which shifts every later index and moves currentIndex onto
    // another track.
    await assertKnownSongIds(client, songIds, 'The saved queue was not changed.');

    await client.request('/queue', {
      method: 'POST',
      body: JSON.stringify({
        ids: songIds,
        current: currentIndex,
        position: positionMs,
      }),
    });

    return {
      success: true,
      message: `Saved queue updated with ${songIds.length} tracks`,
      trackCount: songIds.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('save_queue', error));
  }
}

export async function clearSavedQueue(client: NavidromeClient, _args: unknown): Promise<ClearSavedQueueResult> {
  try {
    logger.info('Clearing saved queue on Navidrome server');

    await client.request('/queue', {
      method: 'DELETE',
    });

    return {
      success: true,
      message: 'Saved queue cleared',
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('clear_saved_queue', error));
  }
}
