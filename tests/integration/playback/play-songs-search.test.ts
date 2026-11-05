/**
 * Navidrome MCP Server - play_songs_search integration tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, beforeEach, expect } from 'vitest';
import {
  clearQueueAndWait,
  describePlayback,
  getPlayQueue,
  getTestSongIds,
  itPlayback,
  nowPlaying,
  playSongs,
  playSongsSearch,
  setupClientAndConfig,
  waitFor,
} from './helpers.js';

describePlayback('play_songs_search (live)', () => {
  beforeAll(async () => {
    await setupClientAndConfig();
  });

  beforeEach(async () => {
    await clearQueueAndWait();
  });

  itPlayback('headline: starred + limit:10 enqueues 1..10 songs', async () => {
    const result = await playSongsSearch({ starred: true, limit: 10 });

    expect(result.success).toBe(true);
    expect(typeof result.count).toBe('number');
    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThanOrEqual(10);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.count;
    });

    const np = await nowPlaying();
    expect(np.queueLength).toBe(result.count);
    expect(np.queueIndex).toBe(0);

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.count);
    expect(queue.currentIndex).toBe(0);
  });

  itPlayback('pass-through: starred + sort:title + ASC + limit:5 populates queue', async () => {
    const result = await playSongsSearch({
      starred: true,
      sort: 'title',
      order: 'ASC',
      limit: 5,
    });

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThanOrEqual(5);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.count;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.count);
    expect(queue.currentIndex).toBe(0);
    // Title order is content, which tests/CLAUDE.md rules out, so only the shape is checked.
  });

  itPlayback('shuffle:true permutes the result set; multiset preserved', async () => {
    const baseline = await playSongsSearch({
      starred: true,
      limit: 5,
      shuffle: false,
    });
    expect(baseline.success).toBe(true);
    expect(baseline.count).toBeGreaterThan(0);

    if (baseline.count < 2) {
      return;
    }

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === baseline.count;
    });
    const baselineQueue = await getPlayQueue();
    const baselineIds = baselineQueue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);
    expect(baselineIds.length).toBe(baseline.count);

    await clearQueueAndWait();

    let shuffled = await playSongsSearch({
      starred: true,
      limit: 5,
      shuffle: true,
    });
    expect(shuffled.success).toBe(true);
    expect(shuffled.count).toBe(baseline.count);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === shuffled.count;
    });
    let shuffledQueue = await getPlayQueue();
    let shuffledIds = shuffledQueue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);

    expect(new Set(shuffledIds)).toEqual(new Set(baselineIds));

    // Fisher-Yates returns the input order with probability 1/n!, so one retry is allowed.
    const orderEqual = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((id, i) => id === b[i]);

    if (orderEqual(shuffledIds, baselineIds)) {
      await clearQueueAndWait();

      shuffled = await playSongsSearch({
        starred: true,
        limit: 5,
        shuffle: true,
      });
      await waitFor(async () => {
        const np = await nowPlaying();
        return np.queueLength === shuffled.count;
      });
      shuffledQueue = await getPlayQueue();
      shuffledIds = shuffledQueue.items
        .map((e) => e.songId)
        .filter((id): id is string => id !== null);
      expect(new Set(shuffledIds)).toEqual(new Set(baselineIds));
      expect(orderEqual(shuffledIds, baselineIds)).toBe(false);
    }
  });

  itPlayback("mode:'append' preserves the currently-playing track", async () => {
    const songIds = await getTestSongIds(3);
    await playSongs({ songIds, mode: 'replace' });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === songIds.length && np.queueIndex === 0;
    });

    const before = await nowPlaying();
    const initialLength = before.queueLength as number;
    expect(initialLength).toBe(songIds.length);
    const beforeQueue = await getPlayQueue();
    const currentSongId = beforeQueue.items[0]?.songId;
    expect(currentSongId).toBeTruthy();

    const result = await playSongsSearch({
      starred: true,
      limit: 5,
      mode: 'append',
    });
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);

    const expectedLength = initialLength + result.count;
    await waitFor(async () => {
      const np = await nowPlaying();
      return (np.queueLength ?? 0) === expectedLength;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(expectedLength);
    expect(after.currentIndex).toBe(0);
    expect(after.items[0]?.songId).toBe(currentSongId);
    const stillCurrent = after.items.find((e) => e.isCurrent);
    expect(stillCurrent?.songId).toBe(currentSongId);
  });

  itPlayback('empty result set throws "No songs matched"', async () => {
    let caught: unknown;
    try {
      await playSongsSearch({ query: 'NoSuchSongXyzzy12345abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('No songs matched');

    const np = await nowPlaying();
    expect(np.queueLength ?? 0).toBe(0);
  });

  itPlayback('return-shape integrity: every documented field has the expected type', async () => {
    const result = await playSongsSearch({ starred: true, limit: 1 });

    expect(typeof result.success).toBe('boolean');
    expect(result.success).toBe(true);

    expect(typeof result.count).toBe('number');
    expect(Number.isInteger(result.count)).toBe(true);
    expect(result.count).toBeGreaterThan(0);

    if (result.appliedFilters !== undefined) {
      expect(typeof result.appliedFilters).toBe('object');
      expect(result.appliedFilters).not.toBeNull();
    }
  });
});
