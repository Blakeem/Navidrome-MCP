/**
 * Navidrome MCP Server - Listening History Tools
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { NavidromeClient } from '../client/navidrome-client.js';
import { logger } from '../utils/logger.js';
import {
  transformSongsToDTO,
  transformAlbumsToDTO,
  transformArtistsToDTO,
} from '../transformers/index.js';
import type { SongDTO, AlbumDTO, ArtistDTO } from '../types/index.js';
import {
  RecentlyPlayedPaginationSchema,
  MostPlayedPaginationSchema,
} from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

interface RecentlyPlayedResult {
  count: number;
  tracks: SongDTO[];
  hasMore: boolean;
}

interface MostPlayedResult {
  count: number;
  items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
  hasMore: boolean;
}

export async function listRecentlyPlayed(client: NavidromeClient, args: unknown): Promise<RecentlyPlayedResult> {
  try {
    const { limit, offset, timeRange, verbose } = RecentlyPlayedPaginationSchema.parse(args);

    logger.debug('Tool listRecentlyPlayed called with args:', { limit, offset, timeRange, verbose });
    logger.info(`Getting recently played songs (${timeRange})`);

    // `today` is the local calendar day, while week and month are rolling windows.
    const now = new Date();
    let cutoff: Date | null = null;
    if (timeRange === 'today') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (timeRange === 'week') {
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'month') {
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Navidrome has no >= filter on playDate. The sort is on playDate, so qualifying
    // rows are a contiguous prefix and the server offset is exact.
    const response = await client.requestWithLibraryFilter<unknown>(
      `/song?_sort=playDate&_order=DESC&_start=${offset}&_end=${offset + limit}`
    );

    // Compact mode keeps playDate because it is the filter and sort key.
    const tracks = transformSongsToDTO(response, { verbose, keep: ['playDate'] })
      .filter((song) => {
        // Never-played songs have no playDate and sort to the end.
        if (song.playDate === undefined || song.playDate === '') return false;
        if (cutoff === null) return true;
        const played = new Date(song.playDate);
        return Number.isFinite(played.getTime()) && played >= cutoff;
      });

    return {
      count: tracks.length,
      tracks,
      hasMore: tracks.length === limit,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_recently_played', error));
  }
}

export async function listMostPlayed(client: NavidromeClient, args: unknown): Promise<MostPlayedResult> {
  try {
    const { type, limit, offset, minPlayCount, verbose } = MostPlayedPaginationSchema.parse(args);

    logger.debug('Tool listMostPlayed called with args:', { type, limit, offset, minPlayCount, verbose });
    logger.info(`Getting most played ${type} with minPlayCount: ${minPlayCount}`);

    const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';

    // Navidrome has no >= filter on playCount. The sort is on playCount, so qualifying
    // rows are a contiguous prefix and the server offset is exact.
    const response = await client.requestWithLibraryFilter<unknown>(
      `${endpoint}?_sort=playCount&_order=DESC&_start=${offset}&_end=${offset + limit}`
    );

    // Compact mode keeps playCount because it is the filter and sort key.
    const transformOptions = { verbose, keep: ['playCount'] as const };
    let items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
    if (type === 'songs') {
      items = transformSongsToDTO(response, transformOptions).filter((song) => (song.playCount ?? 0) >= minPlayCount);
    } else if (type === 'albums') {
      items = transformAlbumsToDTO(response, transformOptions).filter((album) => (album.playCount ?? 0) >= minPlayCount);
    } else {
      items = transformArtistsToDTO(response, transformOptions).filter((artist) => (artist.playCount ?? 0) >= minPlayCount);
    }

    return {
      count: items.length,
      items,
      hasMore: items.length === limit,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_most_played', error));
  }
}
