/**
 * Navidrome MCP Server - Read state integration tests
 * Copyright (C) 2025
 *
 * Live integration tests for read-only state tools: now_playing,
 * playback_status, and get_play_queue's empty-queue behavior.
 *
 * Note on engine-cold tests: per SPEC, "engineRunning: false" cannot be
 * reproduced once mpv is spawned in this run. Re-spawning a clean engine
 * mid-run would require teardown/respawn machinery this test layer
 * doesn't have. Engine-cold is documented as a manual smoke test below.
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
    // Default state per test: 5-track queue, idx 0, unpaused.
    await clearPlayQueue();
    await playSongs({ songIds, mode: 'replace' });
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 5 && np.queueIndex === 0;
    });
  });

  // -------------------------------------------------------------------------
  // playback_status
  // -------------------------------------------------------------------------

  itPlayback('playback_status reports engineRunning:true with version and volume populated', async () => {
    const status = await playbackStatus();
    expect(status.engineRunning).toBe(true);
    expect(typeof status.mpvVersion).toBe('string');
    expect(status.mpvVersion?.length).toBeGreaterThan(0);
    expect(typeof status.volume).toBe('number');
    // idle is observed-property; should be a boolean once engine has spun up
    expect(typeof status.idle).toBe('boolean');
  });

  // -------------------------------------------------------------------------
  // now_playing
  // -------------------------------------------------------------------------

  itPlayback('now_playing returns full payload when queue is populated', async () => {
    // Wait for mpv to surface metadata (title at minimum) on the cache.
    // metadata is observed-property; can take a moment after loadfile.
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.engineRunning === true && typeof np.queueIndex === 'number';
    });

    const np = await nowPlaying();
    expect(np.engineRunning).toBe(true);
    expect(np.queueIndex).toBe(0);
    expect(np.queueLength).toBe(5);
    // duration / position observe-property may lag a tick after start;
    // assert that they are numbers when present, but don't require both.
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

  // -------------------------------------------------------------------------
  // get_play_queue empty-queue case
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // SKIPPED: engine-cold (engineRunning:false) is not reproducible here.
  //
  // Once the engine has spawned mpv (or attached to an existing instance) in
  // this test process, there is no clean way to rewind to "no engine" state
  // without tearing down mpv globally — which would also disrupt any other
  // user playing music on the same machine. The status tools' cold-state
  // contract (mpvVersion:null, volume:null, idle:null, engineRunning:false)
  // is verified by manual smoke test:
  //
  //   1. `pkill mpv && rm -f /tmp/navidrome-mcp-mpv-*.sock`
  //   2. Restart MCP server
  //   3. Call `playback_status` (and `now_playing`) BEFORE any tool that
  //      lazy-spawns mpv (e.g. before `play_songs`)
  //   4. Confirm engineRunning:false response shape
  //
  // This is documented in the SPEC's open-issues section. Subagent A's
  // recommendation: leave engine-cold as manual until a proper engine
  // teardown helper exists.
  // -------------------------------------------------------------------------
});
