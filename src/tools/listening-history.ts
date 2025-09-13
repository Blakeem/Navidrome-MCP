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
import { transformSongsToDTO, transformAlbumsToDTO, transformArtistsToDTO } from '../transformers/song-transformer.js';
import { DEFAULT_VALUES } from '../constants/defaults.js';

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

interface RecentlyPlayedTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  playCount: number;
  lastPlayed?: string; // Optional since real play date data may not be available
  duration: number;
}

interface RecentlyPlayedResult {
  timeRange: string;
  count: number;
  tracks: RecentlyPlayedTrack[];
}

interface MostPlayedItem {
  id: string;
  title?: string;
  name?: string;
  artist?: string;
  album?: string;
  playCount: number;
  songCount?: number;
  albumCount?: number;
}

interface MostPlayedResult {
  type: string;
  minPlayCount: number;
  count: number;
  items: MostPlayedItem[];
}

const RecentlyPlayedSchema = z.object({
  limit: z.number().min(1).max(500).optional().default(DEFAULT_VALUES.RECENTLY_PLAYED_LIMIT),
  offset: z.number().min(0).optional().default(0),
  timeRange: z.enum(['today', 'week', 'month', 'all']).optional().default('all'),
});

export async function listRecentlyPlayed(client: NavidromeClient, args: unknown): Promise<RecentlyPlayedResult> {
  const { limit = 20, offset = 0, timeRange = 'all' } = RecentlyPlayedSchema.parse(args);
  
  logger.info(`Getting recently played songs (${timeRange})`);
  
  // For now, we'll get songs sorted by addedDate (when added to library) as a proxy for recently played
  // The API doesn't appear to support playDate filtering reliably
  const response = await client.request<unknown>(
    `/song?_sort=addedDate&_order=DESC&_start=${offset}&_end=${offset + limit}`
  );
  
  // Transform using proper transformer
  const songs = transformSongsToDTO(response);
  
  // Filter songs that have been played at least once, if available
  const playedSongs = songs.filter(song => song.playCount === null || song.playCount === undefined || song.playCount > 0);
  
  const tracks = playedSongs.slice(0, limit).map((song) => {
    const track: RecentlyPlayedTrack = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      playCount: song.playCount ?? 0,
      duration: parseDuration(song.durationFormatted),
      // Note: Real lastPlayed timestamps are not available from the API
      // Only including lastPlayed if we actually have play date data (which we don't currently)
    };
    
    // Only add lastPlayed if we have actual play date data
    // Currently, the API doesn't provide reliable play date information
    // so we omit this field rather than provide misleading data
    
    return track;
  });
  
  return {
    timeRange,
    count: tracks.length,
    tracks,
  };
}

const MostPlayedSchema = z.object({
  type: z.enum(['songs', 'albums', 'artists']).optional().default('songs'),
  limit: z.number().min(1).max(500).optional().default(DEFAULT_VALUES.MOST_PLAYED_LIMIT),
  offset: z.number().min(0).optional().default(0),
  minPlayCount: z.number().min(1).optional().default(1),
});

export async function listMostPlayed(client: NavidromeClient, args: unknown): Promise<MostPlayedResult> {
  const { type = 'songs', limit = 20, offset = 0, minPlayCount = 1 } = MostPlayedSchema.parse(args);
  
  logger.info(`Getting most played ${type} with minPlayCount: ${minPlayCount}`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  
  // Fetch more items to account for filtering by minPlayCount
  // We'll fetch 3x the requested amount to ensure we have enough after filtering
  const fetchLimit = limit * 3;
  
  const response = await client.request<unknown>(
    `${endpoint}?_sort=playCount&_order=DESC&_start=${offset}&_end=${offset + fetchLimit}`
  );
  
  // Transform using the appropriate transformer
  let transformedItems: (MostPlayedItem & { playCount?: number })[];
  if (type === 'songs') {
    const songs = transformSongsToDTO(response);
    transformedItems = songs.map(song => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      playCount: song.playCount ?? 0
    }));
  } else if (type === 'albums') {
    const albums = transformAlbumsToDTO(response);
    transformedItems = albums.map(album => ({
      id: album.id,
      name: album.name,
      artist: album.artist,
      songCount: album.songCount,
      playCount: album.playCount ?? 0
    }));
  } else {
    const artists = transformArtistsToDTO(response);
    transformedItems = artists.map(artist => ({
      id: artist.id,
      name: artist.name,
      albumCount: artist.albumCount,
      songCount: artist.songCount,
      playCount: artist.playCount ?? 0
    }));
  }
  
  // Filter by minPlayCount and limit results
  const filteredItems = transformedItems
    .filter(item => (item.playCount || 0) >= minPlayCount)
    .slice(0, limit);
  
  return {
    type,
    minPlayCount,
    count: filteredItems.length,
    items: filteredItems as MostPlayedItem[],
  };
}