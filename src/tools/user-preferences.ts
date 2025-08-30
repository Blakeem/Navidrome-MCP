/**
 * Navidrome MCP Server - User Preferences Tools
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
import type { Config } from '../config.js';

export interface StarItemResult {
  success: boolean;
  message: string;
  id: string;
  type: string;
}

export interface StarredItem {
  id: string;
  title?: string;
  name?: string;
  artist?: string;
  album?: string;
  year?: number;
  duration?: number;
  albumCount?: number;
  songCount?: number;
  starredAt?: string;
}

export interface ListStarredResult {
  type: string;
  count: number;
  items: StarredItem[];
}

export interface RatedItem {
  id: string;
  title?: string;
  name?: string;
  artist?: string;
  album?: string;
  year?: number;
  rating: number;
  playCount?: number;
  albumCount?: number;
  songCount?: number;
}

export interface ListTopRatedResult {
  type: string;
  minRating: number;
  count: number;
  items: RatedItem[];
}

export interface SetRatingResult {
  success: boolean;
  message: string;
  id: string;
  type: string;
  rating: number;
}

const StarItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['song', 'album', 'artist']),
});

const SetRatingSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['song', 'album', 'artist']),
  rating: z.number().min(0).max(5),
});

const ListStarredSchema = z.object({
  type: z.enum(['songs', 'albums', 'artists']),
  limit: z.number().min(1).max(500).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

const ListTopRatedSchema = z.object({
  type: z.enum(['songs', 'albums', 'artists']),
  minRating: z.number().min(1).max(5).optional().default(4),
  limit: z.number().min(1).max(500).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

export async function starItem(_client: NavidromeClient, config: Config, args: unknown): Promise<StarItemResult> {
  const { id, type } = StarItemSchema.parse(args);
  
  logger.info(`Starring ${type}: ${id}`);
  
  const params = new URLSearchParams({
    u: config.navidromeUsername,
    p: config.navidromePassword,
    v: '1.16.1',
    c: 'navidrome-mcp',
    f: 'json',
    id,
  });
  
  const response = await fetch(`${config.navidromeUrl}/rest/star?${params}`);
  
  if (!response.ok) {
    throw new Error(`Failed to star ${type}: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as { 'subsonic-response'?: { status?: string; error?: { message?: string } } };
  
  if (data['subsonic-response']?.status !== 'ok') {
    throw new Error(`Failed to star ${type}: ${data['subsonic-response']?.error?.message || 'Unknown error'}`);
  }
  
  return {
    success: true,
    message: `Successfully starred ${type}`,
    id,
    type,
  };
}

export async function unstarItem(_client: NavidromeClient, config: Config, args: unknown): Promise<StarItemResult> {
  const { id, type } = StarItemSchema.parse(args);
  
  logger.info(`Unstarring ${type}: ${id}`);
  
  const params = new URLSearchParams({
    u: config.navidromeUsername,
    p: config.navidromePassword,
    v: '1.16.1',
    c: 'navidrome-mcp',
    f: 'json',
    id,
  });
  
  const response = await fetch(`${config.navidromeUrl}/rest/unstar?${params}`);
  
  if (!response.ok) {
    throw new Error(`Failed to unstar ${type}: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as { 'subsonic-response'?: { status?: string; error?: { message?: string } } };
  
  if (data['subsonic-response']?.status !== 'ok') {
    throw new Error(`Failed to unstar ${type}: ${data['subsonic-response']?.error?.message || 'Unknown error'}`);
  }
  
  return {
    success: true,
    message: `Successfully unstarred ${type}`,
    id,
    type,
  };
}

export async function setRating(_client: NavidromeClient, config: Config, args: unknown): Promise<SetRatingResult> {
  const { id, type, rating } = SetRatingSchema.parse(args);
  
  logger.info(`Setting rating ${rating} for ${type}: ${id}`);
  
  const params = new URLSearchParams({
    u: config.navidromeUsername,
    p: config.navidromePassword,
    v: '1.16.1',
    c: 'navidrome-mcp',
    f: 'json',
    id,
    rating: rating.toString(),
  });
  
  const response = await fetch(`${config.navidromeUrl}/rest/setRating?${params}`);
  
  if (!response.ok) {
    throw new Error(`Failed to set rating for ${type}: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as { 'subsonic-response'?: { status?: string; error?: { message?: string } } };
  
  if (data['subsonic-response']?.status !== 'ok') {
    throw new Error(`Failed to set rating: ${data['subsonic-response']?.error?.message || 'Unknown error'}`);
  }
  
  return {
    success: true,
    message: rating > 0 ? `Successfully set rating to ${rating} stars` : 'Successfully removed rating',
    id,
    type,
    rating,
  };
}

export async function listStarredItems(client: NavidromeClient, args: unknown): Promise<ListStarredResult> {
  const { type, limit = 20, offset = 0 } = ListStarredSchema.parse(args);
  
  logger.info(`Listing starred ${type}`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  const filter = JSON.stringify({ starred: true });
  
  const response = await client.request<StarredItem[]>(
    `${endpoint}?filter=${encodeURIComponent(filter)}&_start=${offset}&_end=${offset + limit}`
  );
  
  const items = response.map((item: StarredItem) => {
    if (type === 'songs') {
      return {
        id: item.id,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration: item.duration,
        starredAt: item.starredAt,
      };
    } else if (type === 'albums') {
      return {
        id: item.id,
        name: item.name,
        artist: item.artist,
        year: item.year,
        songCount: item.songCount,
        starredAt: item.starredAt,
      };
    } else {
      return {
        id: item.id,
        name: item.name,
        albumCount: item.albumCount,
        songCount: item.songCount,
        starredAt: item.starredAt,
      };
    }
  });
  
  return {
    type,
    count: items.length,
    items,
  };
}

export async function listTopRated(client: NavidromeClient, args: unknown): Promise<ListTopRatedResult> {
  const { type, minRating = 4, limit = 20, offset = 0 } = ListTopRatedSchema.parse(args);
  
  logger.info(`Listing top rated ${type} (min rating: ${minRating})`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  const filter = JSON.stringify({ rating: { gte: minRating } });
  
  const response = await client.request<RatedItem[]>(
    `${endpoint}?filter=${encodeURIComponent(filter)}&_sort=rating&_order=DESC&_start=${offset}&_end=${offset + limit}`
  );
  
  const items = response.map((item: RatedItem) => {
    if (type === 'songs') {
      return {
        id: item.id,
        title: item.title,
        artist: item.artist,
        album: item.album,
        rating: item.rating,
        playCount: item.playCount,
      };
    } else if (type === 'albums') {
      return {
        id: item.id,
        name: item.name,
        artist: item.artist,
        year: item.year,
        rating: item.rating,
        playCount: item.playCount,
      };
    } else {
      return {
        id: item.id,
        name: item.name,
        rating: item.rating,
        albumCount: item.albumCount,
        songCount: item.songCount,
      };
    }
  });
  
  return {
    type,
    minRating,
    count: items.length,
    items,
  };
}