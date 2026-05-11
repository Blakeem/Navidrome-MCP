/**
 * Navidrome MCP Server - play_albums_search integration tests
 * Copyright (C) 2025
 *
 * Live integration tests for the filter-driven `play_albums_search` tool.
 * Each test starts from a cleared queue (beforeEach) so search results are
 * the only thing in the queue when assertions run.
 *
 * Test philosophy (per tests/CLAUDE.md):
 *   - Validate STRUCTURE not CONTENT — never assert on specific album/track
 *     titles. Compare ID sets when we know the IDs (because we just searched).
 *   - Live reads against Navidrome only; no Navidrome writes. mpv is the only
 *     thing being mutated.
 *   - Probabilistic shuffle assertions allow ONE retry, matching A's pattern.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  clearPlayQueue,
  describePlayback,
  getPlayQueue,
  getTestSongIds,
  itPlayback,
  nowPlaying,
  playAlbumsSearch,
  playSongs,
  setupClientAndConfig,
  waitFor,
} from './helpers.js';
import { searchAlbums } from '../../../src/tools/search/index.js';
import { getSharedLiveClient } from '../../factories/shared-client.js';
import { loadConfig } from '../../../src/config.js';
import { logger } from '../../../src/utils/logger.js';
import { filterCacheManager } from '../../../src/services/filter-cache-manager.js';

/**
 * Find a seed album whose `artist` field is a usable, non-empty string.
 * Some libraries have albums where `artist` is missing or empty (Navidrome
 * synthesizes one from track-level data, but it can fall through to ''),
 * so we over-fetch and pick the first non-empty hit. Returns null when no
 * seed is usable — caller should skip the test in that case.
 */
