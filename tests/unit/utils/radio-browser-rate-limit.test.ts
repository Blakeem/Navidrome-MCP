/**
 * Navidrome MCP Server - radio-browser per-session rate-limit tests
 * Copyright (C) 2025
 *
 * Covers the in-memory dedup that prevents an LLM from voting/clicking
 * the same Radio Browser station endlessly within a session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasRecentlyVoted,
  getClickedStreamUrl,
  markVoted,
  markClicked,
  resetRadioBrowserRateLimitForTests,
} from '../../../src/utils/radio-browser-rate-limit.js';

describe('radio-browser-rate-limit', () => {
  beforeEach(() => {
    resetRadioBrowserRateLimitForTests();
  });

  afterEach(() => {
    resetRadioBrowserRateLimitForTests();
    vi.useRealTimers();
  });

  it('hasRecentlyVoted returns false until markVoted is called', () => {
    expect(hasRecentlyVoted('uuid-1')).toBe(false);
    markVoted('uuid-1');
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
  });

  it('getClickedStreamUrl returns undefined until markClicked stores the URL', () => {
    expect(getClickedStreamUrl('uuid-1')).toBeUndefined();
    markClicked('uuid-1', 'http://stream.test/a');
    expect(getClickedStreamUrl('uuid-1')).toBe('http://stream.test/a');
  });

  it('vote and click are tracked independently', () => {
    markVoted('uuid-1');
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
    // A vote does not consume the click slot for the same station.
    expect(getClickedStreamUrl('uuid-1')).toBeUndefined();

    markClicked('uuid-1', 'http://stream.test/a');
    expect(getClickedStreamUrl('uuid-1')).toBe('http://stream.test/a');
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
  });

  it('different UUIDs do not collide', () => {
    markVoted('uuid-1');
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
    expect(hasRecentlyVoted('uuid-2')).toBe(false);
  });

  it('a vote expires after 10 minutes', () => {
    vi.useFakeTimers();
    markVoted('uuid-1');
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(hasRecentlyVoted('uuid-1')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hasRecentlyVoted('uuid-1')).toBe(false);
  });

  it('a click expires after a day', () => {
    vi.useFakeTimers();
    markClicked('uuid-1', 'http://stream.test/a');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
    expect(getClickedStreamUrl('uuid-1')).toBe('http://stream.test/a');
    vi.advanceTimersByTime(1);
    expect(getClickedStreamUrl('uuid-1')).toBeUndefined();
  });

  it('resetRadioBrowserRateLimitForTests clears votes and clicks', () => {
    markVoted('uuid-1');
    markClicked('uuid-2', 'http://stream.test/b');
    resetRadioBrowserRateLimitForTests();
    expect(hasRecentlyVoted('uuid-1')).toBe(false);
    expect(getClickedStreamUrl('uuid-2')).toBeUndefined();
  });
});
