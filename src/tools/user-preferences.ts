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
import { transformSongsToDTO, transformAlbumsToDTO, transformArtistsToDTO } from '../transformers/song-transformer.js';

// Helper function to parse duration from MM:SS format to seconds
function parseDuration(durationFormatted: string): number {
  const parts = durationFormatted.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0] || '0', 10);
    const seconds = parseInt(parts[1] || '0', 10);
    return minutes * 60 + seconds;
  }
  return 0;
}

// Helper function to extract starredAt timestamp from raw data
function extractStarredAt(item: unknown): string | undefined {
  // The transformers don't currently include starredAt, so we need to check the raw data
  // This is a limitation that should be addressed in the transformers later
  if (typeof item === 'object' && item !== null && 'starredAt' in item) {
    const starredAt = (item as { starredAt?: unknown }).starredAt;
    return typeof starredAt === 'string' ? starredAt : undefined;
  }
  return undefined;
}

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
  
  // Use starred parameter instead of filter for better compatibility
  const response = await client.request<unknown>(
    `${endpoint}?starred=true&_start=${offset}&_end=${offset + limit}`
  );
  
  // Transform using the appropriate transformer
  let transformedItems: StarredItem[];
  if (type === 'songs') {
    const songs = transformSongsToDTO(response);
    transformedItems = songs
      .filter(song => song.starred) // Filter on client side to ensure we only get starred items
      .map(song => {
        const item: StarredItem = { id: song.id };
        if (song.title) item.title = song.title;
        if (song.artist) item.artist = song.artist;
        if (song.album) item.album = song.album;
        if (song.durationFormatted) {
          item.duration = parseDuration(song.durationFormatted);
        }
        const starredAt = extractStarredAt(song);
        if (starredAt) item.starredAt = starredAt;
        return item;
      });
  } else if (type === 'albums') {
    const albums = transformAlbumsToDTO(response);
    transformedItems = albums
      .filter(album => album.starred)
      .map(album => {
        const item: StarredItem = { id: album.id };
        if (album.name) item.name = album.name;
        if (album.artist) item.artist = album.artist;
        if (album.releaseYear) item.year = album.releaseYear;
        item.songCount = album.songCount; // Always present in albums
        const starredAt = extractStarredAt(album);
        if (starredAt) item.starredAt = starredAt;
        return item;
      });
  } else {
    const artists = transformArtistsToDTO(response);
    transformedItems = artists
      .filter(artist => artist.starred)
      .map(artist => {
        const item: StarredItem = { id: artist.id };
        if (artist.name) item.name = artist.name;
        item.albumCount = artist.albumCount; // Always present
        item.songCount = artist.songCount; // Always present
        const starredAt = extractStarredAt(artist);
        if (starredAt) item.starredAt = starredAt;
        return item;
      });
  }
  
  return {
    type,
    count: transformedItems.length,
    items: transformedItems,
  };
}

export async function listTopRated(client: NavidromeClient, args: unknown): Promise<ListTopRatedResult> {
  const { type, minRating = 4, limit = 20, offset = 0 } = ListTopRatedSchema.parse(args);
  
  logger.info(`Listing top rated ${type} (min rating: ${minRating})`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  
  // Fetch more items to account for filtering by minRating
  // We'll fetch 3x the requested amount to ensure we have enough after filtering
  const fetchLimit = limit * 3;
  
  const response = await client.request<unknown>(
    `${endpoint}?_sort=rating&_order=DESC&_start=${offset}&_end=${offset + fetchLimit}`
  );
  
  // Transform using the appropriate transformer
  let transformedItems: RatedItem[];
  if (type === 'songs') {
    const songs = transformSongsToDTO(response);
    transformedItems = songs
      .filter(song => (song.rating || 0) >= minRating) // Filter on client side
      .map(song => {
        const item: RatedItem = { 
          id: song.id,
          rating: song.rating || 0
        };
        if (song.title) item.title = song.title;
        if (song.artist) item.artist = song.artist;
        if (song.album) item.album = song.album;
        if (song.playCount) item.playCount = song.playCount;
        return item;
      })
      .slice(0, limit);
  } else if (type === 'albums') {
    const albums = transformAlbumsToDTO(response);
    transformedItems = albums
      .filter(album => (album.rating || 0) >= minRating)
      .map(album => {
        const item: RatedItem = { 
          id: album.id,
          rating: album.rating || 0
        };
        if (album.name) item.name = album.name;
        if (album.artist) item.artist = album.artist;
        if (album.releaseYear) item.year = album.releaseYear;
        if (album.playCount) item.playCount = album.playCount;
        return item;
      })
      .slice(0, limit);
  } else {
    const artists = transformArtistsToDTO(response);
    transformedItems = artists
      .filter(artist => (artist.rating || 0) >= minRating)
      .map(artist => {
        const item: RatedItem = { 
          id: artist.id,
          rating: artist.rating || 0
        };
        if (artist.name) item.name = artist.name;
        item.albumCount = artist.albumCount;
        item.songCount = artist.songCount;
        return item;
      })
      .slice(0, limit);
  }
  
  return {
    type,
    minRating,
    count: transformedItems.length,
    items: transformedItems,
  };
}