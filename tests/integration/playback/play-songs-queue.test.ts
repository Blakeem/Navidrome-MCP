/**
 * Navidrome MCP Server - play_songs + queue manipulation integration tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, beforeEach, expect } from 'vitest';
import {
  clearPlayQueue,
  describePlayback,
  getPlayQueue,
  getTestSongIds,
  itPlayback,
  moveInPlayQueue,
  next,
  nowPlaying,
  pause,
  playSongs,
  removeFromPlayQueue,
  resume,
  setupClientAndConfig,
  shufflePlayQueue,
  waitFor,
} from './helpers.js';

describePlayback('play_songs + queue manipulation (live)', () => {
  // Fetched once per file, since each fixture read is a live Navidrome call.
  let songIdsA: string[] = [];
  let songIdsB: string[] = [];

  async function runShuffledReplace(): Promise<Awaited<ReturnType<typeof getPlayQueue>>> {
    await playSongs({ songIds: songIdsA, mode: 'replace', shuffle: true });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 5;
    });
    return getPlayQueue();
  }

  beforeAll(async () => {
    await setupClientAndConfig();
    // One 8-song read keeps the replace and append batches disjoint, so assertions can match by ID.
    const all = await getTestSongIds(8);
    songIdsA = all.slice(0, 5);
    songIdsB = all.slice(5, 8);
  });

  beforeEach(async () => {
    await clearPlayQueue();
    await playSongs({ songIds: songIdsA, mode: 'replace' });
    // now_playing reads mpv's observed playlist-count, which lags the load.
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 5 && np.queueIndex === 0;
    });
  });

  itPlayback('replace mode loads N tracks at idx 0 with currentIndex 0', async () => {
    const queue = await getPlayQueue();
    expect(queue.length).toBe(5);
    expect(queue.currentIndex).toBe(0);
    expect(queue.items).toHaveLength(5);

    for (let i = 0; i < queue.items.length; i++) {
      expect(queue.items[i]?.index).toBe(i);
    }

    const currentItems = queue.items.filter((e) => e.isCurrent);
    expect(currentItems).toHaveLength(1);
    expect(currentItems[0]?.index).toBe(0);

    const queueSongIds = queue.items.map((e) => e.songId);
    expect(queueSongIds).toEqual(songIdsA);
  });

  itPlayback('append mode preserves current track and grows the queue by N', async () => {
    const before = await nowPlaying();
    expect(before.queueIndex).toBe(0);
    expect(before.queueLength).toBe(5);

    await playSongs({ songIds: songIdsB, mode: 'append' });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 5 + songIdsB.length;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(5 + songIdsB.length);
    expect(queue.currentIndex).toBe(0);

    expect(queue.items.slice(0, 5).map((e) => e.songId)).toEqual(songIdsA);
    expect(queue.items.slice(5).map((e) => e.songId)).toEqual(songIdsB);
  });

  itPlayback('replace + shuffle:true permutes input but preserves the multiset', async () => {
    const queue1 = await runShuffledReplace();
    const matchedExactOrder = queue1.items.map((e) => e.songId).join(',') === songIdsA.join(',');

    if (!matchedExactOrder) {
      const ids = queue1.items.map((e) => e.songId).filter((id): id is string => id !== null);
      expect(new Set(ids)).toEqual(new Set(songIdsA));
      return;
    }

    // Fisher-Yates returns the input order with probability 1/120 at N=5, so one retry is allowed.
    const queue2 = await runShuffledReplace();
    const ids = queue2.items.map((e) => e.songId).filter((id): id is string => id !== null);
    expect(new Set(ids)).toEqual(new Set(songIdsA));
    expect(queue2.items.map((e) => e.songId).join(',')).not.toBe(songIdsA.join(','));
  });

  itPlayback('append + shuffle:true only shuffles the appended batch', async () => {
    const appendIds = await getTestSongIds(5);

    await playSongs({ songIds: appendIds, mode: 'append', shuffle: true });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 10;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(10);
    expect(queue.currentIndex).toBe(0);

    expect(queue.items.slice(0, 5).map((e) => e.songId)).toEqual(songIdsA);

    const tailIds = queue.items
      .slice(5)
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);
    expect(new Set(tailIds)).toEqual(new Set(appendIds));
  });

  itPlayback('get_play_queue length matches now_playing.queueLength', async () => {
    const queue = await getPlayQueue();
    const np = await nowPlaying();
    expect(queue.length).toBe(np.queueLength);
  });

  itPlayback('get_play_queue returns parsed songIds and exactly one isCurrent flag', async () => {
    const queue = await getPlayQueue();
    expect(queue.length).toBe(5);

    // stripInternalFields keeps the stream URL, which discloses the LAN host, off every queue item.
    for (const item of queue.items) {
      expect(item.songId).toMatch(/^[A-Za-z0-9-]+$/);
      expect(item).not.toHaveProperty('filename');
    }

    const currents = queue.items.filter((e) => e.isCurrent);
    expect(currents).toHaveLength(1);
    expect(queue.currentIndex).toBe(currents[0]?.index);
  });

  itPlayback('shuffle_play_queue keeps the current track playing and lifts it to index 0', async () => {
    const before = await getPlayQueue();
    const beforeIds = before.items.map((e) => e.songId);
    const wasPlayingSongId = before.items.find((e) => e.isCurrent)?.songId;
    expect(wasPlayingSongId).toBeTruthy();

    await shufflePlayQueue();

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueIndex === 0;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(before.length);
    expect(after.currentIndex).toBe(0);

    const afterIds = after.items.map((e) => e.songId);
    expect(new Set(afterIds)).toEqual(new Set(beforeIds));

    const current = after.items.find((e) => e.isCurrent);
    expect(current?.songId).toBe(wasPlayingSongId);
    expect(after.items[0]?.songId).toBe(wasPlayingSongId);
  });

  itPlayback('shuffle_play_queue preserves pause state across the shuffle', async () => {
    await pause();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.paused === true;
    });

    await shufflePlayQueue();

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueIndex === 0 && np.paused === true;
    });

    const np = await nowPlaying();
    expect(np.paused).toBe(true);
    expect(np.queueIndex).toBe(0);
  });

  itPlayback('move_in_play_queue with from===to is a noop', async () => {
    const before = await getPlayQueue();
    const beforeIds = before.items.map((e) => e.songId);

    const result = await moveInPlayQueue({ from: 2, to: 2 });
    expect(result).toEqual({ success: true, noop: true });

    const after = await getPlayQueue();
    expect(after.items.map((e) => e.songId)).toEqual(beforeIds);
    expect(after.currentIndex).toBe(before.currentIndex);
  });

  itPlayback('move_in_play_queue with to:0 lifts source to top but keeps the current track playing', async () => {
    const before = await getPlayQueue();
    const wasPlayingSongId = before.items.find((e) => e.isCurrent)?.songId;
    const movedSongId = before.items[3]?.songId;
    expect(wasPlayingSongId).toBeTruthy();
    expect(movedSongId).toBeTruthy();
    expect(before.currentIndex).toBe(0);

    await moveInPlayQueue({ from: 3, to: 0 });

    // mpv applies playlist-move before replying, and get_play_queue reads live, so nothing waits.
    const after = await getPlayQueue();
    expect(after.length).toBe(5);
    expect(after.items[0]?.songId).toBe(movedSongId);
    const current = after.items.find((e) => e.isCurrent);
    expect(current?.songId).toBe(wasPlayingSongId);
    expect(current?.songId).not.toBe(movedSongId);
    expect(after.currentIndex).toBe(1);
  });

  itPlayback('move_in_play_queue with from:0 moves the current track and the play head follows it', async () => {
    const before = await getPlayQueue();
    const wasPlayingSongId = before.items[0]?.songId;
    const wasIdx1SongId = before.items[1]?.songId;
    expect(wasPlayingSongId).toBeTruthy();
    expect(wasIdx1SongId).toBeTruthy();
    expect(before.currentIndex).toBe(0);

    await moveInPlayQueue({ from: 0, to: 4 });

    const after = await getPlayQueue();
    expect(after.length).toBe(5);
    // `to` is the final index, which the tool maps to mpv's insert-before target on a forward move.
    const current = after.items.find((e) => e.isCurrent);
    expect(current?.songId).toBe(wasPlayingSongId);
    expect(after.currentIndex).toBe(4);
    expect(after.items[4]?.songId).toBe(wasPlayingSongId);
    expect(after.items[0]?.songId).toBe(wasIdx1SongId);
    expect(after.items[0]?.isCurrent).toBe(false);
  });

  itPlayback('move_in_play_queue out of range throws via ErrorFormatter', async () => {
    await expect(moveInPlayQueue({ from: 99, to: 0 })).rejects.toThrow();
  });

  itPlayback('move_in_play_queue rejects a to past the last index', async () => {
    await expect(moveInPlayQueue({ from: 0, to: 5 })).rejects.toThrow(/past the last queue index/);
  });

  itPlayback('move_in_play_queue from:2 to:4 leaves currentIndex unchanged', async () => {
    const before = await getPlayQueue();
    const movingId = before.items[2]?.songId;
    expect(movingId).toBeTruthy();
    expect(before.currentIndex).toBe(0);

    await moveInPlayQueue({ from: 2, to: 4 });

    const after = await getPlayQueue();
    expect(after.length).toBe(5);
    const movedIndex = after.items.findIndex((e) => e.songId === movingId);
    expect(movedIndex).toBe(4);
    expect(after.currentIndex).toBe(0);
  });

  itPlayback('remove_from_play_queue current track auto-advances mpv', async () => {
    const before = await getPlayQueue();
    const currentSongId = before.items[0]?.songId;
    const nextSongId = before.items[1]?.songId;
    expect(currentSongId).toBeTruthy();
    expect(nextSongId).toBeTruthy();

    await removeFromPlayQueue({ index: 0 });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 4;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(4);

    expect(after.items[0]?.songId).toBe(nextSongId);
    const current = after.items.find((e) => e.isCurrent);
    expect(current?.songId).toBe(nextSongId);
  });

  itPlayback('remove_from_play_queue non-current entry does not change current track', async () => {
    const before = await getPlayQueue();
    const currentSongId = before.items[0]?.songId;
    expect(currentSongId).toBeTruthy();

    await removeFromPlayQueue({ index: 3 });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 4;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(4);
    const current = after.items.find((e) => e.isCurrent);
    expect(current?.songId).toBe(currentSongId);
  });

  itPlayback('remove_from_play_queue last item leaves queue empty/idle', async () => {
    await clearPlayQueue();
    await playSongs({ songIds: [songIdsA[0] as string], mode: 'replace' });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 1;
    });

    await removeFromPlayQueue({ index: 0 });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 0;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(0);
    expect(queue.items).toHaveLength(0);
  });

  itPlayback('clear_play_queue empties the queue and halts playback', async () => {
    await clearPlayQueue();

    await waitFor(async () => {
      const np = await nowPlaying();
      // mpv `stop` empties the playlist and sets playlist-pos to -1.
      return np.queueLength === 0 && np.queueIndex === -1;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(0);
    expect(queue.currentIndex).toBeUndefined();

    const np = await nowPlaying();
    expect(np.queueLength).toBe(0);
    expect(np.queueIndex).toBe(-1);
  });

  itPlayback('clear_play_queue is idempotent on an already-empty queue', async () => {
    await clearPlayQueue();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 0;
    });

    const result = await clearPlayQueue();
    expect(result).toEqual({ success: true });

    const np = await nowPlaying();
    expect(np.queueLength).toBe(0);
  });

  itPlayback('cross-tool flow: play 5 → next → pause → resume → clear', async () => {
    let np = await nowPlaying();
    expect(np.queueIndex).toBe(0);
    expect(np.queueLength).toBe(5);

    await next();
    await waitFor(async () => {
      const cur = await nowPlaying();
      return cur.queueIndex === 1;
    });
    np = await nowPlaying();
    expect(np.queueIndex).toBe(1);

    await pause();
    await waitFor(async () => {
      const cur = await nowPlaying();
      return cur.paused === true;
    });
    np = await nowPlaying();
    expect(np.paused).toBe(true);

    await resume();
    await waitFor(async () => {
      const cur = await nowPlaying();
      return cur.paused === false;
    });
    np = await nowPlaying();
    expect(np.paused).toBe(false);

    await clearPlayQueue();
    await waitFor(async () => {
      const cur = await nowPlaying();
      return cur.queueLength === 0;
    });
    const queue = await getPlayQueue();
    expect(queue.length).toBe(0);
  });
});
