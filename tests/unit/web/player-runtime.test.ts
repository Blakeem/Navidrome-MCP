/**
 * Navidrome MCP Server - Player runtime unit tests
 * Copyright (C) 2025
 *
 * Covers the live persist flag and theme accessors.
 */

import { describe, expect, it } from 'vitest';

import {
  getPersist,
  getTheme,
  setPersist,
  setTheme,
  shouldStopForMcpExit,
} from '../../../src/web/player-runtime.js';

describe('persist flag', () => {
  it('set / get round-trip', () => {
    setPersist(true);
    expect(getPersist()).toBe(true);
    setPersist(false);
    expect(getPersist()).toBe(false);
  });
});

describe('shouldStopForMcpExit', () => {
  const lastMcpGone = { launchedByMcp: true, parentConnected: false, openLeases: 0, persist: false };

  it('stops an MCP-launched player once its spawner is gone and no lease is open', () => {
    expect(shouldStopForMcpExit(lastMcpGone)).toBe(true);
  });

  it.each([
    ['a standalone launch', { launchedByMcp: false }],
    ['a connected spawner', { parentConnected: true }],
    ['an open lease', { openLeases: 1 }],
    ['persist on', { persist: true }],
  ])('keeps running with %s', (_label, change) => {
    expect(shouldStopForMcpExit({ ...lastMcpGone, ...change })).toBe(false);
  });
});

describe('theme', () => {
  it('starts unset, so each device follows its own setting', () => {
    expect(getTheme()).toBeNull();
  });

  it('set / get round-trip, including back to unset', () => {
    setTheme('dark');
    expect(getTheme()).toBe('dark');
    setTheme(null);
    expect(getTheme()).toBeNull();
  });
});
