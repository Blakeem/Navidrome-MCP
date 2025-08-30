/**
 * Navidrome MCP Server - Listening History Tools
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

export interface RecentlyPlayedTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  playCount: number;
  lastPlayed: string;
  duration: number;
}

export interface RecentlyPlayedResult {
  timeRange: string;
  count: number;
  tracks: RecentlyPlayedTrack[];
}

export interface MostPlayedItem {
  id: string;
  title?: string;
  name?: string;
  artist?: string;
  album?: string;
  playCount: number;
  lastPlayed?: string;
  songCount?: number;
  albumCount?: number;
}

export interface MostPlayedResult {
  type: string;
  minPlayCount: number;
  count: number;
  items: MostPlayedItem[];
}

const RecentlyPlayedSchema = z.object({
  limit: z.number().min(1).max(500).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  timeRange: z.enum(['today', 'week', 'month', 'all']).optional().default('all'),
});

export async function listRecentlyPlayed(client: NavidromeClient, args: unknown): Promise<RecentlyPlayedResult> {
  const { limit = 20, offset = 0, timeRange = 'all' } = RecentlyPlayedSchema.parse(args);
  
  logger.info(`Getting recently played songs (${timeRange})`);
  
  const now = new Date();
  let dateFilter = {};
  
  if (timeRange === 'today') {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    dateFilter = { playDate: { gte: startOfDay.toISOString() } };
  } else if (timeRange === 'week') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    dateFilter = { playDate: { gte: weekAgo.toISOString() } };
  } else if (timeRange === 'month') {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    dateFilter = { playDate: { gte: monthAgo.toISOString() } };
  }
  
  const filter = JSON.stringify({
    ...dateFilter,
    playCount: { gt: 0 },
  });
  
  const response = await client.request<RecentlyPlayedTrack[]>(
    `/song?filter=${encodeURIComponent(filter)}&_sort=playDate&_order=DESC&_start=${offset}&_end=${offset + limit}`
  );
  
  const tracks = response.map((track: RecentlyPlayedTrack) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    playCount: track.playCount,
    lastPlayed: track.lastPlayed,
    duration: track.duration,
  }));
  
  return {
    timeRange,
    count: tracks.length,
    tracks,
  };
}

const MostPlayedSchema = z.object({
  type: z.enum(['songs', 'albums', 'artists']).optional().default('songs'),
  limit: z.number().min(1).max(500).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  minPlayCount: z.number().min(1).optional().default(1),
});

export async function listMostPlayed(client: NavidromeClient, args: unknown): Promise<MostPlayedResult> {
  const { type = 'songs', limit = 20, offset = 0, minPlayCount = 1 } = MostPlayedSchema.parse(args);
  
  logger.info(`Getting most played ${type}`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  const filter = JSON.stringify({ playCount: { gte: minPlayCount } });
  
  const response = await client.request<MostPlayedItem[]>(
    `${endpoint}?filter=${encodeURIComponent(filter)}&_sort=playCount&_order=DESC&_start=${offset}&_end=${offset + limit}`
  );
  
  const items = response.map((item: MostPlayedItem) => {
    if (type === 'songs') {
      const result: Record<string, unknown> = {
        id: item.id,
        playCount: item.playCount,
      };
      if (item.title) result['title'] = item.title;
      if (item.artist) result['artist'] = item.artist;
      if (item.album) result['album'] = item.album;
      if (item.lastPlayed) result['lastPlayed'] = item.lastPlayed;
      return result;
    } else if (type === 'albums') {
      const result: Record<string, unknown> = {
        id: item.id,
        playCount: item.playCount,
      };
      if (item.name) result['name'] = item.name;
      if (item.artist) result['artist'] = item.artist;
      if (item.songCount) result['songCount'] = item.songCount;
      if (item.lastPlayed) result['lastPlayed'] = item.lastPlayed;
      return result;
    } else {
      const result: Record<string, unknown> = {
        id: item.id,
        playCount: item.playCount,
      };
      if (item.name) result['name'] = item.name;
      if (item.albumCount) result['albumCount'] = item.albumCount;
      if (item.songCount) result['songCount'] = item.songCount;
      return result;
    }
  });
  
  return {
    type,
    minPlayCount,
    count: items.length,
    items: items as unknown as MostPlayedItem[],
  };
}