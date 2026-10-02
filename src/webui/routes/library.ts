/**
 * Navidrome MCP Server - Web UI Library Browse Routes
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

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import { IdSchema, LibraryPlayRequestSchema, LibrarySearchQuerySchema } from '../../schemas/index.js';
import { EmptyLibrarySourceError, playLibrarySource } from '../../tools/playback.js';
import { searchAll } from '../../tools/search/index.js';
import {
  transformAlbumsToDTO,
  transformArtistsToDTO,
  transformSongsToDTO,
} from '../../transformers/index.js';
import { readJsonBody, runAction, writeError, writeJson } from '../http-helpers.js';

const LIBRARY_RECENT_LIMIT = 5;
const LIBRARY_SEARCH_LIMIT = 10;
// Display cap for one artist's albums or one album's tracks, not a pagination contract.
const LIBRARY_LIST_CAP = 500;

/**
 * Never-played rows sort after the played ones under `_sort=playDate`, so a
 * short recent list would otherwise be padded with them.
 */
function keepPlayedRows(rows: unknown): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row: unknown) => {
    if (typeof row !== 'object' || row === null) return false;
    const playDate = (row as { playDate?: unknown }).playDate;
    return typeof playDate === 'string' && playDate !== '';
  });
}

function parseId(rawId: string | null): string | null {
  const parsed = IdSchema.safeParse({ id: rawId });
  return parsed.success ? parsed.data.id : null;
}

export function handleLibraryRecent(res: ServerResponse, client: NavidromeClient): Promise<void> {
  const recentWindow = `_sort=playDate&_order=DESC&_start=0&_end=${LIBRARY_RECENT_LIMIT}`;
  return runAction(res, async () => {
    const [rawArtists, rawAlbums, rawSongs] = await Promise.all([
      client.requestWithLibraryFilter<unknown>(`/artist?${recentWindow}&role=maincredit`),
      client.requestWithLibraryFilter<unknown>(`/album?${recentWindow}`),
      client.requestWithLibraryFilter<unknown>(`/song?${recentWindow}`),
    ]);
    return {
      artists: transformArtistsToDTO(keepPlayedRows(rawArtists)),
      albums: transformAlbumsToDTO(keepPlayedRows(rawAlbums)),
      songs: transformSongsToDTO(keepPlayedRows(rawSongs)),
    };
  });
}

// One-row reads, since only X-Total-Count is used. A missing header counts as zero.
export function handleLibraryFavorites(res: ServerResponse, client: NavidromeClient): Promise<void> {
  const countWindow = 'starred=true&_start=0&_end=1';
  return runAction(res, async () => {
    const [albums, songs] = await Promise.all([
      client.requestWithLibraryFilterAndMeta<unknown>(`/album?${countWindow}`),
      client.requestWithLibraryFilterAndMeta<unknown>(`/song?${countWindow}`),
    ]);
    return { albumCount: albums.total ?? 0, songCount: songs.total ?? 0 };
  });
}

// Sorting by play count ranks the matches the user plays most first.
export async function handleLibrarySearch(
  res: ServerResponse,
  client: NavidromeClient,
  config: Config,
  rawQuery: string | null,
): Promise<void> {
  const parsedQuery = LibrarySearchQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    writeError(res, 400, 'Invalid query');
    return;
  }
  const query = parsedQuery.data;

  return runAction(res, async () => {
    const result = await searchAll(client, config, {
      query,
      artistCount: LIBRARY_SEARCH_LIMIT,
      albumCount: LIBRARY_SEARCH_LIMIT,
      songCount: LIBRARY_SEARCH_LIMIT,
      sort: 'playCount',
      order: 'DESC',
    });
    return { artists: result.artists, albums: result.albums, songs: result.songs };
  });
}

// `artist_id` also matches albums the artist only features on, which the browse view lists.
export async function handleArtistAlbums(
  res: ServerResponse,
  client: NavidromeClient,
  rawId: string | null,
): Promise<void> {
  const id = parseId(rawId);
  if (id === null) {
    writeError(res, 400, 'Invalid id');
    return;
  }

  return runAction(res, async () => {
    const rawAlbums = await client.requestWithLibraryFilter<unknown>(
      `/album?artist_id=${encodeURIComponent(id)}&_sort=maxYear&_order=ASC&_start=0&_end=${LIBRARY_LIST_CAP}`,
    );
    return { albums: transformAlbumsToDTO(rawAlbums, { keep: ['releaseYear'] }) };
  });
}

// `_sort=album` yields disc and track order, matching the album playback path.
export async function handleAlbumSongs(
  res: ServerResponse,
  client: NavidromeClient,
  rawId: string | null,
): Promise<void> {
  const id = parseId(rawId);
  if (id === null) {
    writeError(res, 400, 'Invalid id');
    return;
  }

  return runAction(res, async () => {
    const rawSongs = await client.requestWithLibraryFilter<unknown>(
      `/song?album_id=${encodeURIComponent(id)}&_sort=album&_order=ASC&_start=0&_end=${LIBRARY_LIST_CAP}`,
    );
    return { songs: transformSongsToDTO(rawSongs) };
  });
}

// Invalid input returns 400 here because runAction maps every thrown error, the impls' own ZodErrors included, to 500.
export async function handleLibraryPlay(
  req: IncomingMessage,
  res: ServerResponse,
  client: NavidromeClient,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    writeError(res, 400, err instanceof Error ? err.message : 'invalid JSON body');
    return;
  }

  const validation = LibraryPlayRequestSchema.safeParse(body);
  if (!validation.success) {
    const message = validation.error.issues.map((issue) => issue.message).join('; ');
    writeError(res, 400, message !== '' ? message : 'invalid request body');
    return;
  }

  // An empty source is 409 with a code, so the remote branches on the code instead of the message text.
  try {
    const result = await playLibrarySource(client, validation.data);
    writeJson(res, 200, result);
  } catch (err) {
    if (err instanceof EmptyLibrarySourceError) {
      writeJson(res, 409, { error: err.message, code: 'empty-source' });
      return;
    }
    writeError(res, 500, err instanceof Error ? err.message : 'unknown error');
  }
}
