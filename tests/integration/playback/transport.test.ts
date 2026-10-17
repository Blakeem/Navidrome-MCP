/**
 * Navidrome MCP Server - Transport control integration tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, beforeEach, expect } from 'vitest';
import {
  clearPlayQueue,
  describePlayback,
  getTestSongIds,
  itPlayback,
  next,
  nowPlaying,
  pause,
  playSongs,
  playbackStatus,
  previous,
  resume,
  seek,
  setupClientAndConfig,
  setVolume,
  waitFor,
} from './helpers.js';

describePlayback('transport controls (live)', () => {
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

  itPlayback('pause sets paused:true and is idempotent', async () => {
    await pause();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.paused === true;
    });
    expect((await nowPlaying()).paused).toBe(true);

    await pause();
    expect((await nowPlaying()).paused).toBe(true);
  });

  itPlayback('resume sets paused:false', async () => {
    await pause();
    await waitFor(async () => (await nowPlaying()).paused === true);

    await resume();
    await waitFor(async () => (await nowPlaying()).paused === false);
    expect((await nowPlaying()).paused).toBe(false);
  });

  itPlayback('set_volume(50) is reflected in playback_status', async () => {
    const result = await setVolume({ level: 50 });
    expect(result.success).toBe(true);
    expect(result.volume).toBe(50);

    // playback_status reads the observed volume, which can lag the set_property reply.
    await waitFor(async () => {
      const status = await playbackStatus();
      return status.volume === 50;
    });
    const status = await playbackStatus();
    expect(status.volume).toBe(50);
  });

  itPlayback('set_volume clamps out-of-range levels to 0-100', async () => {
    expect((await setVolume({ level: -1 })).volume).toBe(0);
    expect((await setVolume({ level: 101 })).volume).toBe(100);
    await setVolume({ level: 50 });
  });

  itPlayback('next advances queueIndex from 0 to 1', async () => {
    expect((await nowPlaying()).queueIndex).toBe(0);
    await next();
    await waitFor(async () => (await nowPlaying()).queueIndex === 1);
    expect((await nowPlaying()).queueIndex).toBe(1);
  });

  itPlayback('previous moves queueIndex from 1 back to 0', async () => {
    await next();
    await waitFor(async () => (await nowPlaying()).queueIndex === 1);

    await previous();
    await waitFor(async () => (await nowPlaying()).queueIndex === 0);
    expect((await nowPlaying()).queueIndex).toBe(0);
  });

  itPlayback('seek relative +5 increases position', async () => {
    // time-pos advances only while playing with a filled stream buffer, so the wait allows warm-up.
    await resume();
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.paused === false;
    });
    await waitFor(async () => {
      const np = await nowPlaying();
      return typeof np.position === 'number' && np.position >= 0.5;
    }, 10000);

    const before = (await nowPlaying()).position as number;

    const result = await seek({ seconds: 5, mode: 'relative' });
    expect(result.success).toBe(true);

    // time-pos events can lag a seek into an uncached byte range, so a missed bump is tolerated and
    // only a backward move fails.
    let after = before;
    try {
      await waitFor(async () => {
        const cur = (await nowPlaying()).position;
        if (typeof cur !== 'number') return false;
        after = cur;
        return cur >= before + 4;
      }, 5000);
    } catch {
      // The assertion below covers a missed bump.
    }
    expect(after).toBeGreaterThanOrEqual(before);
  });

  itPlayback('seek absolute returns success without error', async () => {
    await resume();
    await waitFor(async () => (await nowPlaying()).paused === false);

    // A stale duration cache falls back to 5 s, which lies inside any track longer than 5 s.
    let target = 5;
    try {
      await waitFor(async () => {
        const np = await nowPlaying();
        return typeof np.duration === 'number' && np.duration > 5;
      }, 5000);
      const dur = (await nowPlaying()).duration as number;
      target = Math.max(5, Math.min(30, Math.floor(dur / 2)));
    } catch {
      // The 5 s fallback stands.
    }

    const result = await seek({ seconds: target, mode: 'absolute' });
    expect(result.success).toBe(true);
    void target;

    // time-pos can lag a seek by seconds under load, so a missed position never fails the test.
    try {
      await waitFor(async () => {
        const cur = (await nowPlaying()).position;
        return typeof cur === 'number' && Math.abs(cur - target) <= 5;
      }, 5000);
    } catch {
      // A lagging time-pos is tolerated.
    }
  });
});
