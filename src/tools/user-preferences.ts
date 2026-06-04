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
import {
  transformSongsToDTO,
  transformAlbumsToDTO,
  transformArtistsToDTO,
} from '../transformers/index.js';
import type { SongDTO, AlbumDTO, ArtistDTO } from '../types/index.js';
import {
  StarItemSchema,
  SetRatingSchema,
  StarredItemsPaginationSchema,
  TopRatedItemsPaginationSchema,
} from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

// Input echoes (id, type, rating) are intentionally NOT returned. The LLM
// just sent these values; echoing them back wastes context window and can
// even mislead (the schema normalizes plural→singular, so echoing the
// canonical form would mismatch the LLM's input). `success: true` plus a
// human message are the round-trip-safe fields. The original args are
// always available in DEBUG=true logs for diagnostics.
interface StarItemResult {
  success: boolean;
  message: string;
}

interface ListStarredResult {
  count: number;
  items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
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
  count: number;
  items: RatedItem[];
  /**
   * Honest pagination signal for the client-side `minRating` filter.
   *
   * `minRating` is applied in memory over a bounded, capped over-fetch window
   * fetched sorted by `rating DESC` (Navidrome has no `rating >= N` server
   * filter — see {@link listTopRated}). Because the window is sorted by the same
   * field we filter on, seeing any row below `minRating` proves the qualifying
   * set is fully contained in the window. So:
   *
   * - `hasMore: true`  — more qualifying rows exist past this page: either the
   *   (complete) filtered set overflows `offset+limit`, or the over-fetch window
   *   saturated while every fetched row still qualified, so unknown qualifying
   *   rows may lie beyond it. The caller can page further (increase `offset`).
   * - `partial: true`  — the returned page is a lower bound: the window
   *   saturated, every fetched row qualified, and fewer than `limit` rows came
   *   back, so additional qualifying rows might exist beyond the examined window.
   *   Treat the count as a lower bound; deep pagination would need cursor-based
   *   deepening. A complete qualifying set is never `partial`, even when empty.
   *
   * Both default to `false` (a complete page: result fully served, or the rating
   * cutoff was observed inside the window).
   */
  hasMore: boolean;
  partial: boolean;
}

// Same rationale as StarItemResult — id/type/rating are LLM-supplied echoes
// and are dropped. The success+message pair is enough for the LLM to know
// the action took effect.
interface SetRatingResult {
  success: boolean;
  message: string;
}


export async function starItem(client: NavidromeClient, _config: Config, args: unknown): Promise<StarItemResult> {
  try {
    const { itemId, type } = StarItemSchema.parse(args);

    logger.debug('Tool starItem called with args:', { itemId, type });
    logger.info(`Starring ${type}: ${itemId}`);

    // Use Subsonic REST API for starring (wire param key stays `id`)
    const response = await client.subsonicRequest('/star', { id: itemId });

    logger.debug('Star response:', response);

    return {
      success: true,
      message: `Successfully starred ${type}`,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('star_item', error));
  }
}

export async function unstarItem(client: NavidromeClient, _config: Config, args: unknown): Promise<StarItemResult> {
  try {
    const { itemId, type } = StarItemSchema.parse(args);

    logger.debug('Tool unstarItem called with args:', { itemId, type });
    logger.info(`Unstarring ${type}: ${itemId}`);

    // Use Subsonic REST API for unstarring (wire param key stays `id`)
    const response = await client.subsonicRequest('/unstar', { id: itemId });

    logger.debug('Unstar response:', response);

    return {
      success: true,
      message: `Successfully unstarred ${type}`,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('unstar_item', error));
  }
}

export async function setRating(client: NavidromeClient, _config: Config, args: unknown): Promise<SetRatingResult> {
  try {
    const { itemId, type, rating } = SetRatingSchema.parse(args);

    logger.debug('Tool setRating called with args:', { itemId, type, rating });
    logger.info(`Setting rating ${rating} for ${type}: ${itemId}`);

    // Use Subsonic REST API for setting rating (wire param key stays `id`)
    const response = await client.subsonicRequest('/setRating', {
      id: itemId,
      rating: rating.toString()
    });

    logger.debug('Set rating response:', response);

    return {
      success: true,
      message: rating > 0 ? `Successfully set rating to ${rating} stars` : 'Successfully removed rating',
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('set_rating', error));
  }
}

