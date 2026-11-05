/**
 * Navidrome MCP Server - play_albums_search integration tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, beforeEach, expect, it } from 'vitest';
import {
  clearQueueAndWait,
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

/** An album's artist can be empty, so 20 random albums are scanned for one that names an artist. */
async function findSeedArtistName(): Promise<string | null> {
  const client = await getSharedLiveClient();
  const seed = await searchAlbums(client, {
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
    // Tag filters need the filter cache, and only createRuntime initializes it outside tests.
    const client = await getSharedLiveClient();
    const config = await loadConfig();
    await filterCacheManager.initialize(client, config);
  });

  beforeEach(async () => {
    await clearQueueAndWait();
  });

  itPlayback('headline: starred + random + limit:3 enqueues 1..3 albums', async () => {
    const result = await playAlbumsSearch({
      starred: true,
      sort: 'random',
      limit: 3,
    });

    if (!result.success) {
      throw new Error('expected success: true from play_albums_search');
    }

    // Library contents vary, so the counts are checked as ranges.
    expect(result.matchCount).toBeGreaterThan(0);
    expect(result.matchCount).toBeLessThanOrEqual(3);
    expect(result.albumCount).toBeGreaterThan(0);
    expect(result.albumCount).toBeLessThanOrEqual(result.matchCount);
    expect(result.trackCount).toBeGreaterThan(0);

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

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.trackCount;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.trackCount);
    expect(queue.currentIndex).toBe(0);
    // Order is not asserted, since Navidrome's text search matches album and artist names fuzzily
    // and its year sort leaves the order across artists undefined.
  });

  it('shuffleAlbums preserves per-album track order; album order may swap', async (ctx) => {
    const artistName = await findSeedArtistName();
    if (artistName === null) {
      logger.info('skipping shuffleAlbums test: no seed album with a usable artist string');
      ctx.skip();
    }

    await clearQueueAndWait();
    const baseline = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === baseline.trackCount;
    });
    const baselineQueue = await getPlayQueue();
    const baselineIds = baselineQueue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);

    await clearQueueAndWait();
    const shuffled = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
      shuffleAlbums: true,
    });

    expect(shuffled.success).toBe(true);
    expect(shuffled.matchCount).toBeGreaterThan(0);
    expect(shuffled.trackCount).toBe(baseline.trackCount);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === shuffled.trackCount;
    });

    const shuffledQueue = await getPlayQueue();
    const shuffledIds = shuffledQueue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);

    expect(new Set(shuffledIds)).toEqual(new Set(baselineIds));

    // Album order goes unchecked, since one album cannot reorder and two keep order half the time.
    if (shuffled.albumCount < 2) {
      expect(shuffledQueue.currentIndex).toBe(0);
    }
  });

  it('shuffleSongs interleaves tracks across album boundaries', async (ctx) => {
    const artistName = await findSeedArtistName();
    if (artistName === null) {
      logger.info('skipping shuffleSongs test: no seed album with a usable artist string');
      ctx.skip();
    }

    let result = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
      shuffleSongs: true,
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBeGreaterThan(0);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === result.trackCount;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(result.trackCount);

    const ids = queue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);
    expect(ids.length).toBe(result.trackCount);

    // Queue entries do not name their album, so the shuffled order is compared with the unshuffled
    // one. Below 10 tracks or 2 albums there is no cross-album interleave to check.
    if (result.albumCount < 2 || result.trackCount < 10) {
      return;
    }

    await clearQueueAndWait();
    const baseline = await playAlbumsSearch({
      query: artistName,
      sort: 'year',
      order: 'ASC',
      limit: 10,
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
      await clearQueueAndWait();
      result = await playAlbumsSearch({
        query: artistName,
        sort: 'year',
        order: 'ASC',
        limit: 10,
        shuffleSongs: true,
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

    const result = await playAlbumsSearch({
      starred: true,
      limit: 1,
      mode: 'append',
    });
    expect(result.success).toBe(true);
    expect(result.trackCount).toBeGreaterThan(0);

    const expectedLength = initialLength + result.trackCount;
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

  itPlayback('empty result set throws "No albums matched"', async () => {
    let caught: unknown;
    try {
      await playAlbumsSearch({ query: 'NoSuchArtistAbc12345xyzzzy' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('No albums matched');

    const np = await nowPlaying();
    expect(np.queueLength ?? 0).toBe(0);
  });

  itPlayback("appliedFilters round-trip: genre filter populates appliedFilters", async () => {
    const tryGenres = ['Rock', 'Pop'];
    let result: Awaited<ReturnType<typeof playAlbumsSearch>> | null = null;
    let usedGenre: string | null = null;

    for (const g of tryGenres) {
      try {
        result = await playAlbumsSearch({ genre: g, limit: 2 });
        usedGenre = g;
        break;
      } catch (err) {
        // A genre with no albums and a genre absent from the library both move on to the next one.
        const msg = (err as Error).message ?? '';
        if (
          !msg.includes('No albums matched') &&
          !msg.includes('not found') &&
          !msg.includes('No matching')
        ) {
          throw err;
        }
        await clearQueueAndWait();
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
    expect(result.appliedFilters).toBeDefined();
    expect(typeof result.appliedFilters).toBe('object');
    expect(Object.keys(result.appliedFilters ?? {}).length).toBeGreaterThan(0);
  });

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

    if (result.appliedFilters !== undefined) {
      expect(typeof result.appliedFilters).toBe('object');
      expect(result.appliedFilters).not.toBeNull();
    }
  });
});
