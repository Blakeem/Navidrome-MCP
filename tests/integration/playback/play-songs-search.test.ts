/**
 * Navidrome MCP Server - play_songs_search integration tests
 * Copyright (C) 2025
 *
 * Live integration tests for the filter-driven `play_songs_search` tool.
 * Each test starts from a cleared queue (beforeEach) so search results are
 * the only thing in the queue when assertions run.
 *
 * Test philosophy (per tests/CLAUDE.md):
 *   - Validate STRUCTURE not CONTENT — never assert on specific song titles
 *     or artists. Compare ID sets when we know the IDs (because we just
 *     searched).
 *   - Live reads against Navidrome only; no Navidrome writes.
 *   - Probabilistic shuffle assertions allow ONE retry, matching A's
 *     play-songs-queue.test.ts pattern.
 */

import { beforeAll, beforeEach, expect } from 'vitest';
import {
  clearPlayQueue,
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
    // Each test starts with a known empty queue so the search-driven load
    // is unambiguous. Append-mode tests build their own preamble queue.
    await clearPlayQueue();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 0;
    });
  });

  // ---------------------------------------------------------------------
  // Headline use case
  // ---------------------------------------------------------------------

  itPlayback('headline: starred + limit:10 enqueues 1..10 songs', async () => {
    const result = await playSongsSearch({ starred: true, limit: 10 });

    expect(result.success).toBe(true);
    expect(typeof result.count).toBe('number');
    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThanOrEqual(10);
    // `mode` and `shuffled` are no longer echoed (LLM input echoes that
    // could even lie about silent demotion in radio-loaded queues).

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

  // ---------------------------------------------------------------------
  // Filter pass-through with sort
  // ---------------------------------------------------------------------

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
    // `mode` and `shuffled` are no longer echoed (LLM input echoes that
    // could even lie about silent demotion in radio-loaded queues).

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.count;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.count);
    expect(queue.currentIndex).toBe(0);
    // Don't assert the *order* of titles — content tests are an
    // anti-pattern per tests/CLAUDE.md. Length + structural shape is enough.
  });

  // ---------------------------------------------------------------------
  // shuffle: true
  // ---------------------------------------------------------------------

  itPlayback('shuffle:true permutes the result set; multiset preserved', async () => {
    // Capture deterministic baseline first.
    const baseline = await playSongsSearch({
      starred: true,
      limit: 5,
      shuffle: false,
    });
    expect(baseline.success).toBe(true);
    // Note: response no longer echoes `shuffled` — LLM already knows what it
    // asked for. Behavior is verified by comparing baselineIds vs shuffledIds.
    expect(baseline.count).toBeGreaterThan(0);

    if (baseline.count < 2) {
      // Can't meaningfully test shuffling a 1-track result.
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

    // Now run the same query with shuffle:true.
    await clearPlayQueue();
    await waitFor(async () => (await nowPlaying()).queueLength === 0);

    let shuffled = await playSongsSearch({
      starred: true,
      limit: 5,
      shuffle: true,
    });
    expect(shuffled.success).toBe(true);
    // Behavior (actual reordering) is verified by comparing IDs below.
    expect(shuffled.count).toBe(baseline.count);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === shuffled.count;
    });
    let shuffledQueue = await getPlayQueue();
    let shuffledIds = shuffledQueue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);

    // Multiset equality: same songs, possibly reordered.
    expect(new Set(shuffledIds)).toEqual(new Set(baselineIds));

    // Probabilistic order check: with N=5, Fisher-Yates lands on the input
    // permutation with probability 1/120. Allow ONE retry.
    const orderEqual = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((id, i) => id === b[i]);

    if (orderEqual(shuffledIds, baselineIds)) {
      await clearPlayQueue();
      await waitFor(async () => (await nowPlaying()).queueLength === 0);

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

  // ---------------------------------------------------------------------
  // mode: 'append' preserves current track
  // ---------------------------------------------------------------------

  itPlayback("mode:'append' preserves the currently-playing track", async () => {
    // Set up a known queue with 3 explicit songs first.
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
    // `mode` is no longer echoed (silent radio-demotion would have lied).
    expect(result.count).toBeGreaterThan(0);

    const expectedLength = initialLength + result.count;
    await waitFor(async () => {
      const np = await nowPlaying();
      return (np.queueLength ?? 0) === expectedLength;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(expectedLength);
    expect(after.currentIndex).toBe(0);
    // First slot is still the original currently-playing song.
    expect(after.items[0]?.songId).toBe(currentSongId);
    const stillCurrent = after.items.find((e) => e.isCurrent);
    expect(stillCurrent?.songId).toBe(currentSongId);
  });

  // ---------------------------------------------------------------------
  // Empty result throws
  // ---------------------------------------------------------------------

  itPlayback('empty result set throws "No songs matched"', async () => {
    let caught: unknown;
    try {
      await playSongsSearch({ query: 'NoSuchSongXyzzy12345abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('No songs matched');

    // Live queue should remain empty (beforeEach cleared it).
    const np = await nowPlaying();
    expect(np.queueLength).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Return shape integrity
  // ---------------------------------------------------------------------

  itPlayback('return-shape integrity: every documented field has the expected type', async () => {
    const result = await playSongsSearch({ starred: true, limit: 1 });

    expect(typeof result.success).toBe('boolean');
    expect(result.success).toBe(true);

    expect(typeof result.count).toBe('number');
    expect(Number.isInteger(result.count)).toBe(true);
    expect(result.count).toBeGreaterThan(0);

    // `mode` and `shuffled` are no longer in the response — they were LLM
    // input echoes that wasted context.

    // appliedFilters is optional.
    if (result.appliedFilters !== undefined) {
      expect(typeof result.appliedFilters).toBe('object');
      expect(result.appliedFilters).not.toBeNull();
    }
  });
});
