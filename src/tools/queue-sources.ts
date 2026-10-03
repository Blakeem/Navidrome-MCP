/**
 * Navidrome MCP Server - Play Queue Sources
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

import type { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { LibraryPlayRequestSchema } from '../schemas/index.js';
import type { QueueTrackMetadata } from '../services/playback/playback-engine.js';
import { logger } from '../utils/logger.js';
import { QUEUE_READ_PAGE_SIZE, MAX_QUEUE_READ_PAGES } from '../constants/defaults.js';

export type LibraryPlayRequest = z.infer<typeof LibraryPlayRequestSchema>;

// Album position lets album-set reads restore input order and lets orderQueueSongs group and sort albums.
interface QueueSongRow extends QueueTrackMetadata {
  albumId?: string;
  discNumber?: number;
  trackNumber?: number;
}

// Bounds the URL length of each read that repeats an id key once per id.
const ID_CHUNK_SIZE = 100;

function toQueueSongRow(songId: string, record: Record<string, unknown>): QueueSongRow {
  const row: QueueSongRow = { songId };
  if (typeof record['title'] === 'string') row.title = record['title'];
  if (typeof record['artist'] === 'string') row.artist = record['artist'];
  if (typeof record['album'] === 'string') row.album = record['album'];
  if (typeof record['duration'] === 'number') row.duration = record['duration'];
  if (typeof record['albumId'] === 'string' && record['albumId'] !== '') row.albumId = record['albumId'];
  if (typeof record['discNumber'] === 'number') row.discNumber = record['discNumber'];
  if (typeof record['trackNumber'] === 'number') row.trackNumber = record['trackNumber'];
  return row;
}

// The engine caches whole metadata objects, so album position stays out of its cache.
export function toQueueMetadata(row: QueueSongRow): QueueTrackMetadata {
  const metadata: QueueTrackMetadata = { songId: row.songId };
  if (row.title !== undefined) metadata.title = row.title;
  if (row.artist !== undefined) metadata.artist = row.artist;
  if (row.album !== undefined) metadata.album = row.album;
  if (row.duration !== undefined) metadata.duration = row.duration;
  return metadata;
}

export async function fetchLibrarySourceRows(
  client: NavidromeClient,
  request: LibraryPlayRequest,
): Promise<QueueSongRow[]> {
  switch (request.type) {
    case 'song':
      return fetchSongPages(client, { id: request.id }, `Song ${request.id}`);
    case 'album':
      return fetchAlbumSetSongs(client, [request.id], `Album ${request.id}`);
    case 'artist':
      // Songs, not albums: `/album?artist_id=` also returns albums holding none of this artist's tracks.
      // `artists_id` matches featured and album-artist credits. `artist_id` holds only the first artist.
      return fetchSongPages(client, { artists_id: request.id, _sort: 'album', _order: 'ASC' }, `Artist ${request.id}`);
    case 'playlist':
      return fetchPlaylistSongs(client, request.id);
    case 'starred-songs':
      return fetchStarredSongs(client);
    case 'starred-albums':
      return fetchStarredAlbumSongs(client);
  }
}

async function fetchStarredAlbumSongs(client: NavidromeClient): Promise<QueueSongRow[]> {
  return fetchAlbumSetSongs(client, await fetchStarredAlbumIds(client), 'Starred albums');
}

// Navidrome ORs repeated `album_id` keys, so one paged read per chunk replaces one read per album.
// `_sort=album` yields disc and track order. The default sort is unstable on multi-disc releases.
export async function fetchAlbumSetSongs(
  client: NavidromeClient,
  albumIds: readonly string[],
  label: string,
): Promise<QueueSongRow[]> {
  const rows: QueueSongRow[] = [];
  for (let start = 0; start < albumIds.length; start += ID_CHUNK_SIZE) {
    const chunk = albumIds.slice(start, start + ID_CHUNK_SIZE);
    const page = await fetchSongPages(
      client,
      { album_id: chunk, _sort: 'album', _order: 'ASC' },
      `${label} ${start + 1}-${start + chunk.length}`,
    );
    rows.push(...page);
  }
  return sortRowsByAlbumOrder(rows, albumIds);
}

// The chunked read returns album-name order. A stable sort restores the input order and keeps each album's track order.
function sortRowsByAlbumOrder(rows: readonly QueueSongRow[], albumIds: readonly string[]): QueueSongRow[] {
  const albumRank = new Map(albumIds.map((albumId, index) => [albumId, index]));
  const rankOf = (row: QueueSongRow): number => {
    const rank = row.albumId === undefined ? undefined : albumRank.get(row.albumId);
    return rank ?? albumIds.length;
  };
  return rows.slice().sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * Shared paging loop for every Navidrome list read that feeds the queue. `extract` returns null to skip a row.
 * MAX_QUEUE_READ_PAGES bounds the walk in case Navidrome reports an inflated X-Total-Count.
 */
