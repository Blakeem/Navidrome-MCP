/**
 * Navidrome MCP Server - mpv owner-shutdown decision unit tests
 * Copyright (C) 2025
 *
 * Covers the single mpv-shutdown authority (standalone-web spec §8.1): the web
 * port owner keeps mpv when playing (detached, survives a web restart) and
 * kills it when stopped/idle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type IdleReaper,
  type ReaperEngine,
  isGenuinelyIdle,
  nextIdleStreak,
  shouldKillMpvOnOwnerShutdown,
  startIdleReaper,
} from '../../../src/services/playback/shutdown.js';

describe('shouldKillMpvOnOwnerShutdown', () => {
  it('keeps mpv when playing', () => {
    expect(shouldKillMpvOnOwnerShutdown(true)).toBe(false);
  });

  it('kills mpv when not playing', () => {
    expect(shouldKillMpvOnOwnerShutdown(false)).toBe(true);
  });
});

/** Build a fake engine whose cached `idle-active` and running state are scriptable. */
function fakeEngine(initial: { running: boolean; idleActive: unknown }): ReaperEngine & {
  set: (next: Partial<{ running: boolean; idleActive: unknown }>) => void;
  quitCalls: number;
} {
  const state = { ...initial };
  let quitCalls = 0;
  return {
    isRunning: () => state.running,
    getCachedProperty: (name: string) => (name === 'idle-active' ? state.idleActive : undefined),
    quitMpv: async () => {
      quitCalls += 1;
      // After a quit, mpv is gone.
      state.running = false;
      state.idleActive = undefined;
    },
    set: (next) => Object.assign(state, next),
    get quitCalls() {
      return quitCalls;
    },
  };
}

describe('nextIdleStreak', () => {
  it('increments while idle', () => {
    expect(nextIdleStreak(0, true)).toBe(1);
    expect(nextIdleStreak(3, true)).toBe(4);
  });

  it('resets to 0 on a non-idle tick', () => {
    expect(nextIdleStreak(5, false)).toBe(0);
  });
});

describe('isGenuinelyIdle', () => {
  it('is true only for a live mpv with idle-active === true', () => {
    expect(isGenuinelyIdle(fakeEngine({ running: true, idleActive: true }))).toBe(true);
  });

  it('is false when mpv is not running', () => {
    expect(isGenuinelyIdle(fakeEngine({ running: false, idleActive: true }))).toBe(false);
  });

  it('is false when paused mid-track (idle-active false/undefined)', () => {
    expect(isGenuinelyIdle(fakeEngine({ running: true, idleActive: false }))).toBe(false);
    expect(isGenuinelyIdle(fakeEngine({ running: true, idleActive: undefined }))).toBe(false);
  });
});

describe('startIdleReaper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reaps after the configured consecutive-idle window', async () => {
    const engine = fakeEngine({ running: true, idleActive: true });
    const reaper: IdleReaper = startIdleReaper(engine, { intervalMs: 100, ticksToReap: 3 });

    await vi.advanceTimersByTimeAsync(250); // 2 ticks — not yet
    expect(engine.quitCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(100); // 3rd tick — reap
    expect(engine.quitCalls).toBe(1);

    reaper.stop();
  });

  it('does NOT reap a playing mpv (idle-active not true)', async () => {
    const engine = fakeEngine({ running: true, idleActive: false });
    const reaper = startIdleReaper(engine, { intervalMs: 100, ticksToReap: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.quitCalls).toBe(0);
    reaper.stop();
  });

  it('resets the streak when mpv flaps back to playing mid-window', async () => {
    const engine = fakeEngine({ running: true, idleActive: true });
    const reaper = startIdleReaper(engine, { intervalMs: 100, ticksToReap: 3 });

    await vi.advanceTimersByTimeAsync(200); // 2 idle ticks
    engine.set({ idleActive: false }); // played again
    await vi.advanceTimersByTimeAsync(100); // streak resets
    engine.set({ idleActive: true });
    await vi.advanceTimersByTimeAsync(200); // only 2 idle ticks again
    expect(engine.quitCalls).toBe(0);
    reaper.stop();
  });

  it('stops polling after stop()', async () => {
    const engine = fakeEngine({ running: true, idleActive: true });
    const reaper = startIdleReaper(engine, { intervalMs: 100, ticksToReap: 1 });
    reaper.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.quitCalls).toBe(0);
  });
});
