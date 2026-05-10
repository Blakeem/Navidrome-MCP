/**
 * Navidrome MCP Server - play_albums + queue manipulation integration tests
 * Copyright (C) 2025
 *
 * Live integration tests covering play_albums in all shuffle modes plus
 * append-vs-replace semantics. The 2-album fixture is captured once in
 * beforeAll along with each album's expected track count so we can assert
 * exact lengths.
 */

import { beforeAll, beforeEach, expect } from 'vitest';
import {
  clearPlayQueue,
  describePlayback,
  getAlbumTrackIds,
  getPlayQueue,
  getTestAlbumIds,
  itPlayback,
  nowPlaying,
  playAlbums,
  setupClientAndConfig,
  waitFor,
} from './helpers.js';

describePlayback('play_albums + queue manipulation (live)', () => {
  let albumIdA: string;
  let albumIdB: string;
  let albumATrackIds: string[];
  let albumBTrackIds: string[];

  beforeAll(async () => {
    await setupClientAndConfig();
    const ids = await getTestAlbumIds(2);
    albumIdA = ids[0] as string;
    albumIdB = ids[1] as string;
    // Capture expected tracks via the same endpoint the engine uses, so
    // counts match exactly even if Navidrome hides some songs.
    albumATrackIds = await getAlbumTrackIds(albumIdA);
    albumBTrackIds = await getAlbumTrackIds(albumIdB);
    if (albumATrackIds.length === 0 || albumBTrackIds.length === 0) {
      throw new Error('beforeAll: test albums resolved to empty track lists');
    }
  });

  beforeEach(async () => {
    // Reset to a known 2-album, shuffle-none state
    await clearPlayQueue();
    await playAlbums({
      albumIds: [albumIdA, albumIdB],
      mode: 'replace',
      shuffle: 'none',
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length + albumBTrackIds.length;
    });
  });

  // -------------------------------------------------------------------------
  // Single-album cases
  // -------------------------------------------------------------------------

  itPlayback('single album shuffle:none queues all tracks in API natural order', async () => {
    // Start fresh with a single-album replace
    await clearPlayQueue();
    const result = await playAlbums({
      albumIds: [albumIdA],
      mode: 'replace',
      shuffle: 'none',
    });
    expect(result.albumCount).toBe(1);
    expect(result.trackCount).toBe(albumATrackIds.length);
    expect(result.shuffle).toBe('none');

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(albumATrackIds.length);
    expect(queue.items.map((e) => e.songId)).toEqual(albumATrackIds);
  });

  itPlayback('single album shuffle:songs preserves multiset, may differ in order', async () => {
    if (albumATrackIds.length < 2) {
      // Can't meaningfully test shuffling a single track
      return;
    }
    await clearPlayQueue();
    await playAlbums({ albumIds: [albumIdA], mode: 'replace', shuffle: 'songs' });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(albumATrackIds.length);

    const queueIds = queue.items
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);
    expect(new Set(queueIds)).toEqual(new Set(albumATrackIds));
  });

  // -------------------------------------------------------------------------
  // Two-album cases
  // -------------------------------------------------------------------------

  itPlayback('two albums shuffle:none preserves contiguous album blocks', async () => {
    // beforeEach loaded shuffle:'none' — assert directly.
    const queue = await getPlayQueue();
    expect(queue.length).toBe(albumATrackIds.length + albumBTrackIds.length);

    const ids = queue.items.map((e) => e.songId);
    // First N ids should equal one album's tracks (input order is A then B,
    // shuffle is none), then second album's tracks. Order of the two
    // albums in the input array is preserved; tracks within each album are
    // in API natural order.
    const firstBlock = ids.slice(0, albumATrackIds.length);
    const secondBlock = ids.slice(albumATrackIds.length);
    expect(firstBlock).toEqual(albumATrackIds);
    expect(secondBlock).toEqual(albumBTrackIds);
  });

  itPlayback('two albums shuffle:albums keeps contiguous blocks but order may swap', async () => {
    await clearPlayQueue();
    await playAlbums({
      albumIds: [albumIdA, albumIdB],
      mode: 'replace',
      shuffle: 'albums',
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length + albumBTrackIds.length;
    });

    const queue = await getPlayQueue();
    const ids = queue.items.map((e) => e.songId);
    expect(queue.length).toBe(albumATrackIds.length + albumBTrackIds.length);

    // Either A-then-B (shuffle landed on input order) or B-then-A.
    const aFirst =
      ids.slice(0, albumATrackIds.length).join(',') === albumATrackIds.join(',') &&
      ids.slice(albumATrackIds.length).join(',') === albumBTrackIds.join(',');
    const bFirst =
      ids.slice(0, albumBTrackIds.length).join(',') === albumBTrackIds.join(',') &&
      ids.slice(albumBTrackIds.length).join(',') === albumATrackIds.join(',');

    expect(aFirst || bFirst).toBe(true);
  });

  itPlayback('two albums shuffle:songs interleaves across album boundaries', async () => {
    // Both albums need >= 3 tracks for the no-contiguous-block check to be
    // meaningful (per SPEC).
    if (albumATrackIds.length < 3 || albumBTrackIds.length < 3) {
      return;
    }

    const result = await runSongShuffle();
    let ids = result.items.map((e) => e.songId);

    // Multiset equality
    const expectedSet = new Set([...albumATrackIds, ...albumBTrackIds]);
    expect(new Set(ids.filter((x): x is string => x !== null))).toEqual(expectedSet);

    // No contiguous block of albumATrackIds.length items all from album A
    // at positions 0..albumATrackIds.length-1. Probabilistic: allow one retry.
    if (looksContiguousByAlbum(ids, albumATrackIds.length)) {
      const retry = await runSongShuffle();
      ids = retry.items.map((e) => e.songId);
      expect(new Set(ids.filter((x): x is string => x !== null))).toEqual(expectedSet);
      expect(looksContiguousByAlbum(ids, albumATrackIds.length)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Append mode
  // -------------------------------------------------------------------------

  itPlayback('append mode preserves the currently-playing track', async () => {
    const before = await nowPlaying();
    expect(before.queueIndex).toBe(0);
    const initialLength = before.queueLength as number;
    expect(initialLength).toBeGreaterThan(0);

    await playAlbums({
      albumIds: [albumIdA],
      mode: 'append',
      shuffle: 'none',
    });

    await waitFor(async () => {
      const np = await nowPlaying();
      return (np.queueLength ?? 0) === initialLength + albumATrackIds.length;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(initialLength + albumATrackIds.length);
    expect(queue.currentIndex).toBe(0);
    // First initialLength tracks are unchanged: we know the prefix is
    // [...albumATrackIds, ...albumBTrackIds] from the beforeEach load
    expect(queue.items.slice(0, initialLength).map((e) => e.songId)).toEqual([
      ...albumATrackIds,
      ...albumBTrackIds,
    ]);
    // Appended block matches album A's natural-order tracks
    expect(queue.items.slice(initialLength).map((e) => e.songId)).toEqual(albumATrackIds);
  });

  // -------------------------------------------------------------------------
  // Schema-level rejection
  // -------------------------------------------------------------------------

  itPlayback('empty albumIds is rejected by schema', async () => {
    await expect(
      playAlbums({ albumIds: [], mode: 'replace', shuffle: 'none' })
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Replace queue with shuffle:'songs' across both test albums and wait for
   * mpv to settle. Returns the queue snapshot. Used by the song-shuffle
   * test which allows one retry on probabilistic same-block coincidence.
   */
  async function runSongShuffle(): Promise<Awaited<ReturnType<typeof getPlayQueue>>> {
    await clearPlayQueue();
    await playAlbums({
      albumIds: [albumIdA, albumIdB],
      mode: 'replace',
      shuffle: 'songs',
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length + albumBTrackIds.length;
    });
    return getPlayQueue();
  }

  /**
   * Detect whether the first `aLen` items in the queue are all from album A
   * — that's the "contiguous block" failure case for shuffle:'songs'.
   * The full inverse (last `aLen` items are A, or any single contiguous A
   * block) is more conservative; we follow SPEC which calls out the
   * "first aLen items" case specifically.
   */
  function looksContiguousByAlbum(ids: (string | null)[], aLen: number): boolean {
    const aSet = new Set(albumATrackIds);
    const head = ids.slice(0, aLen);
    return head.every((id) => id !== null && aSet.has(id));
  }
});
