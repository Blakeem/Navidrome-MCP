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

// Input ids and types are not echoed. The schema normalizes plural to singular,
// so an echo would not match what the LLM sent.
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

// Input echoes are dropped here too, as in StarItemResult.
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

    // The server-side starred=true filter is authoritative. Navidrome keeps
    // starredAt after an unstar, so a starredAt sort alone over-includes.
    const { data: response, total } = await client.requestWithLibraryFilterAndMeta<unknown>(
      `${endpoint}?starred=true&_start=${offset}&_end=${offset + limit}&_sort=starredAt&_order=DESC`
    );

    // Force-keep the starred state even in compact mode. It is the defining
    // attribute of every item this tool returns.
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

    // Force-keep the rating even in compact mode. It is the filter and sort key.
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
