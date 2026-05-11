/**
 * Navidrome MCP Server - radio-browser per-session rate-limit tests
 * Copyright (C) 2025
 *
 * Covers the in-memory dedup that prevents an LLM from voting/clicking
 * the same Radio Browser station endlessly within a session.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasRecentlyVoted,
  hasRecentlyClicked,
  markVoted,
  markClicked,
  resetRadioBrowserRateLimit,
} from '../../../src/utils/radio-browser-rate-limit.js';

describe('radio-browser-rate-limit', () => {
  beforeEach(() => {
    resetRadioBrowserRateLimit();
  });

  afterEach(() => {
    resetRadioBrowserRateLimit();
  });

  it('hasRecentlyVoted returns false until markVoted is called', () => {
    expect(hasRecentlyVoted('uuid-1')).toBe(false);
    markVoted('uuid-1');
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
  });

  it('hasRecentlyClicked returns false until markClicked is called', () => {
    expect(hasRecentlyClicked('uuid-1')).toBe(false);
    markClicked('uuid-1');
    expect(hasRecentlyClicked('uuid-1')).toBe(true);
  });

  it('vote and click are tracked independently', () => {
    markVoted('uuid-1');
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
    // A vote does not consume the click slot for the same station.
    expect(hasRecentlyClicked('uuid-1')).toBe(false);

    markClicked('uuid-1');
    expect(hasRecentlyClicked('uuid-1')).toBe(true);
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
  });

  it('different UUIDs do not collide', () => {
    markVoted('uuid-1');
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
    expect(hasRecentlyVoted('uuid-2')).toBe(false);
  });

  it('resetRadioBrowserRateLimit clears both sets', () => {
    markVoted('uuid-1');
    markClicked('uuid-2');
    resetRadioBrowserRateLimit();
    expect(hasRecentlyVoted('uuid-1')).toBe(false);
    expect(hasRecentlyClicked('uuid-2')).toBe(false);
  });
});
