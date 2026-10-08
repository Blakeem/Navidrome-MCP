/**
 * Navidrome MCP Server - Play Queue Ordering
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

interface QueueOrderRow {
  albumId?: string;
  discNumber?: number;
  trackNumber?: number;
}

interface QueueOrderOptions {
  shuffleSongs: boolean;
  shuffleAlbums: boolean;
}

export function fisherYatesShuffle<T>(input: readonly T[]): T[] {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * Album shuffle without song shuffle sorts each album by disc and track,
 * because playlist and starred sources list songs out of album order.
 */
export function orderQueueSongs<T extends QueueOrderRow>(rows: readonly T[], options: QueueOrderOptions): T[] {
  if (!options.shuffleAlbums) {
    return options.shuffleSongs ? fisherYatesShuffle(rows) : rows.slice();
  }

  const shuffledGroups = fisherYatesShuffle(groupByAlbum(rows));
  return shuffledGroups.flatMap((group) =>
    options.shuffleSongs ? fisherYatesShuffle(group) : sortByDiscAndTrack(group),
  );
}

// A row without an album id has no album to stay with, so it forms its own group.
function groupByAlbum<T extends QueueOrderRow>(rows: readonly T[]): T[][] {
  const groups: T[][] = [];
  const groupByAlbumId = new Map<string, T[]>();
  for (const row of rows) {
    if (row.albumId === undefined) {
      groups.push([row]);
      continue;
    }
    const existing = groupByAlbumId.get(row.albumId);
    if (existing !== undefined) {
      existing.push(row);
      continue;
    }
    const group = [row];
    groupByAlbumId.set(row.albumId, group);
    groups.push(group);
  }
  return groups;
}

// Array.prototype.sort is stable, so rows with equal positions keep their input order.
function sortByDiscAndTrack<T extends QueueOrderRow>(group: readonly T[]): T[] {
  return group.slice().sort((a, b) => {
    const byDisc = compareMissingLast(a.discNumber, b.discNumber);
    return byDisc !== 0 ? byDisc : compareMissingLast(a.trackNumber, b.trackNumber);
  });
}

function compareMissingLast(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}
