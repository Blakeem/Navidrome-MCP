/**
 * Navidrome MCP Server - User Preferences Tools
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
  StarItemSchema,
  SetRatingSchema,
  StarredItemsPaginationSchema,
  TopRatedItemsPaginationSchema,
} from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

// The result omits itemId and type fields. The schema normalizes plural types to singular, so an
// echo would not match what the LLM sent.
interface StarItemResult {
  success: boolean;
  message: string;
}

interface ListStarredResult {
  count: number;
  items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
  total: number;
}

interface ListTopRatedResult {
  count: number;
  items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
  hasMore: boolean;
}

// Omits the input fields for the same reason as StarItemResult.
interface SetRatingResult {
  success: boolean;
  message: string;
}

/**
 * Subsonic /star, /unstar and /setRating take no type and resolve the kind from the ID, so the ID
 * is checked against `type` first. A miss throws NavidromeNotFoundError, which names both.
 */
async function assertItemExists(client: NavidromeClient, type: 'song' | 'album' | 'artist', itemId: string): Promise<void> {
  await client.request<unknown>(`/${type}/${encodeURIComponent(itemId)}`);
}

export async function starItem(client: NavidromeClient, args: unknown): Promise<StarItemResult> {
  try {
    const { itemId, type } = StarItemSchema.parse(args);

    logger.debug('Tool starItem called with args:', { itemId, type });
    logger.info(`Starring ${type}: ${itemId}`);

    await assertItemExists(client, type, itemId);
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

export async function unstarItem(client: NavidromeClient, args: unknown): Promise<StarItemResult> {
  try {
    const { itemId, type } = StarItemSchema.parse(args);

    logger.debug('Tool unstarItem called with args:', { itemId, type });
    logger.info(`Unstarring ${type}: ${itemId}`);

    await assertItemExists(client, type, itemId);
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

export async function setRating(client: NavidromeClient, args: unknown): Promise<SetRatingResult> {
  try {
    const { itemId, type, rating } = SetRatingSchema.parse(args);

    logger.debug('Tool setRating called with args:', { itemId, type, rating });
    logger.info(`Setting rating ${rating} for ${type}: ${itemId}`);

    await assertItemExists(client, type, itemId);
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

    // The server-side starred=true filter is authoritative. Navidrome keeps
    // starredAt after an unstar, so a starredAt sort alone over-includes.
    const { data: response, total } = await client.requestWithLibraryFilterAndMeta<unknown>(
      `${endpoint}?starred=true&_start=${offset}&_end=${offset + limit}&_sort=starredAt&_order=DESC`
    );

    // Compact mode keeps `starred` because it defines every item this tool returns.
    const transformOptions = { verbose, keep: ['starred'] as const };
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
      total: total ?? items.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_starred_items', error));
  }
}

export async function listTopRated(client: NavidromeClient, args: unknown): Promise<ListTopRatedResult> {
  try {
    const { type, minRating, limit, offset, verbose } = TopRatedItemsPaginationSchema.parse(args);

    logger.debug('Tool listTopRated called with args:', { type, minRating, limit, offset, verbose });
    logger.info(`Listing top rated ${type} (min rating: ${minRating})`);

    const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';

    // Navidrome has no >= filter on rating. The sort is on rating, so qualifying
    // rows are a contiguous prefix and the server offset is exact.
    const response = await client.requestWithLibraryFilter<unknown>(
      `${endpoint}?_sort=rating&_order=DESC&_start=${offset}&_end=${offset + limit}`
    );

    // Compact mode keeps `rating` because it is the filter and sort key.
    const transformOptions = { verbose, keep: ['rating'] as const };
    let items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
    if (type === 'songs') {
      items = transformSongsToDTO(response, transformOptions).filter(song => (song.rating ?? 0) >= minRating);
    } else if (type === 'albums') {
      items = transformAlbumsToDTO(response, transformOptions).filter(album => (album.rating ?? 0) >= minRating);
    } else {
      items = transformArtistsToDTO(response, transformOptions).filter(artist => (artist.rating ?? 0) >= minRating);
    }

    return {
      count: items.length,
      items,
      hasMore: items.length === limit,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_top_rated', error));
  }
}
