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

import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import type { Config } from '../config.js';
import { transformSongsToDTO, transformAlbumsToDTO, transformArtistsToDTO } from '../transformers/index.js';
import {
  StarItemSchema,
  SetRatingSchema,
  StarredItemsPaginationSchema,
  TopRatedItemsPaginationSchema,
} from '../schemas/index.js';

// Helper function to parse duration from MM:SS format to seconds
function parseDuration(durationFormatted: string): number {
  const parts = durationFormatted.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0] ?? '0', 10);
    const seconds = parseInt(parts[1] ?? '0', 10);
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

interface StarItemResult {
  success: boolean;
  message: string;
  id: string;
  type: string;
}

interface StarredItem {
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

interface ListStarredResult {
  type: string;
  count: number;
  items: StarredItem[];
}

interface RatedItem {
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

interface ListTopRatedResult {
  type: string;
  minRating: number;
  count: number;
  items: RatedItem[];
}

interface SetRatingResult {
  success: boolean;
  message: string;
  id: string;
  type: string;
  rating: number;
}


export async function starItem(client: NavidromeClient, _config: Config, args: unknown): Promise<StarItemResult> {
  const { id, type } = StarItemSchema.parse(args);
  
  logger.info(`Starring ${type}: ${id}`);
  
  // Use Subsonic REST API for starring
  const response = await client.subsonicRequest('/star', { id });
  
  logger.debug('Star response:', response);
  
  return {
    success: true,
    message: `Successfully starred ${type}`,
    id,
    type,
  };
}

export async function unstarItem(client: NavidromeClient, _config: Config, args: unknown): Promise<StarItemResult> {
  const { id, type } = StarItemSchema.parse(args);
  
  logger.info(`Unstarring ${type}: ${id}`);
  
  // Use Subsonic REST API for unstarring  
  const response = await client.subsonicRequest('/unstar', { id });
  
  logger.debug('Unstar response:', response);
  
  return {
    success: true,
    message: `Successfully unstarred ${type}`,
    id,
    type,
  };
}

export async function setRating(client: NavidromeClient, _config: Config, args: unknown): Promise<SetRatingResult> {
  const { id, type, rating } = SetRatingSchema.parse(args);
  
  logger.info(`Setting rating ${rating} for ${type}: ${id}`);
  
  // Use Subsonic REST API for setting rating
  const response = await client.subsonicRequest('/setRating', { 
    id, 
    rating: rating.toString() 
  });
  
  logger.debug('Set rating response:', response);
  
  return {
    success: true,
    message: rating > 0 ? `Successfully set rating to ${rating} stars` : 'Successfully removed rating',
    id,
    type,
    rating,
  };
}

export async function listStarredItems(client: NavidromeClient, args: unknown): Promise<ListStarredResult> {
  const { type, limit, offset } = StarredItemsPaginationSchema.parse(args);
  
  logger.info(`Listing starred ${type}`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  
  // Fetch more items to account for client-side filtering
  const fetchLimit = Math.min(limit * 5, 500); // Fetch 5x requested or max 500
  
  const response = await client.request<unknown>(
    `${endpoint}?_start=${offset}&_end=${offset + fetchLimit}&_sort=starredAt&_order=DESC`
  );
  
  // Transform using the appropriate transformer
  let transformedItems: StarredItem[];
  if (type === 'songs') {
    const songs = transformSongsToDTO(response);
    transformedItems = songs
      .filter(song => song.starred === true) // Filter on client side to ensure we only get starred items
      .map(song => {
        const item: StarredItem = { id: song.id };
        if (song.title !== null && song.title !== undefined && song.title !== '') item.title = song.title;
        if (song.artist !== null && song.artist !== undefined && song.artist !== '') item.artist = song.artist;
        if (song.album !== null && song.album !== undefined && song.album !== '') item.album = song.album;
        if (song.durationFormatted !== null && song.durationFormatted !== undefined && song.durationFormatted !== '') {
          item.duration = parseDuration(song.durationFormatted);
        }
        const starredAt = extractStarredAt(song);
        if (starredAt !== null && starredAt !== undefined && starredAt !== '') item.starredAt = starredAt;
        return item;
      });
  } else if (type === 'albums') {
    const albums = transformAlbumsToDTO(response);
    transformedItems = albums
      .filter(album => album.starred === true)
      .map(album => {
        const item: StarredItem = { id: album.id };
        if (album.name !== null && album.name !== undefined && album.name !== '') item.name = album.name;
        if (album.artist !== null && album.artist !== undefined && album.artist !== '') item.artist = album.artist;
        if (album.releaseYear !== null && album.releaseYear !== undefined) item.year = album.releaseYear;
        item.songCount = album.songCount; // Always present in albums
        const starredAt = extractStarredAt(album);
        if (starredAt !== null && starredAt !== undefined && starredAt !== '') item.starredAt = starredAt;
        return item;
      });
  } else {
    const artists = transformArtistsToDTO(response);
    transformedItems = artists
      .filter(artist => artist.starred === true)
      .map(artist => {
        const item: StarredItem = { id: artist.id };
        if (artist.name !== null && artist.name !== undefined && artist.name !== '') item.name = artist.name;
        item.albumCount = artist.albumCount; // Always present
        item.songCount = artist.songCount; // Always present
        const starredAt = extractStarredAt(artist);
        if (starredAt !== null && starredAt !== undefined && starredAt !== '') item.starredAt = starredAt;
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
  const { type, minRating, limit, offset } = TopRatedItemsPaginationSchema.parse(args);
  
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
      .filter(song => (song.rating ?? 0) >= minRating) // Filter on client side
      .map(song => {
        const item: RatedItem = { 
          id: song.id,
          rating: song.rating ?? 0
        };
        if (song.title) item.title = song.title;
        if (song.artist) item.artist = song.artist;
        if (song.album) item.album = song.album;
        if (song.playCount !== null && song.playCount !== undefined && song.playCount > 0) item.playCount = song.playCount;
        return item;
      })
      .slice(0, limit);
  } else if (type === 'albums') {
    const albums = transformAlbumsToDTO(response);
    transformedItems = albums
      .filter(album => (album.rating ?? 0) >= minRating)
      .map(album => {
        const item: RatedItem = { 
          id: album.id,
          rating: album.rating ?? 0
        };
        if (album.name) item.name = album.name;
        if (album.artist) item.artist = album.artist;
        if (album.releaseYear !== null && album.releaseYear !== undefined) item.year = album.releaseYear;
        if (album.playCount !== null && album.playCount !== undefined && album.playCount > 0) item.playCount = album.playCount;
        return item;
      })
      .slice(0, limit);
  } else {
    const artists = transformArtistsToDTO(response);
    transformedItems = artists
      .filter(artist => (artist.rating ?? 0) >= minRating)
      .map(artist => {
        const item: RatedItem = { 
          id: artist.id,
          rating: artist.rating ?? 0
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