/**
 * Navidrome MCP Server - play_songs + queue manipulation integration tests
 * Copyright (C) 2025
 *
 * Live integration tests covering play_songs in conjunction with the
 * queue-management family (get_play_queue, clear_play_queue, shuffle,
 * move, remove). Each test starts with a known 5-track replace-loaded
 * queue so assertions are deterministic.
 *
 * IMPORTANT: these tests touch the local mpv process. They are skipped
 * when mpv isn't installed or Navidrome isn't reachable.
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
  // Fixed pool of song IDs for the entire file run. Pulled once in
  // beforeAll because re-fetching per-test would burn Navidrome calls
  // unnecessarily (Subagent A spec: keep tests fast and read-light).
  let songIdsA: string[] = [];
  let songIdsB: string[] = [];

  /**
   * Replace the queue with songIdsA in shuffled mode and return the
   * resulting queue snapshot. Closes over the suite-scoped `songIdsA` so
   * the shuffle-retry pattern (allowed by SPEC for rare same-order
   * coincidences on N=5) stays readable.
   */
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
    // 5 + 3 distinct song IDs. We don't strictly need them disjoint, but
    // pulling 8 random IDs means the append-vs-replace assertions are
    // unambiguous (we can match by exact ID).
    const all = await getTestSongIds(8);
    songIdsA = all.slice(0, 5);
    songIdsB = all.slice(5, 8);
  });

  beforeEach(async () => {
    // Reset to a known 5-track queue before each test so cases don't bleed.
    await clearPlayQueue();
    await playSongs({ songIds: songIdsA, mode: 'replace' });
    // Wait for mpv's playlist-count to actually update before tests start
    // probing — without this, the first assertion can race the load.
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 5 && np.queueIndex === 0;
    });
  });

  // -------------------------------------------------------------------------
  // play_songs basics
  // -------------------------------------------------------------------------

  itPlayback('replace mode loads N tracks at idx 0 with currentIndex 0', async () => {
    // beforeEach already did the replace; just assert the post-state.
    const queue = await getPlayQueue();
    expect(queue.length).toBe(5);
    expect(queue.currentIndex).toBe(0);
    expect(queue.items).toHaveLength(5);

    // Each entry's index should match its position
    for (let i = 0; i < queue.items.length; i++) {
      expect(queue.items[i]?.index).toBe(i);
    }

    // Exactly one item is current
    const currentItems = queue.items.filter((e) => e.isCurrent);
    expect(currentItems).toHaveLength(1);
    expect(currentItems[0]?.index).toBe(0);

    // songId must be parsed out of the stream URL for every item we loaded
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

    // First 5 entries should still match songIdsA
    expect(queue.items.slice(0, 5).map((e) => e.songId)).toEqual(songIdsA);
    // Last entries should match songIdsB in input order (append, no shuffle)
    expect(queue.items.slice(5).map((e) => e.songId)).toEqual(songIdsB);
  });

  itPlayback('replace + shuffle:true permutes input but preserves the multiset', async () => {
    // Use a fresh batch so replace is meaningful here.
    const queue1 = await runShuffledReplace();
    const matchedExactOrder = queue1.items.map((e) => e.songId).join(',') === songIdsA.join(',');

    if (!matchedExactOrder) {
      // Already proves the shuffle changed the order at least once.
      const ids = queue1.items.map((e) => e.songId).filter((id): id is string => id !== null);
      expect(new Set(ids)).toEqual(new Set(songIdsA));
      return;
    }

    // Fisher-Yates can land on input order with probability 1/120 for N=5.
    // Allow exactly one retry before failing.
    const queue2 = await runShuffledReplace();
    const ids = queue2.items.map((e) => e.songId).filter((id): id is string => id !== null);
    expect(new Set(ids)).toEqual(new Set(songIdsA));
    expect(queue2.items.map((e) => e.songId).join(',')).not.toBe(songIdsA.join(','));
  });

  itPlayback('append + shuffle:true only shuffles the appended batch', async () => {
    // Append a 5-item shuffled batch; the original 5 should be intact at
    // positions 0..4.
    const appendIds = await getTestSongIds(5);

    await playSongs({ songIds: appendIds, mode: 'append', shuffle: true });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 10;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(10);
    expect(queue.currentIndex).toBe(0);

    // First 5 untouched
    expect(queue.items.slice(0, 5).map((e) => e.songId)).toEqual(songIdsA);

    // Last 5 are a permutation of appendIds (multiset equality)
    const tailIds = queue.items
      .slice(5)
      .map((e) => e.songId)
      .filter((id): id is string => id !== null);
    expect(new Set(tailIds)).toEqual(new Set(appendIds));
  });

  // -------------------------------------------------------------------------
  // get_play_queue structural assertions
  // -------------------------------------------------------------------------

  itPlayback('get_play_queue length matches now_playing.queueLength', async () => {
    const queue = await getPlayQueue();
    const np = await nowPlaying();
    expect(queue.length).toBe(np.queueLength);
  });

  itPlayback('get_play_queue returns parsed songIds and exactly one isCurrent flag', async () => {
    const queue = await getPlayQueue();
    expect(queue.length).toBe(5);

    // songId parsed out of the stream URL `id` query parameter
    for (const item of queue.items) {
      expect(item.songId).toMatch(/^[A-Za-z0-9-]+$/);
      expect(item.filename).toContain('id=');
    }

    const currents = queue.items.filter((e) => e.isCurrent);
    expect(currents).toHaveLength(1);
    expect(queue.currentIndex).toBe(currents[0]?.index);
  });

  // -------------------------------------------------------------------------
  // shuffle_play_queue
  // -------------------------------------------------------------------------

  itPlayback('shuffle_play_queue preserves length, multiset, and resets head to 0', async () => {
    const before = await getPlayQueue();
    const beforeIds = before.items.map((e) => e.songId);

    await shufflePlayQueue();

    // Wait for queueIndex to settle to 0 (active-queue contract)
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueIndex === 0;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(before.length);
    expect(after.currentIndex).toBe(0);

    const afterIds = after.items.map((e) => e.songId);
    expect(new Set(afterIds)).toEqual(new Set(beforeIds));
  });

  itPlayback('shuffle_play_queue preserves pause state across the shuffle', async () => {
    await pause();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.paused === true;
    });

    await shufflePlayQueue();

    // Per active-queue contract: head reset to 0, but pause survives.
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueIndex === 0 && np.paused === true;
    });

    const np = await nowPlaying();
    expect(np.paused).toBe(true);
    expect(np.queueIndex).toBe(0);
  });

  // -------------------------------------------------------------------------
  // move_in_play_queue
  // -------------------------------------------------------------------------

  itPlayback('move_in_play_queue with from===to is a noop', async () => {
    const before = await getPlayQueue();
    const beforeIds = before.items.map((e) => e.songId);

    const result = await moveInPlayQueue({ from: 2, to: 2 });
    expect(result).toEqual({ success: true, noop: true });

    const after = await getPlayQueue();
    expect(after.items.map((e) => e.songId)).toEqual(beforeIds);
    expect(after.currentIndex).toBe(before.currentIndex);
  });

  itPlayback('move_in_play_queue with to:0 lifts source to top and plays it', async () => {
    const before = await getPlayQueue();
    const movedSongId = before.items[3]?.songId;
    expect(movedSongId).toBeTruthy();

    await moveInPlayQueue({ from: 3, to: 0 });

    // mpv resets play head to 0 when the move involves index 0
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueIndex === 0;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(5);
    expect(after.items[0]?.songId).toBe(movedSongId);
    expect(after.currentIndex).toBe(0);

    // The currently-flagged item is the moved one (defensive: also check
    // via `isCurrent` flag instead of just `currentIndex`)
    const current = after.items.find((e) => e.isCurrent);
    expect(current?.songId).toBe(movedSongId);
  });

  itPlayback('move_in_play_queue with from:0 places source at destination and resets head', async () => {
    const before = await getPlayQueue();
    const wasCurrentSongId = before.items[0]?.songId;
    const wasIdx1SongId = before.items[1]?.songId;
    expect(wasCurrentSongId).toBeTruthy();
    expect(wasIdx1SongId).toBeTruthy();

    await moveInPlayQueue({ from: 0, to: 4 });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueIndex === 0;
    });

    const after = await getPlayQueue();
    expect(after.length).toBe(5);
    // mpv `playlist-move from to` (forward) inserts the moved entry BEFORE
    // the entry currently at `to` — so for a 5-track queue with from:0, to:4
    // the moved track lands at index 3 (the entry that was at 4 stays put).
    // The originally-current track must still be present somewhere in the
    // queue, just no longer at index 0.
    const movedIndex = after.items.findIndex((e) => e.songId === wasCurrentSongId);
    expect(movedIndex).toBeGreaterThan(0); // Moved away from index 0
    expect(movedIndex).toBeLessThanOrEqual(4); // Within bounds
    // Active-queue contract: queueIndex is 0
    expect(after.currentIndex).toBe(0);
    // What's playing now is the formerly-idx-1 track (it bubbled up to 0)
    expect(after.items[0]?.songId).toBe(wasIdx1SongId);
  });

  itPlayback('move_in_play_queue out of range throws via ErrorFormatter', async () => {
    // mpv rejects out-of-range indices; we surface that as a thrown error.
    await expect(moveInPlayQueue({ from: 99, to: 0 })).rejects.toThrow();
  });

  itPlayback('move_in_play_queue from:2 to:4 leaves currentIndex unchanged', async () => {
    const before = await getPlayQueue();
    const movingId = before.items[2]?.songId;
    expect(movingId).toBeTruthy();
    expect(before.currentIndex).toBe(0);

    await moveInPlayQueue({ from: 2, to: 4 });

    // No active-queue reset because neither index is 0 — no need to wait
    // for queueIndex change. But mpv still needs a beat to update the
    // playlist property; `getPlayQueue` reads via IPC so it observes the
    // post-move state.
    const after = await getPlayQueue();
    expect(after.length).toBe(5);
    // mpv forward-move semantics put the entry BEFORE `to`, so for from:2,
    // to:4 the moved entry lands at index 3.
    const movedIndex = after.items.findIndex((e) => e.songId === movingId);
    expect(movedIndex).toBeGreaterThan(2);
    expect(movedIndex).toBeLessThanOrEqual(4);
    // currentIndex unchanged (lazy is correct when neither index is 0)
    expect(after.currentIndex).toBe(0);
  });

  // -------------------------------------------------------------------------
  // remove_from_play_queue
  // -------------------------------------------------------------------------

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

    // The previously-second track has bubbled up to index 0 and is current
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
    // Reduce to a single-item queue first
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

  // -------------------------------------------------------------------------
  // clear_play_queue
  // -------------------------------------------------------------------------

  itPlayback('clear_play_queue empties the queue and halts playback', async () => {
    await clearPlayQueue();

    await waitFor(async () => {
      const np = await nowPlaying();
      // mpv `stop` zeroes the count and resets queueIndex to -1
      return np.queueLength === 0 && np.queueIndex === -1;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(0);
    expect(queue.currentIndex).toBeUndefined();

    const np = await nowPlaying();
    // After `stop`, mpv is no longer playing audio; pause is also reset to false
    expect(np.queueLength).toBe(0);
    expect(np.queueIndex).toBe(-1);
  });

  itPlayback('clear_play_queue is idempotent on an already-empty queue', async () => {
    await clearPlayQueue();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 0;
    });

    // Second clear should succeed without throwing
    const result = await clearPlayQueue();
    expect(result).toEqual({ success: true });

    const np = await nowPlaying();
    expect(np.queueLength).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Cross-tool integration test (per SPEC)
  // -------------------------------------------------------------------------

  itPlayback('cross-tool flow: play 5 → next → pause → resume → clear', async () => {
    // beforeEach sets up the 5-song queue at idx 0.
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
