/**
 * Navidrome MCP Server - version utility tests
 * Copyright (C) 2025
 *
 * Covers getPackageVersion from src/utils/version.ts.
 */

import { describe, expect, it } from 'vitest';
import { getPackageVersion } from '../../../src/utils/version.js';

describe('getPackageVersion', () => {
  it('returns a non-empty string', () => {
    const version = getPackageVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('returns a semver-shaped string (N.N.N)', () => {
    const version = getPackageVersion();
    // Basic semver check: at least two dots separating digits
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('does not throw', () => {
    expect(() => getPackageVersion()).not.toThrow();
  });
});
