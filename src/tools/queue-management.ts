/**
 * Navidrome MCP Server - Queue Management Tools
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
import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';

export interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export interface QueueResult {
  current: number;
  position: number;
  trackCount: number;
  tracks: QueueTrack[];
  updatedAt?: string;
  message?: string;
  queue?: null;
}

export interface SetQueueResult {
  success: boolean;
  message: string;
  trackCount: number;
  current: number;
}

export interface ClearQueueResult {
  success: boolean;
  message: string;
}

export async function getQueue(client: NavidromeClient, _args: unknown): Promise<QueueResult> {
  logger.info('Getting playback queue');
  
  const response = await client.request<{ current?: number; position?: number; items?: QueueTrack[]; updatedAt?: string }>('/queue');
  
  if (!response || Object.keys(response).length === 0) {
    return {
      current: 0,
      position: 0,
      trackCount: 0,
      tracks: [],
      message: 'Queue is empty',
      queue: null,
    };
  }
  
  const result: QueueResult = {
    current: response.current || 0,
    position: response.position || 0,
    trackCount: response.items?.length || 0,
    tracks: (response.items || []).map((track: QueueTrack) => ({
      id: track.id,
      title: track.title || 'Unknown',
      artist: track.artist || 'Unknown',
      album: track.album || 'Unknown',
      duration: track.duration || 0,
    })),
  };
  if (response.updatedAt) {
    result.updatedAt = response.updatedAt;
  }
  return result;
}

const SetQueueSchema = z.object({
  songIds: z.array(z.string()),
  current: z.number().min(0).optional().default(0),
  position: z.number().min(0).optional().default(0),
});

export async function setQueue(client: NavidromeClient, args: unknown): Promise<SetQueueResult> {
  const { songIds, current = 0, position = 0 } = SetQueueSchema.parse(args);
  
  logger.info(`Setting queue with ${songIds.length} tracks`);
  
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
    message: `Queue set with ${songIds.length} tracks`,
    trackCount: songIds.length,
    current,
  };
}

export async function clearQueue(client: NavidromeClient, _args: unknown): Promise<ClearQueueResult> {
  logger.info('Clearing playback queue');
  
  await client.request('/queue', {
    method: 'DELETE',
  });
  
  return {
    success: true,
    message: 'Queue cleared',
  };
}