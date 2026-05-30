/**
 * Navidrome MCP Server - Player runtime unit tests
 * Copyright (C) 2025
 *
 * Covers the persist flag accessors and the pure power/settings affordance
 * decision (lifecycle §B.1).
 */

import { describe, expect, it } from 'vitest';

import {
  type PlayerFlags,
  computePlayerFlags,
  getPersist,
  initPersist,
  setPersist,
} from '../../../src/web/player-runtime.js';

describe('persist flag', () => {
  it('init / get / set round-trip', () => {
    initPersist(true);
    expect(getPersist()).toBe(true);
    setPersist(false);
    expect(getPersist()).toBe(false);
    initPersist(false); // restore for other tests in the file
  });
});

describe('computePlayerFlags', () => {
  it('hides everything for a non-local (LAN) caller', () => {
    const f: PlayerFlags = computePlayerFlags({ isLocal: false, hasLiveParent: false, persist: true });
    expect(f).toEqual({ canEditSettings: false, canPowerOff: false });
  });

  it('local + no live parent (standalone, or MCP already gone) → power offered', () => {
    expect(computePlayerFlags({ isLocal: true, hasLiveParent: false, persist: false })).toEqual({
      canEditSettings: true,
      canPowerOff: true,
    });
  });

  it('local + live MCP parent + persist OFF → power hidden (MCP owns teardown)', () => {
    expect(computePlayerFlags({ isLocal: true, hasLiveParent: true, persist: false })).toEqual({
      canEditSettings: true,
      canPowerOff: false,
    });
  });

  it('local + live MCP parent + persist ON → power offered (it will survive MCP)', () => {
    expect(computePlayerFlags({ isLocal: true, hasLiveParent: true, persist: true })).toEqual({
      canEditSettings: true,
      canPowerOff: true,
    });
  });
});
