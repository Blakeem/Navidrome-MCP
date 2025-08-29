/**
 * Navidrome MCP Server - Library Tools
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

const ListSongsSchema = z.object({
  limit: z.number().min(1).max(500).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  sort: z
    .enum(['title', 'artist', 'album', 'year', 'duration', 'playCount', 'rating'])
    .optional()
    .default('title'),
  order: z.enum(['ASC', 'DESC']).optional().default('ASC'),
  starred: z.boolean().optional(),
});

export interface Song {
  id: string;
  title: string;
  album: string;
  albumId: string;
  artist: string;
  artistId: string;
  albumArtist: string;
  albumArtistId: string;
  trackNumber: number;
  discNumber: number;
  year: number;
  genre: string;
  genres: string[];
  duration: number;
  bitRate: number;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  path: string;
  suffix: string;
  size: number;
  hasCoverArt: boolean;
  compilation: boolean;
  playCount: number;
  playDate?: string;
  rating: number;
  starred: boolean;
  starredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListSongsResult {
  songs: Song[];
  total: number;
  offset: number;
  limit: number;
}

export async function listSongs(client: NavidromeClient, args: unknown): Promise<ListSongsResult> {
  const params = ListSongsSchema.parse(args);

  try {
    // Build query parameters for Navidrome API
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    if (params.starred !== undefined) {
      queryParams.set('starred', params.starred.toString());
    }

    const songs = await client.request<Song[]>(`/song?${queryParams.toString()}`);

    return {
      songs,
      total: songs.length, // Note: Navidrome doesn't return total count in this endpoint
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch songs: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
