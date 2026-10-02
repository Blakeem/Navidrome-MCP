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
  initPersist,
  setPersist,
  setTheme,
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
