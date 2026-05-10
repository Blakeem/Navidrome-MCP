/**
 * Navidrome MCP Server - Live Radio Playback Integration Tests
 * Copyright (C) 2025
 *
 * Verifies the end-to-end behavior of `play_radio_station` against a real
 * mpv process and a real Navidrome library. Specifically covers:
 *
 *   1. Radio loads as a single-entry queue with `songId === null`
 *      (the recognition signal used by the mutual-exclusion logic)
 *   2. `now_playing` surfaces `isRadio: true` and `radioStation.name`
 *   3. Radio mutual exclusion in BOTH directions:
 *        a. song-replace and song-append while radio plays → radio is gone
 *           (append demoted to replace by the engine)
 *        b. radio-play while songs play → songs are gone
 *   4. Invalid station ID surfaces an error
 *
 * Tests are skipped cleanly when mpv isn't installed OR Navidrome isn't
 * reachable. `clearPlayQueue` runs in beforeEach to ensure a known starting
 * state.
 */

import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
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
    // One station + a small song set for the mutual-exclusion tests
    stationId = await getTestRadioStationId();
    songIds = await getTestSongIds(3);
  });

  beforeEach(async () => {
    await clearPlayQueue();
  });

  afterAll(async () => {
    // Don't leave a radio stream playing after tests finish
    await clearPlayQueue();
  });

  itPlayback('loads a radio station as a single-entry queue with songId: null', async () => {
    const result = await playRadioStation({ id: stationId });

    expect(result.success).toBe(true);
    expect(result.station.id).toBe(stationId);
    expect(typeof result.station.name).toBe('string');
    expect(typeof result.station.streamUrl).toBe('string');

    // Wait for mpv's playlist-count cache to reflect the new queue
    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 1;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(1);
    expect(queue.items.length).toBe(1);
    const entry = queue.items[0]!;
    // The defining radio signal: stream URL doesn't carry a Navidrome songId
    expect(entry.songId).toBeNull();
    // The filename mpv stored should be the streamUrl we passed
    expect(entry.filename).toBe(result.station.streamUrl);
    expect(entry.isCurrent).toBe(true);
  });

  itPlayback('now_playing surfaces isRadio + radioStation name when radio is loaded', async () => {
    const result = await playRadioStation({ id: stationId });

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
    // Set up: radio is playing
    await playRadioStation({ id: stationId });
    await waitFor(async () => (await nowPlaying()).queueLength === 1);

    // Action: replace with songs
    await playSongs({ songIds, mode: 'replace' });

    await waitFor(async () => (await nowPlaying()).queueLength === songIds.length);

    const queue = await getPlayQueue();
    expect(queue.length).toBe(songIds.length);
    // No radio entry should remain
    expect(queue.items.every(e => e.songId !== null)).toBe(true);

    const np = await nowPlaying();
    // Radio context should be cleared
    expect(np.isRadio).toBeUndefined();
    expect(np.radioStation).toBeUndefined();
  });

  itPlayback('play_songs APPEND while radio plays → demoted to replace; radio gone', async () => {
    // Set up: radio is playing
    await playRadioStation({ id: stationId });
    await waitFor(async () => (await nowPlaying()).queueLength === 1);

    // Action: append songs (should be demoted to replace because of radio)
    await playSongs({ songIds, mode: 'append' });

    await waitFor(async () => (await nowPlaying()).queueLength === songIds.length);

    const queue = await getPlayQueue();
    // The radio entry must NOT survive an append-while-radio operation.
    // If demotion logic were missing, the queue would be [radio, ...songs]
    // and length would be songs.length + 1.
    expect(queue.length).toBe(songIds.length);
    expect(queue.items.every(e => e.songId !== null)).toBe(true);

    const np = await nowPlaying();
    expect(np.isRadio).toBeUndefined();
  });

  itPlayback('play_radio_station while songs are playing → songs replaced with radio', async () => {
    // Set up: songs are playing
    await playSongs({ songIds, mode: 'replace' });
    await waitFor(async () => (await nowPlaying()).queueLength === songIds.length);

    // Action: switch to radio
    const result = await playRadioStation({ id: stationId });

    await waitFor(async () => {
      const np = await nowPlaying();
      return np.queueLength === 1 && np.isRadio === true;
    });

    const queue = await getPlayQueue();
    expect(queue.length).toBe(1);
    expect(queue.items[0]!.songId).toBeNull();
    expect(queue.items[0]!.filename).toBe(result.station.streamUrl);

    const np = await nowPlaying();
    expect(np.isRadio).toBe(true);
    expect(np.radioStation?.name).toBe(result.station.name);
  });

  itPlayback('invalid station ID throws via ErrorFormatter', async () => {
    await expect(
      playRadioStation({ id: 'this-station-id-does-not-exist-xyz12345' }),
    ).rejects.toThrow();
  });
});
