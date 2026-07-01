/**
 * Navidrome MCP Server - safeNumber unit tests
 * Copyright (C) 2025
 */

import { describe, expect, it } from 'vitest';
import { safeNumber } from '../../../src/utils/safe-number.js';

describe('safeNumber()', () => {
  it('coerces numeric strings to numbers', () => {
    expect(safeNumber('0.823')).toBe(0.823);
    expect(safeNumber('42')).toBe(42);
  });

  it('passes finite numbers through unchanged', () => {
    expect(safeNumber(7)).toBe(7);
    expect(safeNumber(0)).toBe(0);
  });

  it('returns the fallback for non-numeric strings', () => {
    expect(safeNumber('unknown', -1)).toBe(-1);
  });

  it('returns the fallback for NaN and ±Infinity', () => {
    expect(safeNumber(NaN, -1)).toBe(-1);
    expect(safeNumber(Infinity, -1)).toBe(-1);
    expect(safeNumber(-Infinity, -1)).toBe(-1);
  });

  // Regression: Number(null) === 0 (finite), so the pre-fix code returned 0
  // instead of the fallback, breaking sentinel-based missing-value detection
  // (e.g. radio-discovery bitrate uses safeNumber(value, -1)).
  it('returns the fallback for null, not 0', () => {
    expect(safeNumber(null, -1)).toBe(-1);
    expect(safeNumber(null, 99)).toBe(99);
  });

  it('returns the fallback for undefined, not 0', () => {
    expect(safeNumber(undefined, -1)).toBe(-1);
  });

  // Regression: Number('') === 0 (finite), so the pre-fix code returned 0.
  it('returns the fallback for an empty string, not 0', () => {
    expect(safeNumber('', -1)).toBe(-1);
  });

  it('defaults the fallback to 0', () => {
    expect(safeNumber(null)).toBe(0);
    expect(safeNumber('unknown')).toBe(0);
  });
});
