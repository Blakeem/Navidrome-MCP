/**
 * Navidrome MCP Server - play_albums + queue manipulation integration tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
    albumATrackIds = await getAlbumTrackIds(albumIdA);
    albumBTrackIds = await getAlbumTrackIds(albumIdB);
    if (albumATrackIds.length === 0 || albumBTrackIds.length === 0) {
      throw new Error('beforeAll: test albums resolved to empty track lists');
    }
  });

  beforeEach(async () => {
    await clearPlayQueue();
    await playAlbums({
      albumIds: [albumIdA, albumIdB],
      mode: 'replace',
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length + albumBTrackIds.length;
    });
  });

  itPlayback('single album no shuffle queues all tracks in API natural order', async () => {
    await clearPlayQueue();
    const result = await playAlbums({
      albumIds: [albumIdA],
      mode: 'replace',
    });
    expect(result.albumCount).toBe(1);
    expect(result.trackCount).toBe(albumATrackIds.length);

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(albumATrackIds.length);
    expect(queue.items.map((e) => e.songId)).toEqual(albumATrackIds);
  });

  itPlayback('single album shuffleSongs preserves multiset, may differ in order', async () => {
    if (albumATrackIds.length < 2) {
      return;
    }
    await clearPlayQueue();
    await playAlbums({ albumIds: [albumIdA], mode: 'replace', shuffleSongs: true });
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

  itPlayback('two albums no shuffle preserves contiguous album blocks', async () => {
    const queue = await getPlayQueue();
    expect(queue.length).toBe(albumATrackIds.length + albumBTrackIds.length);

    const ids = queue.items.map((e) => e.songId);
    // fetchAlbumSetSongs reads albums in name order, so this also guards its input-order restore.
    const firstBlock = ids.slice(0, albumATrackIds.length);
    const secondBlock = ids.slice(albumATrackIds.length);
    expect(firstBlock).toEqual(albumATrackIds);
    expect(secondBlock).toEqual(albumBTrackIds);
  });

  itPlayback('two albums shuffleAlbums keeps contiguous blocks but order may swap', async () => {
    await clearPlayQueue();
    await playAlbums({
      albumIds: [albumIdA, albumIdB],
      mode: 'replace',
      shuffleAlbums: true,
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length + albumBTrackIds.length;
    });

    const queue = await getPlayQueue();
    const ids = queue.items.map((e) => e.songId);
    expect(queue.length).toBe(albumATrackIds.length + albumBTrackIds.length);

    const aFirst =
      ids.slice(0, albumATrackIds.length).join(',') === albumATrackIds.join(',') &&
      ids.slice(albumATrackIds.length).join(',') === albumBTrackIds.join(',');
    const bFirst =
      ids.slice(0, albumBTrackIds.length).join(',') === albumBTrackIds.join(',') &&
      ids.slice(albumBTrackIds.length).join(',') === albumATrackIds.join(',');

    expect(aFirst || bFirst).toBe(true);
  });

  itPlayback('two albums shuffleSongs interleaves across album boundaries', async () => {
    // Below 3 tracks per album, a fair shuffle puts album A first often enough to fail the check.
    if (albumATrackIds.length < 3 || albumBTrackIds.length < 3) {
      return;
    }

    const result = await runSongShuffle();
    let ids = result.items.map((e) => e.songId);

    const expectedSet = new Set([...albumATrackIds, ...albumBTrackIds]);
    expect(new Set(ids.filter((x): x is string => x !== null))).toEqual(expectedSet);

    // A fair shuffle can still put album A first, so one retry keeps false failures rare.
    if (looksContiguousByAlbum(ids, albumATrackIds.length)) {
      const retry = await runSongShuffle();
      ids = retry.items.map((e) => e.songId);
      expect(new Set(ids.filter((x): x is string => x !== null))).toEqual(expectedSet);
      expect(looksContiguousByAlbum(ids, albumATrackIds.length)).toBe(false);
    }
  });

  itPlayback('append mode preserves the currently-playing track', async () => {
    const before = await nowPlaying();
    expect(before.queueIndex).toBe(0);
    const initialLength = before.queueLength as number;
    expect(initialLength).toBeGreaterThan(0);

    await playAlbums({
      albumIds: [albumIdA],
      mode: 'append',
    });

    await waitFor(async () => {
      const np = await nowPlaying();
      return (np.queueLength ?? 0) === initialLength + albumATrackIds.length;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(initialLength + albumATrackIds.length);
    expect(queue.currentIndex).toBe(0);
    expect(queue.items.slice(0, initialLength).map((e) => e.songId)).toEqual([
      ...albumATrackIds,
      ...albumBTrackIds,
    ]);
    expect(queue.items.slice(initialLength).map((e) => e.songId)).toEqual(albumATrackIds);
  });

  itPlayback('empty albumIds is rejected by schema', async () => {
    await expect(
      playAlbums({ albumIds: [], mode: 'replace' })
    ).rejects.toThrow();
  });

  async function runSongShuffle(): Promise<Awaited<ReturnType<typeof getPlayQueue>>> {
    await clearPlayQueue();
    await playAlbums({
      albumIds: [albumIdA, albumIdB],
      mode: 'replace',
      shuffleSongs: true,
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === albumATrackIds.length + albumBTrackIds.length;
    });
    return getPlayQueue();
  }

  /** Only the leading block is checked, since an unshuffled load puts album A first. */
  function looksContiguousByAlbum(ids: (string | null)[], aLen: number): boolean {
    const aSet = new Set(albumATrackIds);
    const head = ids.slice(0, aLen);
    return head.every((id) => id !== null && aSet.has(id));
  }
});
