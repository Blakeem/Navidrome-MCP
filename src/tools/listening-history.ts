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

import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import {
  parseDuration,
  transformSongsToDTO,
  transformAlbumsToDTO,
  transformArtistsToDTO,
} from '../transformers/index.js';
import {
  RecentlyPlayedPaginationSchema,
  MostPlayedPaginationSchema,
} from '../schemas/index.js';

interface RecentlyPlayedTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  playCount: number;
  /** ISO 8601 timestamp of the user's most recent play. Omitted only if the
      raw row had no playDate. */
  lastPlayed?: string;
  duration: number;
}

interface RecentlyPlayedResult {
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
  count: number;
  items: MostPlayedItem[];
}

export async function listRecentlyPlayed(client: NavidromeClient, args: unknown): Promise<RecentlyPlayedResult> {
  const { limit = 20, offset = 0, timeRange = 'all' } = RecentlyPlayedPaginationSchema.parse(args);

  logger.debug('Tool listRecentlyPlayed called with args:', { limit, offset, timeRange });
  logger.info(`Getting recently played songs (${timeRange})`);

  // Compute the cutoff timestamp for client-side filtering. Navidrome's REST
  // API has no playDate-range filter, so we sort playDate DESC server-side
  // and apply the cutoff after transforming. `today` rounds down to local
  // midnight so the user's morning sessions are included; week and month
  // are 7 / 30 days back from now.
  const now = new Date();
  let cutoff: Date | null = null;
  if (timeRange === 'today') {
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (timeRange === 'week') {
    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (timeRange === 'month') {
    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  // When filtering by timeRange, over-fetch so the post-filter slice still
  // has a meaningful page. Cap at 500 (Navidrome's per-page max). Caveat:
  // for `limit > 100` with a tight timeRange and a sparse listening history,
  // we may under-deliver because the cap kicks in before 5x. The DESC sort
  // by playDate makes this rare in practice (recent plays cluster), but if
  // it bites we'd need cursor-based deepening rather than a single fetch.
  const fetchLimit = cutoff !== null ? Math.min(limit * 5, 500) : limit;

  const response = await client.requestWithLibraryFilter<unknown>(
    `/song?_sort=playDate&_order=DESC&_start=${offset}&_end=${offset + fetchLimit}`
  );

  const songs = transformSongsToDTO(response);

  const tracks = songs
    .filter((song) => {
      // Drop never-played songs (null/empty playDate sort to the end).
      if (song.playDate === undefined || song.playDate === '') return false;
      if (cutoff === null) return true;
      const played = new Date(song.playDate);
      return Number.isFinite(played.getTime()) && played >= cutoff;
    })
    .slice(0, limit)
    .map((song) => {
      const track: RecentlyPlayedTrack = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        playCount: song.playCount ?? 0,
        duration: parseDuration(song.durationFormatted),
      };
      if (song.playDate !== undefined && song.playDate !== '') {
        track.lastPlayed = song.playDate;
      }
      return track;
    });

  return {
    count: tracks.length,
    tracks,
  };
}

export async function listMostPlayed(client: NavidromeClient, args: unknown): Promise<MostPlayedResult> {
  const { type = 'songs', limit = 20, offset = 0, minPlayCount = 1 } = MostPlayedPaginationSchema.parse(args);

  logger.debug('Tool listMostPlayed called with args:', { type, limit, offset, minPlayCount });
  logger.info(`Getting most played ${type} with minPlayCount: ${minPlayCount}`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  
  // Fetch more items to account for filtering by minPlayCount
  // We'll fetch 3x the requested amount to ensure we have enough after filtering
  const fetchLimit = limit * 3;
  
  const response = await client.requestWithLibraryFilter<unknown>(
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
    count: filteredItems.length,
    items: filteredItems as MostPlayedItem[],
  };
}