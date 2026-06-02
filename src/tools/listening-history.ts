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

/**
 * Recently-played track shape: the full SongDTO (artist/album IDs, formatted
 * duration, genres, year, rating, starred state, etc.) plus a convenience
 * `lastPlayed` mirror of `playDate` so callers don't have to know that the
 * underlying field is named `playDate`.
 */
type RecentlyPlayedTrack = SongDTO & {
  /** ISO 8601 timestamp of the user's most recent play. Mirror of `playDate`
      for back-compat — present iff the source row carried a playDate. */
  lastPlayed?: string;
};

interface RecentlyPlayedResult {
  count: number;
  tracks: RecentlyPlayedTrack[];
}

interface MostPlayedResult {
  count: number;
  items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
}

export async function listRecentlyPlayed(client: NavidromeClient, args: unknown): Promise<RecentlyPlayedResult> {
  try {
    const { limit = 20, offset = 0, timeRange = 'all', verbose = false } = RecentlyPlayedPaginationSchema.parse(args);

    logger.debug('Tool listRecentlyPlayed called with args:', { limit, offset, timeRange, verbose });
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

    // When filtering by timeRange, the date cutoff is applied client-side AFTER
    // the fetch, so we must NOT let the server pre-skip with `_start=offset` —
    // that would permanently drop rows in global positions 0..offset-1 that may
    // fall within the requested window (page 2 would miss/overlap page 1). Instead
    // fetch from _start=0, over-fetch to cover offset+limit after filtering, then
    // apply the offset in memory. Cap at 500 (Navidrome's per-page max). Caveat:
    // for deep `offset+limit` with a sparse history the cap can still truncate;
    // the DESC sort by playDate makes this rare (recent plays cluster), but deep
    // pagination under a timeRange would need cursor-based deepening.
    // For timeRange='all' (cutoff null) there is no client-side filter, so the
    // server-side offset is correct and we fetch exactly `limit` from `_start=offset`.
    const filtering = cutoff !== null;
    const serverStart = filtering ? 0 : offset;
    const fetchLimit = filtering ? Math.min((offset + limit) * 5, 500) : limit;

    const response = await client.requestWithLibraryFilter<unknown>(
      `/song?_sort=playDate&_order=DESC&_start=${serverStart}&_end=${serverStart + fetchLimit}`
    );

    // Force-keep `playDate` even in compact mode: it is this tool's purpose
    // (and the basis of the timeRange filter + the `lastPlayed` mirror below).
    const songs = transformSongsToDTO(response, { verbose, keep: ['playDate'] });

    const tracks = songs
      .filter((song) => {
        // Drop never-played songs (null/empty playDate sort to the end).
        if (song.playDate === undefined || song.playDate === '') return false;
        if (cutoff === null) return true;
        const played = new Date(song.playDate);
        return Number.isFinite(played.getTime()) && played >= cutoff;
      })
      // When filtering, apply offset AFTER the date cutoff so pagination is
      // honest; when not filtering the server already applied the offset so we
      // slice from 0.
      .slice(filtering ? offset : 0, filtering ? offset + limit : limit)
      .map((song): RecentlyPlayedTrack => {
        // Return the full SongDTO so the LLM gets durationFormatted, artistId,
        // albumId, genres, year, rating, starred state — everything other song
        // responses carry. Mirror playDate → lastPlayed for back-compat.
        const track: RecentlyPlayedTrack = { ...song };
        if (song.playDate !== undefined && song.playDate !== '') {
          track.lastPlayed = song.playDate;
        }
        return track;
      });

    return {
      count: tracks.length,
      tracks,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_recently_played', error));
  }
}

export async function listMostPlayed(client: NavidromeClient, args: unknown): Promise<MostPlayedResult> {
  try {
    const { type = 'songs', limit = 20, offset = 0, minPlayCount = 1, verbose = false } = MostPlayedPaginationSchema.parse(args);

    logger.debug('Tool listMostPlayed called with args:', { type, limit, offset, minPlayCount, verbose });
    logger.info(`Getting most played ${type} with minPlayCount: ${minPlayCount}`);

    const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';

    // `minPlayCount` is applied client-side AFTER the fetch, so we must NOT let
    // the server pre-skip with `_start=offset` — that would permanently drop
    // high-playCount rows in global positions 0..offset-1 whenever the filter
    // prunes earlier rows (page 2 misses/overlaps page 1). Fetch from _start=0,
    // over-fetch to cover offset+limit after filtering, then apply the offset in
    // memory. Cap at 500 (Navidrome's per-page max); deep offsets past the
    // over-fetch window can still truncate and would need cursor-based deepening.
    const fetchLimit = Math.min((offset + limit) * 3, 500);

    const response = await client.requestWithLibraryFilter<unknown>(
      `${endpoint}?_sort=playCount&_order=DESC&_start=0&_end=${fetchLimit}`
    );

    // Use the shared transformers so the response carries the same rich fields
    // (durationFormatted, artistId/albumId, genres, year, rating, starred,
    // …) that every other song/album/artist tool produces. Apply the offset
    // AFTER the minPlayCount filter so pagination is honest.
    // Force-keep `playCount` even in compact mode: it is this tool's purpose
    // and the basis of the minPlayCount filter below.
    const transformOptions = { verbose, keep: ['playCount'] };
    let items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
    if (type === 'songs') {
      items = transformSongsToDTO(response, transformOptions)
        .filter((song) => (song.playCount ?? 0) >= minPlayCount)
        .slice(offset, offset + limit);
    } else if (type === 'albums') {
      items = transformAlbumsToDTO(response, transformOptions)
        .filter((album) => (album.playCount ?? 0) >= minPlayCount)
        .slice(offset, offset + limit);
    } else {
      items = transformArtistsToDTO(response, transformOptions)
        .filter((artist) => (artist.playCount ?? 0) >= minPlayCount)
        .slice(offset, offset + limit);
    }

    return {
      count: items.length,
      items,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_most_played', error));
  }
}
