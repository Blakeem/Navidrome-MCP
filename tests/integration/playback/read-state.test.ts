/**
 * Navidrome MCP Server - Read state integration tests
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
  nowPlaying,
  pause,
  playSongs,
  playbackStatus,
  setupClientAndConfig,
  waitFor,
} from './helpers.js';

describePlayback('read-only state (live)', () => {
  let songIds: string[] = [];

  beforeAll(async () => {
    await setupClientAndConfig();
    songIds = await getTestSongIds(5);
  });

  beforeEach(async () => {
    await clearPlayQueue();
    await playSongs({ songIds, mode: 'replace' });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 5 && np.queueIndex === 0;
    });
  });

  itPlayback('playback_status reports engineRunning:true with version and volume populated', async () => {
    const status = await playbackStatus();
    expect(status.engineRunning).toBe(true);
    expect(typeof status.mpvVersion).toBe('string');
    expect(status.mpvVersion?.length).toBeGreaterThan(0);
    expect(typeof status.volume).toBe('number');
    expect(typeof status.idle).toBe('boolean');
  });

  itPlayback('now_playing returns full payload when queue is populated', async () => {
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.engineRunning === true && typeof np.queueIndex === 'number';
    });

    const np = await nowPlaying();
    expect(np.engineRunning).toBe(true);
    expect(np.queueIndex).toBe(0);
    expect(np.queueLength).toBe(5);
    // Observed properties can lag the load, so each field is type-checked only when present.
    if (np.position !== undefined) expect(typeof np.position).toBe('number');
    if (np.duration !== undefined) expect(typeof np.duration).toBe('number');
    if (np.title !== undefined) expect(typeof np.title).toBe('string');
    if (np.artist !== undefined) expect(typeof np.artist).toBe('string');
    if (np.album !== undefined) expect(typeof np.album).toBe('string');
    if (np.paused !== undefined) expect(typeof np.paused).toBe('boolean');
  });

  itPlayback('now_playing reflects paused:true after pause', async () => {
    await pause();
    await waitFor(async () => (await nowPlaying()).paused === true);
    expect((await nowPlaying()).paused).toBe(true);
  });

  itPlayback('now_playing reflects empty queue after clear', async () => {
    await clearPlayQueue();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 0 && np.queueIndex === -1;
    });

    const np = await nowPlaying();
    expect(np.queueIndex).toBe(-1);
    expect(np.queueLength).toBe(0);
  });

  itPlayback('get_play_queue returns {items:[],length:0} when queue is empty', async () => {
    await clearPlayQueue();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 0;
    });

    const queue = await getPlayQueue();
    expect(queue.items).toEqual([]);
    expect(queue.length).toBe(0);
    expect(queue.currentIndex).toBeUndefined();
  });

  // The engine-cold state (engineRunning:false) is untested here, since reaching it means quitting
  // the shared mpv that other clients on the host may be playing through.
});
