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
}

// Same rationale as StarItemResult — id/type/rating are LLM-supplied echoes
// and are dropped. The success+message pair is enough for the LLM to know
// the action took effect.
interface SetRatingResult {
  success: boolean;
  message: string;
}


export async function starItem(client: NavidromeClient, _config: Config, args: unknown): Promise<StarItemResult> {
  const { id, type } = StarItemSchema.parse(args);

  logger.debug('Tool starItem called with args:', { id, type });
  logger.info(`Starring ${type}: ${id}`);

  // Use Subsonic REST API for starring
  const response = await client.subsonicRequest('/star', { id });

  logger.debug('Star response:', response);

  return {
    success: true,
    message: `Successfully starred ${type}`,
  };
}

export async function unstarItem(client: NavidromeClient, _config: Config, args: unknown): Promise<StarItemResult> {
  const { id, type } = StarItemSchema.parse(args);

  logger.debug('Tool unstarItem called with args:', { id, type });
  logger.info(`Unstarring ${type}: ${id}`);

  // Use Subsonic REST API for unstarring
  const response = await client.subsonicRequest('/unstar', { id });

  logger.debug('Unstar response:', response);

  return {
    success: true,
    message: `Successfully unstarred ${type}`,
  };
}

export async function setRating(client: NavidromeClient, _config: Config, args: unknown): Promise<SetRatingResult> {
  const { id, type, rating } = SetRatingSchema.parse(args);

  logger.debug('Tool setRating called with args:', { id, type, rating });
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
  };
}

export async function listStarredItems(client: NavidromeClient, args: unknown): Promise<ListStarredResult> {
  const { type, limit, offset } = StarredItemsPaginationSchema.parse(args);

  logger.debug('Tool listStarredItems called with args:', { type, limit, offset });
  logger.info(`Listing starred ${type}`);

  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';

  // Fetch more items to account for client-side filtering
  const fetchLimit = Math.min(limit * 5, 500); // Fetch 5x requested or max 500

  const response = await client.requestWithLibraryFilter<unknown>(
    `${endpoint}?_start=${offset}&_end=${offset + fetchLimit}&_sort=starredAt&_order=DESC`
  );

  // Return the full DTOs from the shared transformers so starred items carry
  // the same field set (durationFormatted, artistId/albumId, genres, year,
  // albumArtist, rating, …) that every other song/album/artist response
  // produces. We over-fetched (5x) to compensate for the client-side
  // `starred === true` filter, then slice back to `limit` so we honour the
  // caller's pagination request.
  let items: SongDTO[] | AlbumDTO[] | ArtistDTO[];
  if (type === 'songs') {
    items = transformSongsToDTO(response)
      .filter((song) => song.starred === true)
      .slice(0, limit);
  } else if (type === 'albums') {
    items = transformAlbumsToDTO(response)
      .filter((album) => album.starred === true)
      .slice(0, limit);
  } else {
    items = transformArtistsToDTO(response)
      .filter((artist) => artist.starred === true)
      .slice(0, limit);
  }

  return {
    count: items.length,
    items,
  };
}

export async function listTopRated(client: NavidromeClient, args: unknown): Promise<ListTopRatedResult> {
  const { type, minRating, limit, offset } = TopRatedItemsPaginationSchema.parse(args);

  logger.debug('Tool listTopRated called with args:', { type, minRating, limit, offset });
  logger.info(`Listing top rated ${type} (min rating: ${minRating})`);
  
  const endpoint = type === 'songs' ? '/song' : type === 'albums' ? '/album' : '/artist';
  
  // Fetch more items to account for filtering by minRating
  // We'll fetch 3x the requested amount to ensure we have enough after filtering
  const fetchLimit = limit * 3;
  
  const response = await client.requestWithLibraryFilter<unknown>(
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
    count: transformedItems.length,
    items: transformedItems,
  };
}