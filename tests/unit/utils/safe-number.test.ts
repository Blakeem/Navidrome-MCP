/**
 * Navidrome MCP Server - safeNumber unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

  // Number(null) is 0, and callers such as the radio-discovery bitrate read -1 as missing.
  it('returns the fallback for null, not 0', () => {
    expect(safeNumber(null, -1)).toBe(-1);
    expect(safeNumber(null, 99)).toBe(99);
  });

  it('returns the fallback for undefined, not 0', () => {
    expect(safeNumber(undefined, -1)).toBe(-1);
  });

  // Number('') is 0, which would hide a missing value.
  it('returns the fallback for an empty string, not 0', () => {
    expect(safeNumber('', -1)).toBe(-1);
  });

  it('defaults the fallback to 0', () => {
    expect(safeNumber(null)).toBe(0);
    expect(safeNumber('unknown')).toBe(0);
  });
});