export async function listStarredItems(client: NavidromeClient, args: unknown): Promise<ListStarredResult> {
  try {
    const { type, limit, offset, verbose } = StarredItemsPaginationSchema.parse(args);

    logger.debug('Tool listStarredItems called with args:', { type, limit, offset, verbose });
    logger.info(`Listing starred ${type}`);

    const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';

    // Use Navidrome's server-side `starred=true` filter — it returns only
    // items whose authoritative `starred` boolean is true. Sorting by
    // `starredAt DESC` would over-include items whose star was cleared but
    // still carry a leftover timestamp (Navidrome retains `starredAt` as a
    // "last starred at" history field).
    const response = await client.requestWithLibraryFilter<unknown>(
      `${endpoint}?starred=true&_start=${offset}&_end=${offset + limit}&_sort=starredAt&_order=DESC`
    );

    // Force-keep the starred state even in compact mode — it is the defining
    // attribute of every item this tool returns.
    const transformOptions = { verbose, keep: ['starred', 'starredAt'] };
    let items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
    if (type === 'songs') {
      items = transformSongsToDTO(response, transformOptions);
    } else if (type === 'albums') {
      items = transformAlbumsToDTO(response, transformOptions);
    } else {
      items = transformArtistsToDTO(response, transformOptions);
    }

    return {
      count: items.length,
      items,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_starred_items', error));
  }
}

export async function listTopRated(client: NavidromeClient, args: unknown): Promise<ListTopRatedResult> {
  try {
    const { type, minRating, limit, offset } = TopRatedItemsPaginationSchema.parse(args);

    logger.debug('Tool listTopRated called with args:', { type, minRating, limit, offset });
    logger.info(`Listing top rated ${type} (min rating: ${minRating})`);

    const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';

    // `minRating` is applied client-side AFTER the fetch (Navidrome's REST list
    // endpoint has no `rating >= N` range filter — `rating_gt`/`rating_gte` are
    // silently ignored, only exact `rating=N` works). So we must NOT let the
    // server pre-skip with `_start=offset`: that would permanently drop
    // qualifying high-rated rows in global positions 0..offset-1. Fetch from
    // _start=0, over-fetch to cover offset+limit after filtering, then apply the
    // offset in memory. Cap at 500 (Navidrome's per-page max); deep offsets past
    // the over-fetch window can still truncate and would need cursor-based
    // deepening. NOTE: under-delivery without a has-more signal is a separate
    // open question (see FOLLOWUP) — this fix only makes the offset honest.
    const fetchLimit = Math.min((offset + limit) * 3, 500);

    const response = await client.requestWithLibraryFilter<unknown>(
      `${endpoint}?_sort=rating&_order=DESC&_start=0&_end=${fetchLimit}`
    );

    // Transform + apply the client-side `minRating` filter over the FULL window
    // first (before slicing), so we know how many qualifying rows the window
    // actually held. `rawCount` is the raw row count from the server, used to
    // detect a saturated over-fetch window below.
    // Transform verbosely for internal use: this tool reads rating/playCount/
    // releaseYear off each DTO to build the compact RatedItem below, so it needs
    // those fields present regardless of the (compact) default. The full DTOs are
    // never returned — only the RatedItem projection is.
    let rawCount: number;
    let filtered: RatedItem[];
    if (type === 'songs') {
      const songs = transformSongsToDTO(response, { verbose: true });
      rawCount = songs.length;
      filtered = songs
        .filter(song => (song.rating ?? 0) >= minRating)
        .map(song => {
          const item: RatedItem = {
            id: song.id,
            rating: song.rating ?? 0
          };
          if (song.title) item.title = song.title;
          if (song.artist) item.artist = song.artist;
          if (song.album) item.album = song.album;
          if (song.playCount !== undefined && song.playCount > 0) item.playCount = song.playCount;
          return item;
        });
    } else if (type === 'albums') {
      const albums = transformAlbumsToDTO(response, { verbose: true });
      rawCount = albums.length;
      filtered = albums
        .filter(album => (album.rating ?? 0) >= minRating)
        .map(album => {
          const item: RatedItem = {
            id: album.id,
            rating: album.rating ?? 0
          };
          if (album.name) item.name = album.name;
          if (album.artist) item.artist = album.artist;
          if (album.releaseYear !== undefined) item.year = album.releaseYear;
          if (album.playCount !== undefined && album.playCount > 0) item.playCount = album.playCount;
          return item;
        });
    } else {
      const artists = transformArtistsToDTO(response, { verbose: true });
      rawCount = artists.length;
      filtered = artists
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
        });
    }

    // Apply the requested page in memory (offset already honest because we
    // fetched from _start=0 above).
    const transformedItems = filtered.slice(offset, offset + limit);

    // Honest pagination signals (see ListTopRatedResult docs):
    // - The over-fetch window is "saturated" when the server returned as many
    //   raw rows as we asked for — so rows beyond the window exist but weren't
    //   fetched.
    const windowSaturated = rawCount >= fetchLimit;
    // - KEY INSIGHT: the window is fetched sorted by `rating DESC`, the very
    //   field `minRating` filters on. So if ANY fetched row fell below
    //   `minRating` (filtered.length < rawCount), the rating cutoff lies INSIDE
    //   the window: every unfetched row past it has rating <= the lowest
    //   in-window rating, hence also below `minRating`. The qualifying set is
    //   therefore fully contained in what we fetched — even if the window was
    //   saturated. Only when the window saturated AND every fetched row still
    //   qualified do unknown qualifying rows possibly lie beyond it.
    const sawRatingCutoff = filtered.length < rawCount;
    const qualifyingSetComplete = !windowSaturated || sawRatingCutoff;
    // - When the qualifying set is complete, more rows exist past this page only
    //   if our (complete) filtered set overflows offset+limit. Otherwise we hit
    //   the fetch cap while still in qualifying territory, so more may exist.
    const hasMore = qualifyingSetComplete
      ? filtered.length > offset + limit
      : true;
    // - The page is a lower bound only when the set is incomplete AND we couldn't
    //   fill `limit`. A complete set is never partial (even an empty one).
    const partial = !qualifyingSetComplete && transformedItems.length < limit;

    return {
      count: transformedItems.length,
      items: transformedItems,
      hasMore,
      partial,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_top_rated', error));
  }
}