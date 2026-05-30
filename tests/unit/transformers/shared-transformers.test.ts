/**
 * Navidrome MCP Server - shared transformer utility tests
 * Copyright (C) 2025
 *
 * Covers the post-fix contracts for formatDuration (NaN/Infinity/undefined
 * guards), parseDuration (non-numeric MM:SS and missing-colon inputs), and
 * extractAllGenres (empty-name scenarios returning undefined).
 */

import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  parseDuration,
  extractAllGenres,
} from '../../../src/transformers/shared-transformers.js';

describe('formatDuration', () => {
  it('returns 0:00 for NaN', () => {
    expect(formatDuration(NaN)).toBe('0:00');
  });

  it('returns 0:00 for Infinity', () => {
    expect(formatDuration(Infinity)).toBe('0:00');
  });

  it('returns 0:00 for undefined', () => {
    expect(formatDuration(undefined)).toBe('0:00');
  });

  it('formats a valid duration', () => {
    expect(formatDuration(225)).toBe('3:45');
  });
});

describe('parseDuration', () => {
  it('returns 0 for non-numeric MM:SS', () => {
    expect(parseDuration('abc:def')).toBe(0);
  });

  it('parses a valid MM:SS string', () => {
    expect(parseDuration('3:45')).toBe(225);
  });

  it('returns 0 when there is no colon', () => {
    expect(parseDuration('nocolon')).toBe(0);
  });

  it('returns 0 for HH:MM:SS input', () => {
    expect(parseDuration('1:03:45')).toBe(0);
  });

  it('returns 0 for negative input', () => {
    expect(parseDuration('-1:30')).toBe(0);
  });
});

describe('extractAllGenres', () => {
  it('returns undefined when all genre names are empty', () => {
    expect(extractAllGenres({ genres: [{ id: '1', name: '' }] })).toBeUndefined();
  });

  it('filters out empty genre names', () => {
    expect(
      extractAllGenres({
        genres: [
          { id: '1', name: 'Rock' },
          { id: '2', name: '' },
        ],
      }),
    ).toEqual(['Rock']);
  });
});
