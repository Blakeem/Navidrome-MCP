/**
 * Navidrome MCP Server - radio-browser SRV resolver tests
 * Copyright (C) 2025
 *
 * Mocks `node:dns/promises` to verify the SRV-based mirror picker, the
 * cache reuse path, and the fallback to the historical hardcoded host
 * when DNS fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dns/promises BEFORE importing the resolver module.
vi.mock('node:dns/promises', () => ({
  resolveSrv: vi.fn(),
}));

// Imported after the mock so the resolver wires up the mocked function.
import { resolveSrv } from 'node:dns/promises';
import {
  getRadioBrowserBase,
  resetRadioBrowserResolverCache,
  RADIO_BROWSER_FALLBACK_BASE,
} from '../../../src/utils/radio-browser-resolver.js';

const mockedResolveSrv = vi.mocked(resolveSrv);

describe('getRadioBrowserBase', () => {
  beforeEach(() => {
    resetRadioBrowserResolverCache();
    mockedResolveSrv.mockReset();
  });

  afterEach(() => {
    resetRadioBrowserResolverCache();
  });

  it('returns the override verbatim and never hits DNS', async () => {
    const result = await getRadioBrowserBase('https://my-pinned-mirror.test');

    expect(result).toBe('https://my-pinned-mirror.test');
    expect(mockedResolveSrv).not.toHaveBeenCalled();
  });

  it('treats empty-string override as "no override" and falls through to SRV', async () => {
    mockedResolveSrv.mockResolvedValue([
      { name: 'de1.api.radio-browser.info', port: 443, priority: 1, weight: 1 },
    ]);

    const result = await getRadioBrowserBase('');

    expect(result).toBe('https://de1.api.radio-browser.info');
    expect(mockedResolveSrv).toHaveBeenCalledTimes(1);
  });

  it('resolves SRV and returns https://<host> for the picked record', async () => {
    mockedResolveSrv.mockResolvedValue([
      { name: 'us1.api.radio-browser.info', port: 443, priority: 1, weight: 1 },
    ]);

    const result = await getRadioBrowserBase();

    expect(result).toBe('https://us1.api.radio-browser.info');
  });

  it('strips a trailing dot from the SRV target', async () => {
    mockedResolveSrv.mockResolvedValue([
      { name: 'de1.api.radio-browser.info.', port: 443, priority: 1, weight: 1 },
    ]);

    const result = await getRadioBrowserBase();

    expect(result).toBe('https://de1.api.radio-browser.info');
  });

  it('caches the resolved base — second call does not hit DNS again', async () => {
    mockedResolveSrv.mockResolvedValue([
      { name: 'de1.api.radio-browser.info', port: 443, priority: 1, weight: 1 },
    ]);

    await getRadioBrowserBase();
    await getRadioBrowserBase();

    expect(mockedResolveSrv).toHaveBeenCalledTimes(1);
  });

  it('falls back to the hardcoded base when SRV resolution rejects', async () => {
    mockedResolveSrv.mockRejectedValue(new Error('ENOTFOUND'));

    const result = await getRadioBrowserBase();

    expect(result).toBe(RADIO_BROWSER_FALLBACK_BASE);
  });

  it('falls back to the hardcoded base when SRV returns no records', async () => {
    mockedResolveSrv.mockResolvedValue([]);

    const result = await getRadioBrowserBase();

    expect(result).toBe(RADIO_BROWSER_FALLBACK_BASE);
  });

  it('caches the fallback so a flapping DNS does not get hammered', async () => {
    mockedResolveSrv.mockRejectedValue(new Error('ENOTFOUND'));

    await getRadioBrowserBase();
    await getRadioBrowserBase();

    expect(mockedResolveSrv).toHaveBeenCalledTimes(1);
  });

  it('dedupes parallel in-flight resolutions — single SRV call for concurrent callers', async () => {
    let resolveDeferred: ((records: Array<{ name: string; port: number; priority: number; weight: number }>) => void) | undefined;
    mockedResolveSrv.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDeferred = resolve;
        }),
    );

    const a = getRadioBrowserBase();
    const b = getRadioBrowserBase();
    const c = getRadioBrowserBase();

    // Trigger the deferred resolution
    resolveDeferred!([{ name: 'de1.api.radio-browser.info', port: 443, priority: 1, weight: 1 }]);

    await Promise.all([a, b, c]);

    // Only ONE DNS lookup, not three
    expect(mockedResolveSrv).toHaveBeenCalledTimes(1);
  });

  it('picks one of the SRV records when multiple are returned', async () => {
    // Three mirrors — random pick, but all should produce a valid https:// URL
    // matching one of the names.
    mockedResolveSrv.mockResolvedValue([
      { name: 'de1.api.radio-browser.info', port: 443, priority: 1, weight: 1 },
      { name: 'us1.api.radio-browser.info', port: 443, priority: 1, weight: 1 },
      { name: 'fr1.api.radio-browser.info', port: 443, priority: 1, weight: 1 },
    ]);

    const result = await getRadioBrowserBase();

    expect(result).toMatch(/^https:\/\/(de1|us1|fr1)\.api\.radio-browser\.info$/);
  });
});
