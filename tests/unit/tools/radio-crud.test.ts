/**
 * Navidrome MCP Server - radio CRUD read tests
 * Copyright (C) 2025
 *
 * Covers listRadioStations, getRadioStation, deleteRadioStation from
 * src/tools/radio.ts. createRadioStation is covered in radio-create.test.ts.
 * All tests use createMockClient() — Subsonic API is not hit live.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { listRadioStations, getRadioStation, deleteRadioStation, resetRadioStationCacheForTesting } from '../../../src/tools/radio.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

/**
 * Build a synthetic Navidrome REST `/radio` response. The endpoint returns a
 * raw array (no envelope), with per-station `createdAt`/`updatedAt` and an
 * always-present (but possibly empty) `homePageUrl`.
 */
function makeRestList(stations: Array<{ id: string; name: string; streamUrl: string; homePageUrl?: string; createdAt?: string; updatedAt?: string }>) {
  return stations.map(s => ({
    id: s.id,
    name: s.name,
    streamUrl: s.streamUrl,
    homePageUrl: s.homePageUrl ?? '',
    createdAt: s.createdAt ?? '2025-09-03T22:07:50Z',
    updatedAt: s.updatedAt ?? '2025-09-03T22:07:50Z',
  }));
}

// ---- listRadioStations ------------------------------------------------------

describe('listRadioStations', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    resetRadioStationCacheForTesting();
    mockClient = createMockClient();
  });

  it('returns stations array + total on happy path', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([
        { id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { id: 'st-2', name: 'NPR', streamUrl: 'http://npr.test/', homePageUrl: 'https://npr.org' },
      ])
    );

    const result = await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(Array.isArray(result.stations)).toBe(true);
    expect(result.total).toBe(2);
    expect(result.stations).toHaveLength(2);

    const first = result.stations[0]!;
    expect(typeof first.id).toBe('string');
    expect(typeof first.name).toBe('string');
    expect(typeof first.streamUrl).toBe('string');
    expect(typeof first.createdAt).toBe('string');
    expect(typeof first.updatedAt).toBe('string');
  });

  it('maps homePageUrl only when present', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([
        { id: 'st-1', name: 'A', streamUrl: 'http://a.test/', homePageUrl: 'https://a.test' },
        { id: 'st-2', name: 'B', streamUrl: 'http://b.test/' },
      ])
    );

    const result = await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(result.stations[0]!.homePageUrl).toBe('https://a.test');
    // second station's empty-string homePageUrl is treated as unset
    expect(result.stations[1]!.homePageUrl).toBeUndefined();
  });

  it('preserves per-station createdAt/updatedAt from the REST response', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([
        { id: 'st-1', name: 'A', streamUrl: 'http://a.test/', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-15T10:00:00Z' },
        { id: 'st-2', name: 'B', streamUrl: 'http://b.test/', createdAt: '2025-06-20T20:30:00Z', updatedAt: '2025-06-20T20:30:00Z' },
      ])
    );

    const result = await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(result.stations[0]!.createdAt).toBe('2025-01-15T10:00:00Z');
    expect(result.stations[1]!.createdAt).toBe('2025-06-20T20:30:00Z');
    // Distinct timestamps (regression test for the "all stations got the
    // same bulk-import timestamp" Subsonic limitation we worked around by
    // switching to REST).
    expect(result.stations[0]!.createdAt).not.toBe(result.stations[1]!.createdAt);
  });

  it('maps Go zero-time timestamps to null', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([
        { id: 'st-1', name: 'A', streamUrl: 'http://a.test/', createdAt: '0001-01-01T00:00:00Z', updatedAt: '0001-01-01T00:00:00Z' },
      ])
    );

    const result = await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(result.stations[0]!.createdAt).toBeNull();
    expect(result.stations[0]!.updatedAt).toBeNull();
  });

  it('returns empty list when REST response is empty', async () => {
    mockClient.request.mockResolvedValue([]);

    const result = await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(result.stations).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('calls REST /radio with a generous _end limit', async () => {
    mockClient.request.mockResolvedValue([]);

    await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(mockClient.request).toHaveBeenCalledWith(expect.stringMatching(/^\/radio\?/));
  });
});

// ---- getRadioStation --------------------------------------------------------

describe('getRadioStation', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    resetRadioStationCacheForTesting();
    mockClient = createMockClient();
  });

  it('returns the matching station DTO', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([
        { id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { id: 'st-2', name: 'NPR', streamUrl: 'http://npr.test/' },
      ])
    );

    const result = await getRadioStation(mockClient as unknown as NavidromeClient, { stationId: 'st-2' });

    expect(result.id).toBe('st-2');
    expect(result.name).toBe('NPR');
    expect(result.streamUrl).toBe('http://npr.test/');
  });

  it('throws when the station ID is not found', async () => {
    mockClient.request.mockResolvedValue(
      makeRestList([{ id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' }])
    );

    await expect(
      getRadioStation(mockClient as unknown as NavidromeClient, { stationId: 'st-999' })
    ).rejects.toThrow();
  });

  it('throws when id is missing', async () => {
    await expect(
      getRadioStation(mockClient as unknown as NavidromeClient, {})
    ).rejects.toThrow();
  });
});

// ---- deleteRadioStation -----------------------------------------------------

describe('deleteRadioStation', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns success: true and calls /deleteInternetRadioStation with the id', async () => {
    mockClient.subsonicRequest.mockResolvedValue({ status: 'ok' });

    const result = await deleteRadioStation(mockClient as unknown as NavidromeClient, { stationId: 'st-1' });

    expect(result.success).toBe(true);
    expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
      '/deleteInternetRadioStation',
      { id: 'st-1' }
    );
  });

  it('throws when id is missing', async () => {
    await expect(
      deleteRadioStation(mockClient as unknown as NavidromeClient, {})
    ).rejects.toThrow();
  });

  it('throws (wraps error) when Subsonic call fails', async () => {
    mockClient.subsonicRequest.mockRejectedValue(new Error('Subsonic error'));

    await expect(
      deleteRadioStation(mockClient as unknown as NavidromeClient, { stationId: 'st-1' })
    ).rejects.toThrow();
  });
});

// ---- Zod schema validation (replaces args-as casts) -------------------------

describe('radio.ts Zod schema validation', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('deleteRadioStation rejects null args', async () => {
    await expect(
      deleteRadioStation(mockClient as unknown as NavidromeClient, null)
    ).rejects.toThrow();
  });

  it('deleteRadioStation rejects non-string id', async () => {
    await expect(
      deleteRadioStation(mockClient as unknown as NavidromeClient, { stationId: 42 })
    ).rejects.toThrow();
  });

  it('getRadioStation rejects empty-string id', async () => {
    await expect(
      getRadioStation(mockClient as unknown as NavidromeClient, { stationId: '' })
    ).rejects.toThrow();
  });

  it('getRadioStation rejects null args', async () => {
    await expect(
      getRadioStation(mockClient as unknown as NavidromeClient, null)
    ).rejects.toThrow();
  });
});
