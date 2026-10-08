/**
 * Navidrome MCP Server - orderQueueSongs tests
 * Copyright (C) 2025
 *
 * Shuffled output is checked by invariants, never by a fixed random sequence.
 */

import { describe, expect, it, vi } from 'vitest';
import { fisherYatesShuffle, orderQueueSongs } from '../../../src/tools/queue-order.js';

interface Row {
  key: string;
  albumId?: string;
  discNumber?: number;
  trackNumber?: number;
}

// Three albums with interleaved rows, each album listed out of disc and track order.
const ROWS: readonly Row[] = [
  { key: 'b-1-2', albumId: 'b', discNumber: 1, trackNumber: 2 },
  { key: 'a-2-1', albumId: 'a', discNumber: 2, trackNumber: 1 },
  { key: 'c-1-1', albumId: 'c', discNumber: 1, trackNumber: 1 },
  { key: 'a-1-2', albumId: 'a', discNumber: 1, trackNumber: 2 },
  { key: 'b-1-1', albumId: 'b', discNumber: 1, trackNumber: 1 },
  { key: 'a-1-1', albumId: 'a', discNumber: 1, trackNumber: 1 },
  { key: 'c-1-3', albumId: 'c', discNumber: 1, trackNumber: 3 },
  { key: 'c-1-2', albumId: 'c', discNumber: 1, trackNumber: 2 },
];

const RUNS = 50;

function keys(rows: readonly Row[]): string[] {
  return rows.map((row) => row.key);
}

function sortedKeys(rows: readonly Row[]): string[] {
  return keys(rows).sort();
}

// Each album id must occupy one contiguous run of the output.
function albumRuns(rows: readonly Row[]): string[] {
  const runs: string[] = [];
  for (const row of rows) {
    const albumId = row.albumId ?? `solo:${row.key}`;
    if (runs[runs.length - 1] !== albumId) runs.push(albumId);
  }
  return runs;
}

function rowsOfAlbum(rows: readonly Row[], albumId: string): string[] {
  return keys(rows.filter((row) => row.albumId === albumId));
}

describe('fisherYatesShuffle', () => {
  it('returns a new permutation and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const out = fisherYatesShuffle(input);

    expect(out).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('orderQueueSongs', () => {
  it('keeps input order and returns a new array with no flag set', () => {
    const out = orderQueueSongs(ROWS, { shuffleSongs: false, shuffleAlbums: false });

    expect(out).not.toBe(ROWS);
    expect(keys(out)).toEqual(keys(ROWS));
  });

  it('permutes every row with only shuffleSongs set', () => {
    const seen = new Set<string>();
    for (let run = 0; run < RUNS; run++) {
      const out = orderQueueSongs(ROWS, { shuffleSongs: true, shuffleAlbums: false });
      expect(sortedKeys(out)).toEqual(sortedKeys(ROWS));
      seen.add(keys(out).join(','));
    }
    // 50 runs over 8! orders all landing on one sequence means no shuffle happened.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps albums contiguous and sorts each by disc then track with only shuffleAlbums set', () => {
    const albumOrders = new Set<string>();
    for (let run = 0; run < RUNS; run++) {
      const out = orderQueueSongs(ROWS, { shuffleSongs: false, shuffleAlbums: true });

      expect(sortedKeys(out)).toEqual(sortedKeys(ROWS));
      const runs = albumRuns(out);
      expect(runs).toHaveLength(3);
      expect([...runs].sort()).toEqual(['a', 'b', 'c']);
      expect(rowsOfAlbum(out, 'a')).toEqual(['a-1-1', 'a-1-2', 'a-2-1']);
      expect(rowsOfAlbum(out, 'b')).toEqual(['b-1-1', 'b-1-2']);
      expect(rowsOfAlbum(out, 'c')).toEqual(['c-1-1', 'c-1-2', 'c-1-3']);
      albumOrders.add(runs.join(','));
    }
    expect(albumOrders.size).toBeGreaterThan(1);
  });

  it('keeps albums contiguous and shuffles inside each with both flags set', () => {
    const albumOrders = new Set<string>();
    const albumAOrders = new Set<string>();
    for (let run = 0; run < RUNS; run++) {
      const out = orderQueueSongs(ROWS, { shuffleSongs: true, shuffleAlbums: true });

      expect(sortedKeys(out)).toEqual(sortedKeys(ROWS));
      const runs = albumRuns(out);
      expect(runs).toHaveLength(3);
      expect([...runs].sort()).toEqual(['a', 'b', 'c']);
      albumOrders.add(runs.join(','));
      albumAOrders.add(rowsOfAlbum(out, 'a').join(','));
    }
    expect(albumOrders.size).toBeGreaterThan(1);
    expect(albumAOrders.size).toBeGreaterThan(1);
  });

  it('forms album groups in order of first appearance', () => {
    // A random value just under 1 makes every Fisher-Yates swap a self-swap, so the group order shows through.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    try {
      const out = orderQueueSongs(ROWS, { shuffleSongs: false, shuffleAlbums: true });

      expect(albumRuns(out)).toEqual(['b', 'a', 'c']);
    } finally {
      random.mockRestore();
    }
  });

  it('treats a row with no album id as a group of its own', () => {
    const rows: Row[] = [
      { key: 'solo-1' },
      { key: 'a-1', albumId: 'a', trackNumber: 1 },
      { key: 'solo-2' },
      { key: 'a-2', albumId: 'a', trackNumber: 2 },
    ];

    for (let run = 0; run < RUNS; run++) {
      const out = orderQueueSongs(rows, { shuffleSongs: false, shuffleAlbums: true });

      expect(sortedKeys(out)).toEqual(sortedKeys(rows));
      expect(albumRuns(out)).toHaveLength(3);
      expect(rowsOfAlbum(out, 'a')).toEqual(['a-1', 'a-2']);
    }
  });

  it('sorts a missing disc or track number after present ones and keeps ties in input order', () => {
    const rows: Row[] = [
      { key: 'no-disc', albumId: 'a', trackNumber: 1 },
      { key: 'd1-no-track-first', albumId: 'a', discNumber: 1 },
      { key: 'd1-t2', albumId: 'a', discNumber: 1, trackNumber: 2 },
      { key: 'd1-no-track-second', albumId: 'a', discNumber: 1 },
      { key: 'd1-t1', albumId: 'a', discNumber: 1, trackNumber: 1 },
      { key: 'd2-t1-first', albumId: 'a', discNumber: 2, trackNumber: 1 },
      { key: 'd2-t1-second', albumId: 'a', discNumber: 2, trackNumber: 1 },
    ];

    const out = orderQueueSongs(rows, { shuffleSongs: false, shuffleAlbums: true });

    expect(keys(out)).toEqual([
      'd1-t1',
      'd1-t2',
      'd1-no-track-first',
      'd1-no-track-second',
      'd2-t1-first',
      'd2-t1-second',
      'no-disc',
    ]);
  });
});