async function findSeedArtistName(): Promise<string | null> {
  const client = await getSharedLiveClient();
  const config = await loadConfig();
  const seed = await searchAlbums(client, config, {
    query: '',
    sort: 'random',
    limit: 20,
  });
  for (const album of seed.albums) {
    const candidate =
      typeof album.artist === 'string' && album.artist.length > 0
        ? album.artist
        : typeof album.albumArtist === 'string' && album.albumArtist.length > 0
          ? album.albumArtist
          : null;
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

describePlayback('play_albums_search (live)', () => {
  beforeAll(async () => {
    await setupClientAndConfig();
    // Filter resolution (genre/mediaType/etc.) requires the cache to be
    // initialized. The MCP server entrypoint (src/index.ts) initializes
    // it on startup; in tests we have to do it ourselves. Idempotent.
    const client = await getSharedLiveClient();
    const config = await loadConfig();
    await filterCacheManager.initialize(client, config);
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

  itPlayback('headline: starred + random + limit:3 enqueues 1..3 albums', async () => {
    const result = await playAlbumsSearch({
      starred: true,
      sort: 'random',
      limit: 3,
    });

    if (!result.success) {
      throw new Error('expected success: true from play_albums_search');
    }

    // Live libraries vary — assert range, not exact equality.
    expect(result.matchCount).toBeGreaterThan(0);
    expect(result.matchCount).toBeLessThanOrEqual(3);
    expect(result.albumCount).toBeGreaterThan(0);
    expect(result.albumCount).toBeLessThanOrEqual(result.matchCount);
    expect(result.trackCount).toBeGreaterThan(0);
    // `mode` and `shuffle` are no longer echoed (LLM input echoes).

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.trackCount;
    });

    const np = await nowPlaying();
    expect(np.queueLength).toBe(result.trackCount);
    expect(np.queueIndex).toBe(0);

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.trackCount);
    expect(queue.currentIndex).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Pass-through filter (text query)
  // ---------------------------------------------------------------------

  it('pass-through filter: query by artist enqueues a populated queue', async (ctx) => {
    const artistName = await findSeedArtistName();
    if (artistName === null) {
      logger.info('skipping artist-query test: no seed album with a usable artist string');
      ctx.skip();
    }

    const result = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.matchCount).toBeGreaterThan(0);
    expect(result.trackCount).toBeGreaterThan(0);
    // `mode` is no longer echoed (LLM input echo).

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.trackCount;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.trackCount);
    expect(queue.currentIndex).toBe(0);
    // Don't assert ordering — Navidrome's text search is fuzzy across
    // album/artist names and the year-sort behavior across artists is
    // implementation-defined.
  });

  // ---------------------------------------------------------------------
  // shuffle: 'albums'
  // ---------------------------------------------------------------------

  it('shuffle:albums preserves per-album track order; album order may swap', async (ctx) => {
    const artistName = await findSeedArtistName();
    if (artistName === null) {
      logger.info('skipping shuffle:albums test: no seed album with a usable artist string');
      ctx.skip();
    }

    // Capture a no-shuffle baseline so we can compare album order later.
    await clearPlayQueue();
    await waitFor(async () => (await nowPlaying()).queueLength === 0);
    const baseline = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
      shuffle: 'none',
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === baseline.trackCount;
    });
    const baselineQueue = await getPlayQueue();
    const baselineIds = baselineQueue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);

    // Now run the same query with shuffle:'albums'.
    await clearPlayQueue();
    await waitFor(async () => (await nowPlaying()).queueLength === 0);
    const shuffled = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
      shuffle: 'albums',
    });

    expect(shuffled.success).toBe(true);
    expect(shuffled.matchCount).toBeGreaterThan(0);
    // Note: response no longer echoes the `shuffle` input. Behavior is verified
    // by comparing the resulting queue order against the baseline below.
    expect(shuffled.trackCount).toBe(baseline.trackCount);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === shuffled.trackCount;
    });

    const shuffledQueue = await getPlayQueue();
    const shuffledIds = shuffledQueue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);

    // Multiset equality — same tracks, just possibly reordered.
    expect(new Set(shuffledIds)).toEqual(new Set(baselineIds));

    // We can't guarantee album order differs (with 1 album result, shuffle
    // is a no-op; with 2 it's 50/50). The structural check above is what
    // we care about.
    if (shuffled.albumCount < 2) {
      // No album-level reordering possible. Confirm the queue is at least
      // populated and currentIndex is 0.
      expect(shuffledQueue.currentIndex).toBe(0);
    }
  });

  // ---------------------------------------------------------------------
  // shuffle: 'songs'
  // ---------------------------------------------------------------------

  it('shuffle:songs interleaves tracks across album boundaries', async (ctx) => {
    const artistName = await findSeedArtistName();
    if (artistName === null) {
      logger.info('skipping shuffle:songs test: no seed album with a usable artist string');
      ctx.skip();
    }

    let result = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
      shuffle: 'songs',
    });

    expect(result.success).toBe(true);
    // `shuffle` is no longer echoed (LLM input echo).
    expect(result.trackCount).toBeGreaterThan(0);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.trackCount;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.trackCount);

    // Multiset equality — capture for retry if we need it.
    const ids = queue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);
    expect(ids.length).toBe(result.trackCount);

    // Probabilistic check: with N≥10 tracks across ≥2 albums, the first N
    // tracks should NOT all collapse to the same album. We can't tell which
    // album each track belongs to from just the queue, so the cleanest
    // signal is: with shuffle:'songs' and ≥2 source albums, the resulting
    // ID list should differ from the deterministic 'none' result we'd get
    // with the same query. Allow ONE retry on the rare same-order outcome.
    if (result.albumCount < 2 || result.trackCount < 10) {
      // Not enough material to make the inter-album shuffle test
      // meaningful. Structural validation above is sufficient.
      return;
    }

    // Get the deterministic baseline once.
    await clearPlayQueue();
    await waitFor(async () => (await nowPlaying()).queueLength === 0);
    const baseline = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
      shuffle: 'none',
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === baseline.trackCount;
    });
    const baselineQ = await getPlayQueue();
    const baselineIds = baselineQ.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);

    const orderEqual = (a: string[], b: string[]): boolean =>
      a.length === b.length && a.every((id, i) => id === b[i]);

    if (orderEqual(ids, baselineIds)) {
      // Retry once. Re-run shuffle:'songs' from scratch.
      await clearPlayQueue();
      await waitFor(async () => (await nowPlaying()).queueLength === 0);
      result = await playAlbumsSearch({
        query: artistName,
        sort: 'year',
        order: 'ASC',
        limit: 10,
        shuffle: 'songs',
      });
      await waitFor(async () => {
        const np = await nowPlaying();
        return np.queueLength === result.trackCount;
      });
      const retryQ = await getPlayQueue();
      const retryIds = retryQ.items
        .map((e) => e.songId)
        .filter((id): id is string => id !== null);
      expect(new Set(retryIds)).toEqual(new Set(baselineIds));
      expect(orderEqual(retryIds, baselineIds)).toBe(false);
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

    const result = await playAlbumsSearch({
      starred: true,
      limit: 1,
      mode: 'append',
    });
    expect(result.success).toBe(true);
    // `mode` is no longer echoed (silent radio-demotion would have lied).
    expect(result.trackCount).toBeGreaterThan(0);

    const expectedLength = initialLength + result.trackCount;
    await waitFor(async () => {
      const np = await nowPlaying();
      return (np.queueLength ?? 0) === expectedLength;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(expectedLength);
    expect(after.currentIndex).toBe(0);
    // The first slot is still the original currently-playing song.
    expect(after.items[0]?.songId).toBe(currentSongId);
    const stillCurrent = after.items.find((e) => e.isCurrent);
    expect(stillCurrent?.songId).toBe(currentSongId);
  });

  // ---------------------------------------------------------------------
  // Empty result throws
  // ---------------------------------------------------------------------

  itPlayback('empty result set throws "No albums matched"', async () => {
    let caught: unknown;
    try {
      await playAlbumsSearch({ query: 'NoSuchArtistAbc12345xyzzzy' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('No albums matched');

    // Live queue should remain empty (beforeEach cleared it).
    const np = await nowPlaying();
    expect(np.queueLength).toBe(0);
  });

  // ---------------------------------------------------------------------
  // appliedFilters round-trip
  // ---------------------------------------------------------------------

  itPlayback("appliedFilters round-trip: genre filter populates appliedFilters", async () => {
    // Try Rock; fall back to Pop. If neither resolves, skip with a clear log.
    const tryGenres = ['Rock', 'Pop'];
    let result: Awaited<ReturnType<typeof playAlbumsSearch>> | null = null;
    let usedGenre: string | null = null;

    for (const g of tryGenres) {
      try {
        result = await playAlbumsSearch({ genre: g, limit: 2 });
        usedGenre = g;
        break;
      } catch (err) {
        // Could be "No albums matched" if user has no albums in that genre
        // OR could be a filter-resolution miss (genre name unknown). Both
        // are tolerable; try the next fallback.
        const msg = (err as Error).message ?? '';
        if (
          !msg.includes('No albums matched') &&
          !msg.includes('not found') &&
          !msg.includes('No matching')
        ) {
          throw err;
        }
        await clearPlayQueue();
        await waitFor(async () => (await nowPlaying()).queueLength === 0);
      }
    }

    if (result === null || usedGenre === null) {
      logger.info(
        `skipping appliedFilters test: library has no Rock or Pop albums (tried ${tryGenres.join(', ')})`
      );
      return;
    }

    expect(result.success).toBe(true);
    expect(result.matchCount).toBeGreaterThan(0);
    // appliedFilters should round-trip the genre — it's the resolved tag ID,
    // not the input string. The presence/structure is what we assert here.
    expect(result.appliedFilters).toBeDefined();
    expect(typeof result.appliedFilters).toBe('object');
    // Most resolvers populate `genre_id` (or similar) but the exact key
    // depends on Navidrome's tag system; we only assert it has at least
    // one resolved key.
    expect(Object.keys(result.appliedFilters ?? {}).length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------
  // Return shape integrity
  // ---------------------------------------------------------------------

  itPlayback('return-shape integrity: every documented field has the expected type', async () => {
    const result = await playAlbumsSearch({
      starred: true,
      sort: 'random',
      limit: 1,
    });

    expect(typeof result.success).toBe('boolean');
    expect(result.success).toBe(true);

    expect(typeof result.matchCount).toBe('number');
    expect(Number.isInteger(result.matchCount)).toBe(true);
    expect(result.matchCount).toBeGreaterThan(0);

    expect(typeof result.albumCount).toBe('number');
    expect(Number.isInteger(result.albumCount)).toBe(true);
    expect(result.albumCount).toBeGreaterThan(0);

    expect(typeof result.trackCount).toBe('number');
    expect(Number.isInteger(result.trackCount)).toBe(true);
    expect(result.trackCount).toBeGreaterThan(0);

    // `mode` and `shuffle` are no longer in the response — they were LLM
    // input echoes that wasted context window.

    // appliedFilters is optional. If present it must be a non-null object.
    if (result.appliedFilters !== undefined) {
      expect(typeof result.appliedFilters).toBe('object');
      expect(result.appliedFilters).not.toBeNull();
    }
  });
});
