/**
 * Navidrome MCP Server - radio CRUD read tests
 * Copyright (C) 2025
 *
 * Covers listRadioStations, getRadioStation, deleteRadioStation from
 * src/tools/radio.ts. createRadioStation is covered in radio-create.test.ts.
 * All tests use createMockClient() — Subsonic API is not hit live.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { listRadioStations, getRadioStation, deleteRadioStation } from '../../../src/tools/radio.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

function makeSubsonicList(stations: Array<{ id: string; name: string; streamUrl: string; homePageUrl?: string }>) {
  return {
    internetRadioStations: {
      internetRadioStation: stations,
    },
  };
}

// ---- listRadioStations ------------------------------------------------------

describe('listRadioStations', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns stations array + total on happy path', async () => {
    mockClient.subsonicRequest.mockResolvedValue(
      makeSubsonicList([
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
    mockClient.subsonicRequest.mockResolvedValue(
      makeSubsonicList([
        { id: 'st-1', name: 'A', streamUrl: 'http://a.test/', homePageUrl: 'https://a.test' },
        { id: 'st-2', name: 'B', streamUrl: 'http://b.test/' },
      ])
    );

    const result = await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(result.stations[0]!.homePageUrl).toBe('https://a.test');
    // second station has no homePageUrl
    expect(result.stations[1]!.homePageUrl).toBeUndefined();
  });

  it('returns empty list when Subsonic response has no stations', async () => {
    mockClient.subsonicRequest.mockResolvedValue({ internetRadioStations: {} });

    const result = await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(result.stations).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('calls /getInternetRadioStations', async () => {
    mockClient.subsonicRequest.mockResolvedValue(makeSubsonicList([]));

    await listRadioStations(mockClient as unknown as NavidromeClient, {});

    expect(mockClient.subsonicRequest).toHaveBeenCalledWith('/getInternetRadioStations');
  });
});

// ---- getRadioStation --------------------------------------------------------

describe('getRadioStation', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns the matching station DTO', async () => {
    mockClient.subsonicRequest.mockResolvedValue(
      makeSubsonicList([
        { id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { id: 'st-2', name: 'NPR', streamUrl: 'http://npr.test/' },
      ])
    );

    const result = await getRadioStation(mockClient as unknown as NavidromeClient, { id: 'st-2' });

    expect(result.id).toBe('st-2');
    expect(result.name).toBe('NPR');
    expect(result.streamUrl).toBe('http://npr.test/');
  });

  it('throws when the station ID is not found', async () => {
    mockClient.subsonicRequest.mockResolvedValue(
      makeSubsonicList([{ id: 'st-1', name: 'WBEZ', streamUrl: 'http://wbez.test/' }])
    );

    await expect(
      getRadioStation(mockClient as unknown as NavidromeClient, { id: 'st-999' })
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

    const result = await deleteRadioStation(mockClient as unknown as NavidromeClient, { id: 'st-1' });

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
      deleteRadioStation(mockClient as unknown as NavidromeClient, { id: 'st-1' })
    ).rejects.toThrow();
  });
});
