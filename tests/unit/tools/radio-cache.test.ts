/**
 * Navidrome MCP Server - radio station cache tests
 * Copyright (C) 2025
 *
 * Covers the in-memory cache wired into listRadioStations / getRadioStation
 * (src/tools/radio.ts). Verifies cache hits avoid extra Subsonic round-trips,
 * TTL expiry, and that mutations (create / delete) invalidate the snapshot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listRadioStations,
  getRadioStation,
  deleteRadioStation,
  createRadioStation,
  invalidateRadioStationCache,
  resetRadioStationCacheForTesting,
} from '../../../src/tools/radio.js';
import type { Config } from '../../../src/config.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    navidromeUrl: 'http://mock:4533',
    navidromeUsername: 'u',
    navidromePassword: 'p',
    debug: false,
    cacheTtl: 300,
    tokenExpiry: 86400,
    features: { lastfm: false, radioBrowser: false, lyrics: false, playback: false },
    radioBrowserBase: 'https://de1.api.radio-browser.info',
    lrclibBase: 'https://lrclib.net',
    playbackTranscodeFormat: 'mp3',
    playbackTranscodeBitrate: '192',
    filterCacheEnabled: true,
    ...overrides,
  };
}

/**
 * Build a synthetic Navidrome REST `/radio` response (array of rows, no
 * envelope). createdAt/updatedAt default to a stable timestamp so cache
 * tests don't need to care about them.
 */
function makeRestList(stations: Array<{ id: string; name: string; streamUrl: string }>) {
  return stations.map(s => ({
    id: s.id,
    name: s.name,
    streamUrl: s.streamUrl,
    homePageUrl: '',
    createdAt: '2025-09-03T22:07:50Z',
    updatedAt: '2025-09-03T22:07:50Z',
  }));
}

describe('radio station cache', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    resetRadioStationCacheForTesting();
    mockClient = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRadioStationCacheForTesting();
  });

  it('caches the station list when config is provided — second call avoids the REST fetch', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([{ id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' }])
    );

    const config = makeConfig();

    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);

    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it('skips the cache when config is omitted (back-compat)', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([{ id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' }])
    );

    await listRadioStations(mockClient as unknown as NavidromeClient, {});
    await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('expires after TTL — third call after the window refetches', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([{ id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' }])
    );

    // 2-second TTL so we don't have to advance virtual time too far
    const config = makeConfig({ cacheTtl: 2 });

    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    // Advance past TTL
    vi.advanceTimersByTime(2_500);

    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('getRadioStation hits the cache on the second lookup', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([
        { id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { id: 'st-2', name: 'NPR', streamUrl: 'http://npr.test/' },
      ])
    );

    const config = makeConfig();

    const a = await getRadioStation(mockClient as unknown as NavidromeClient, { stationId: 'st-1' }, config);
    const b = await getRadioStation(mockClient as unknown as NavidromeClient, { stationId: 'st-2' }, config);

    expect(a.name).toBe('WBEZ');
    expect(b.name).toBe('NPR');
    // One REST call shared by both lookups.
    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it('invalidateRadioStationCache forces the next read to refetch', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([{ id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' }])
    );

    const config = makeConfig();

    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    invalidateRadioStationCache();
    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);

    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('deleteRadioStation invalidates the cache so a subsequent read refetches', async () => {
    // Pre-warm the cache, then delete, then re-read
    mockClient.request.mockResolvedValueOnce(
      makeRestList([
        { id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { id: 'st-2', name: 'NPR', streamUrl: 'http://npr.test/' },
      ])
    );

    const config = makeConfig();

    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    // deleteRadioStation still uses the Subsonic delete endpoint —
    // listRadioStations switched to REST, but Subsonic remains the only
    // mutation surface Navidrome exposes for radio.
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });
    await deleteRadioStation(mockClient as unknown as NavidromeClient, { stationId: 'st-1' });
    expect(mockClient.subsonicRequest).toHaveBeenCalledTimes(1);

    // Subsequent listRadioStations must refetch (post-invalidation)
    mockClient.request.mockResolvedValueOnce(
      makeRestList([{ id: 'st-2', name: 'NPR', streamUrl: 'http://npr.test/' }])
    );
    const afterDelete = await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);

    expect(mockClient.request).toHaveBeenCalledTimes(2);
    expect(afterDelete.stations).toHaveLength(1);
    expect(afterDelete.stations[0]!.id).toBe('st-2');
  });

  it('createRadioStation invalidates the cache on success', async () => {
    const config = makeConfig();

    // 1) Pre-warm via REST
    mockClient.request.mockResolvedValueOnce(makeRestList([]));
    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    // 2) createInternetRadioStation (Subsonic POST per station) +
    //    post-create REST listRadioStations() to resolve the new id
    //    (uncached because the internal call passes no config).
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' }); // /createInternetRadioStation
    mockClient.request.mockResolvedValueOnce( // post-create lookup
      makeRestList([{ id: 'st-new', name: 'New', streamUrl: 'http://new.test/' }])
    );

    await createRadioStation(mockClient as unknown as NavidromeClient, config, {
      stations: [{ name: 'New', streamUrl: 'http://new.test/' }],
    });

    // After the create, the cache must have been dropped — the next
    // listRadioStations(config) call must hit the REST endpoint again.
    mockClient.request.mockResolvedValueOnce(
      makeRestList([{ id: 'st-new', name: 'New', streamUrl: 'http://new.test/' }])
    );
    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);

    // REST calls: 1 (pre-warm) + 1 (post-create lookup) + 1 (post-invalidation refetch) = 3
    expect(mockClient.request).toHaveBeenCalledTimes(3);
    // Subsonic calls: 1 (the create itself)
    expect(mockClient.subsonicRequest).toHaveBeenCalledTimes(1);
  });

  it('createRadioStation does NOT invalidate when every station fails validation', async () => {
    const config = makeConfig();

    // Pre-warm
    mockClient.request.mockResolvedValueOnce(makeRestList([]));
    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    // All-fail batch: validation errors only, no Subsonic POST happens
    await createRadioStation(mockClient as unknown as NavidromeClient, config, {
      stations: [{ name: '', streamUrl: 'http://x.test/' }], // empty name fails validation
    });

    // Cache should still be warm — next list serves from memory
    await listRadioStations(mockClient as unknown as NavidromeClient, {}, config);
    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });
});