async function fetchPages<T>(
  client: NavidromeClient,
  path: string,
  filter: Record<string, string | readonly string[]>,
  extract: (record: Record<string, unknown>) => T | null,
  label: string,
): Promise<T[]> {
  const items: T[] = [];
  const filterParams = new URLSearchParams();
  let rowsRead = 0;
  let totalReported: number | null = null;
  for (const [key, value] of Object.entries(filter)) {
    for (const item of typeof value === 'string' ? [value] : value) filterParams.append(key, item);
  }
  for (let page = 0; page < MAX_QUEUE_READ_PAGES; page++) {
    const start = page * QUEUE_READ_PAGE_SIZE;
    const params = new URLSearchParams(filterParams);
    params.set('_start', String(start));
    params.set('_end', String(start + QUEUE_READ_PAGE_SIZE));
    const endpoint = `${path}?${params.toString()}`;
    const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown>(endpoint);
    if (page === 0) totalReported = total;

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response shape from ${endpoint}: expected array`);
    }
    rowsRead += data.length;
    for (const entry of data) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = extract(entry as Record<string, unknown>);
      if (item !== null) items.push(item);
    }
    // A stale X-Total-Count can promise rows that never come, so an empty page always ends the walk.
    if (data.length === 0) break;
    // Without X-Total-Count, a short page is the only end-of-set signal.
    if (total !== null) {
      if (rowsRead >= total) break;
    } else if (data.length < QUEUE_READ_PAGE_SIZE) {
      break;
    }
  }
  if (totalReported !== null && totalReported > MAX_QUEUE_READ_PAGES * QUEUE_READ_PAGE_SIZE) {
    logger.warn(
      `${label} has ${totalReported} rows but only the first ${items.length} were loaded (MAX_QUEUE_READ_PAGES=${MAX_QUEUE_READ_PAGES} cap).`
    );
  }
  return items;
}

function recordId(record: Record<string, unknown>): string | null {
  const id = record['id'];
  return typeof id === 'string' && id !== '' ? id : null;
}

function songRowFromRecord(record: Record<string, unknown>): QueueSongRow | null {
  const id = recordId(record);
  return id === null ? null : toQueueSongRow(id, record);
}

function fetchSongPages(
  client: NavidromeClient,
  filter: Record<string, string | readonly string[]>,
  label: string,
): Promise<QueueSongRow[]> {
  return fetchPages(client, '/song', filter, songRowFromRecord, label);
}

// The library filter also narrows X-Total-Count, so a deactivated library's tracks never enqueue.
export function fetchPlaylistSongs(client: NavidromeClient, playlistId: string): Promise<QueueSongRow[]> {
  return fetchPages(
    client,
    `/playlist/${encodeURIComponent(playlistId)}/tracks`,
    {},
    (record) => playlistSongRow(playlistId, record),
    `Playlist ${playlistId}`,
  );
}

// A playlist row's own `id` is its playlist position, never a song, so only `mediaFileId` can be played.
function playlistSongRow(playlistId: string, record: Record<string, unknown>): QueueSongRow | null {
  const mediaFileId = record['mediaFileId'];
  if (typeof mediaFileId === 'string' && mediaFileId !== '') return toQueueSongRow(mediaFileId, record);
  logger.warn(`playback: playlist ${playlistId} row ${String(record['id'])} has no mediaFileId, skipping it`);
  return null;
}

// `playDate` ASC plays the least-recently-played first, so repeated plays cycle the whole collection.
function fetchStarredSongs(client: NavidromeClient): Promise<QueueSongRow[]> {
  return fetchSongPages(client, { starred: 'true', _sort: 'playDate', _order: 'ASC' }, 'Starred set');
}

// Same least-recently-played order as the starred songs. The songs are read later per album chunk.
function fetchStarredAlbumIds(client: NavidromeClient): Promise<string[]> {
  return fetchPages(
    client,
    '/album',
    { starred: 'true', _sort: 'playDate', _order: 'ASC' },
    recordId,
    'Starred album set',
  );
}

/**
 * Look up queue metadata (title/artist/album/duration) for a list of song IDs.
 * Each chunk is one request that repeats the `id` key per ID.
 * The scoped read is the play-eligible set, so a failed or malformed read throws.
 * Only the unscoped enrichment read is best-effort, and a failed chunk yields no metadata.
 */
export async function fetchSongMetadata(
  client: NavidromeClient,
  songIds: readonly string[],
  options: { scopeToActiveLibraries?: boolean } = {},
): Promise<QueueTrackMetadata[]> {
  if (songIds.length === 0) return [];
  const scoped = options.scopeToActiveLibraries === true;
  const out: QueueTrackMetadata[] = [];
  for (let i = 0; i < songIds.length; i += ID_CHUNK_SIZE) {
    const chunk = songIds.slice(i, i + ID_CHUNK_SIZE);
    const params = new URLSearchParams();
    for (const id of chunk) params.append('id', id);
    // Navidrome paginates even an id-filtered read, so `_end` spans the whole chunk.
    params.set('_start', '0');
    params.set('_end', String(chunk.length));
    const endpoint = `/song?${params.toString()}`;
    try {
      // The unscoped read still names a playing track whose library was deactivated.
      const data = scoped
        ? await client.requestWithLibraryFilter<unknown>(endpoint)
        : await client.request<unknown>(endpoint);
      if (!Array.isArray(data)) {
        if (scoped) throw new Error(`Unexpected response shape from ${endpoint}: expected array`);
        continue;
      }
      for (const track of data) {
        if (typeof track !== 'object' || track === null) continue;
        const row = songRowFromRecord(track as Record<string, unknown>);
        if (row !== null) out.push(toQueueMetadata(row));
      }
    } catch (err) {
      if (scoped) throw err;
      // Unscoped enrichment only. The affected entries fall back to mpv's own metadata.
      logger.debug(`fetchSongMetadata chunk failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
