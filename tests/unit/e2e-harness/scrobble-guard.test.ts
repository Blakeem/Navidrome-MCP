/**
 * Navidrome MCP Server - e2e scrobble guard unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHORT_TRACK_SECONDS, ScrobbleGuard, scrobbleTripSeconds } from '../../e2e/harness/scrobble-guard.js';
import type { MpvProbe } from '../../e2e/harness/mpv-probe.js';
import { MAX_THRESHOLD_SECONDS, MIN_DURATION_SECONDS } from '../../../src/services/playback/scrobble-tracker.js';

const SAMPLE_MS = 250;
const TITLE = 'Test track';

/** A probe whose `time-pos` and `duration` the test sets, recording every pause. */
function fakeProbe(state: { position: number | null; duration: number | null }) {
  const pauses: boolean[] = [];
  const probe = {
    isRunning: () => Promise.resolve(true),
    readNumber: (name: string) => Promise.resolve(name === 'time-pos' ? state.position : state.duration),
    read: () => Promise.resolve(TITLE),
    set: (_name: string, value: boolean) => {
      pauses.push(value);
      return Promise.resolve();
    },
    pauseIfRunning: () => Promise.resolve(),
  };
  return { probe: probe as unknown as MpvProbe, pauses };
}

describe('scrobbleTripSeconds', () => {
  it('stays below the scrobble point for short and long tracks', () => {
    expect(scrobbleTripSeconds(100)).toBeLessThan(50);
    expect(scrobbleTripSeconds(3600)).toBeLessThan(MAX_THRESHOLD_SECONDS);
  });
});

describe('ScrobbleGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses mpv and records the trip once a track reaches the trip point', async () => {
    const state = { position: 79, duration: 200 };
    const { probe, pauses } = fakeProbe(state);
    const guard = new ScrobbleGuard(probe);
    guard.start();

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    expect(pauses).toEqual([]);

    state.position = 81;
    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    expect(pauses).toEqual([true]);
    expect(guard.trip).toContain(`"${TITLE}" at 81.0 s of 200.0 s, past 80.0 s`);
    await guard.stop();
  });

  it('pauses again when playback resumes after a trip and keeps the first message', async () => {
    const state = { position: 81, duration: 200 };
    const { probe, pauses } = fakeProbe(state);
    const guard = new ScrobbleGuard(probe);
    guard.start();

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    const firstTrip = guard.trip;
    state.position = 90;
    await vi.advanceTimersByTimeAsync(SAMPLE_MS);

    expect(pauses).toEqual([true, true]);
    expect(guard.trip).toBe(firstTrip);
    await guard.stop();
  });

  it('resolves stop only after a running sample records its trip', async () => {
    const state = { position: 81, duration: 200 };
    const { probe } = fakeProbe(state);
    let releasePosition: () => void = () => undefined;
    probe.readNumber = (name: string) => (name === 'time-pos'
      ? new Promise((resolve) => {
        releasePosition = () => resolve(state.position);
      })
      : Promise.resolve(state.duration));
    const guard = new ScrobbleGuard(probe);
    guard.start();
    await vi.advanceTimersByTimeAsync(SAMPLE_MS);

    let stopped = false;
    const stopping = guard.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    releasePosition();
    await stopping;
    expect(guard.trip).toContain('at 81.0 s of 200.0 s');
  });

  it('lets a track shorter than the short-track margin play past its trip point', async () => {
    const duration = SHORT_TRACK_SECONDS - 1;
    const state = { position: duration - 1, duration };
    const { probe, pauses } = fakeProbe(state);
    const guard = new ScrobbleGuard(probe);
    guard.start();

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    expect(pauses).toEqual([]);
    expect(guard.trip).toBeNull();
    await guard.stop();
  });

  it('guards a track just under the scrobble minimum, since the tracker may hold a longer Navidrome duration', async () => {
    const duration = MIN_DURATION_SECONDS - 0.5;
    const state = { position: scrobbleTripSeconds(duration), duration };
    const { probe, pauses } = fakeProbe(state);
    const guard = new ScrobbleGuard(probe);
    guard.start();

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    expect(pauses).toEqual([true]);
    expect(guard.trip).toContain('of 29.5 s');
    await guard.stop();
  });

  it('trips at the shortest counted track\'s point when mpv reports no duration', async () => {
    const unknownTripPoint = scrobbleTripSeconds(MIN_DURATION_SECONDS);
    const state = { position: unknownTripPoint - 1, duration: null };
    const { probe, pauses } = fakeProbe(state);
    const guard = new ScrobbleGuard(probe);
    guard.start();

    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    expect(pauses).toEqual([]);

    state.position = unknownTripPoint;
    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    expect(pauses).toEqual([true]);
    expect(guard.trip).toContain('of an unknown length');
    await guard.stop();
  });
});
