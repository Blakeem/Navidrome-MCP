/**
 * Navidrome MCP Server - Live Radio Playback Integration Tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeAll, beforeEach, expect } from 'vitest';
import {
  clearPlayQueue,
  describePlayback,
  getPlayQueue,
  getTestRadioStationId,
  getTestSongIds,
  itPlayback,
  nowPlaying,
  playRadioStation,
  playSongs,
  setupClientAndConfig,
  waitFor,
} from './helpers.js';

describePlayback('play_radio_station + radio/songs mutual exclusion (live)', () => {
  let stationId: string;
  let songIds: string[];

  beforeAll(async () => {
    await setupClientAndConfig();
    stationId = await getTestRadioStationId();
    songIds = await getTestSongIds(3);
  });

  beforeEach(async () => {
    await clearPlayQueue();
  });
  // setup-cleanup.ts clears the queue after this file, so no afterAll is needed.

  itPlayback('loads a radio station as a single-entry queue with songId: null', async () => {
    const result = await playRadioStation({ stationId });

    expect(result.success).toBe(true);
    expect(typeof result.station.name).toBe('string');
    expect(typeof result.station.streamUrl).toBe('string');

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 1;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(1);
    expect(queue.items.length).toBe(1);
    const entry = queue.items[0]!;
    // hasRadioStream detects radio by a null songId, so the append demotion depends on it.
    expect(entry.songId).toBeNull();
    // A song's stream URL discloses the LAN host, so no queue item carries a filename.
    expect(entry).not.toHaveProperty('filename');
    expect(entry.isCurrent).toBe(true);
  });

  itPlayback('now_playing surfaces isRadio + radioStation name when radio is loaded', async () => {
    const result = await playRadioStation({ stationId });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 1 && np.isRadio === true;
    });

    const np = await nowPlaying();
    expect(np.engineRunning).toBe(true);
    expect(np.queueLength).toBe(1);
    expect(np.isRadio).toBe(true);
    expect(np.radioStation).toBeDefined();
    expect(np.radioStation?.name).toBe(result.station.name);
  });

  itPlayback('play_songs replace while radio plays → radio replaced with songs', async () => {
    await playRadioStation({ stationId });
    await waitFor(async () => (await nowPlaying()).queueLength === 1);

    await playSongs({ songIds, mode: 'replace' });

    await waitFor(async () => (await nowPlaying()).queueLength === songIds.length);

    const queue = await getPlayQueue();
    expect(queue.length).toBe(songIds.length);
    expect(queue.items.every(e => e.songId !== null)).toBe(true);

    const np = await nowPlaying();
    expect(np.isRadio).toBeUndefined();
    expect(np.radioStation).toBeUndefined();
  });

  itPlayback('play_songs APPEND while radio plays → demoted to replace; radio gone', async () => {
    await playRadioStation({ stationId });
    await waitFor(async () => (await nowPlaying()).queueLength === 1);

    await playSongs({ songIds, mode: 'append' });

    await waitFor(async () => (await nowPlaying()).queueLength === songIds.length);

    const queue = await getPlayQueue();
    expect(queue.length).toBe(songIds.length);
    expect(queue.items.every(e => e.songId !== null)).toBe(true);

    const np = await nowPlaying();
    expect(np.isRadio).toBeUndefined();
  });

  itPlayback('play_radio_station while songs are playing → songs replaced with radio', async () => {
    await playSongs({ songIds, mode: 'replace' });
    await waitFor(async () => (await nowPlaying()).queueLength === songIds.length);

    const result = await playRadioStation({ stationId });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 1 && np.isRadio === true;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(1);
    expect(queue.items[0]!.songId).toBeNull();
    expect(queue.items[0]).not.toHaveProperty('filename');

    const np = await nowPlaying();
    expect(np.isRadio).toBe(true);
    expect(np.radioStation?.name).toBe(result.station.name);
  });

  itPlayback('invalid station ID throws via ErrorFormatter', async () => {
    await expect(
      playRadioStation({ stationId: 'this-station-id-does-not-exist-xyz12345' }),
    ).rejects.toThrow();
  });
});
