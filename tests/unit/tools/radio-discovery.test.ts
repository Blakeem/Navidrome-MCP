/**
 * Navidrome MCP Server - radio-discovery tests
 * Copyright (C) 2025
 *
 * Covers discoverRadioStations, getRadioFilters, getStationByUuid,
 * clickStation, and voteStation with mocked fetch + mocked client.
 * External API (Radio Browser) is never hit live.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../../src/config.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

// ---- helpers ----------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    navidromeUrl: 'http://mock:4533',
    navidromeUsername: 'u',
    navidromePassword: 'p',
    debug: false,
    cacheTtl: 300,
    tokenExpiry: 86400,
    features: { lastfm: false, radioBrowser: true, lyrics: false, playback: false },
    lastFmApiKey: undefined,
    radioBrowserBase: 'https://de1.api.radio-browser.info',
    radioBrowserUserAgent: 'TestAgent/1.0',
    lyricsProvider: undefined,
    lrclibUserAgent: undefined,
    lrclibBase: 'https://lrclib.net',
    playbackTranscodeFormat: 'mp3',
    playbackTranscodeBitrate: '192',
    filterCacheEnabled: true,
    ...overrides,
  };
}

function makeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response);
}

/** A minimal Radio Browser station object. */
function makeStation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stationuuid: 'uuid-001',
    name: 'Test FM',
    url: 'http://stream.test/audio',
    url_resolved: 'http://stream.test/audio',
    tags: 'rock,pop',
    countrycode: 'US',
    languagecodes: 'en',
    codec: 'MP3',
    bitrate: 128,
    votes: 500,
    clickcount: 1200,
    hls: 0,
    ...overrides,
  };
}

// ---- discoverRadioStations --------------------------------------------------

describe('discoverRadioStations', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = createMockClient();
  });

  it('returns stations + source + mirrorUsed on happy path', async () => {
    // Radio Browser search → one station; validation HEAD → also mocked
    global.fetch = vi.fn()
      // First call: /json/stations/search
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([makeStation()]),
        headers: new Headers(),
      } as unknown as Response)
      // Subsequent calls: validation HEAD requests (up to 8)
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), mockClient as unknown as NavidromeClient, {
      limit: 1,
    });

    expect(Array.isArray(result.stations)).toBe(true);
    expect(result.source).toBe('radio-browser');
    expect(typeof result.mirrorUsed).toBe('string');
  });

  it('wraps HTTP error from Radio Browser in a thrown Error', async () => {
    global.fetch = makeFetch(503, null);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await expect(
      discoverRadioStations(makeConfig(), mockClient as unknown as NavidromeClient, { limit: 1 })
    ).rejects.toThrow();
  });

  it('maps tags and languageCodes to arrays', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([makeStation({ tags: 'jazz, blues', languagecodes: 'en,fr' })]),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), mockClient as unknown as NavidromeClient, { limit: 1 });

    // Mock guarantees one station; assert unconditionally so a regression
    // that drops/filters the station fails the test instead of silently
    // skipping the body. Also asserts the actual mapping content rather
    // than just the array shape.
    expect(result.stations.length).toBe(1);
    const station = result.stations[0]!;
    expect(station.tags).toEqual(['jazz', 'blues']);
    expect(station.languageCodes).toEqual(['en', 'fr']);
    // DTO shape sanity: required fields are populated from the mock.
    expect(typeof station.stationUuid).toBe('string');
    expect(station.stationUuid.length).toBeGreaterThan(0);
    expect(typeof station.name).toBe('string');
    expect(typeof station.playUrl).toBe('string');
    expect(typeof station.votes).toBe('number');
    expect(typeof station.clickCount).toBe('number');
  });
});

// ---- getRadioFilters --------------------------------------------------------

describe('getRadioFilters', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns tags, countries, languages, codecs when all kinds requested', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve([{ name: 'rock', stationcount: 5000 }]),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve([{ name: 'United States', iso_3166_1: 'US', stationcount: 8000 }]),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve([{ name: 'english', iso_639: 'en', stationcount: 12000 }]),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve([{ name: 'MP3', stationcount: 20000 }]),
        headers: new Headers(),
      } as unknown as Response);

    const { getRadioFilters } = await import('../../../src/tools/radio-discovery.js');
    const result = await getRadioFilters(makeConfig(), {});

    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.countries)).toBe(true);
    expect(Array.isArray(result.languages)).toBe(true);
    expect(Array.isArray(result.codecs)).toBe(true);

    expect(result.tags![0]).toHaveProperty('name');
    expect(result.tags![0]).toHaveProperty('stationCount');
    expect(result.countries![0]).toHaveProperty('code');
    expect(result.countries![0]).toHaveProperty('name');
  });

  it('only fetches requested kinds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([{ name: 'MP3', stationcount: 1000 }]),
      headers: new Headers(),
    } as unknown as Response);
    global.fetch = fetchMock;

    const { getRadioFilters } = await import('../../../src/tools/radio-discovery.js');
    const result = await getRadioFilters(makeConfig(), { kinds: ['codecs'] });

    // Only one fetch (for codecs), not four
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result.codecs)).toBe(true);
    expect(result.tags).toBeUndefined();
    expect(result.countries).toBeUndefined();
    expect(result.languages).toBeUndefined();
  });

  it('throws on Radio Browser HTTP error', async () => {
    global.fetch = makeFetch(500, null);

    const { getRadioFilters } = await import('../../../src/tools/radio-discovery.js');
    await expect(getRadioFilters(makeConfig(), {})).rejects.toThrow();
  });
});

// ---- getStationByUuid -------------------------------------------------------

describe('getStationByUuid', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns DTO shape for a known UUID', async () => {
    global.fetch = makeFetch(200, [makeStation({ stationuuid: 'known-uuid' })]);

    const { getStationByUuid } = await import('../../../src/tools/radio-discovery.js');
    const result = await getStationByUuid(makeConfig(), { stationUuid: 'known-uuid' });

    expect(result).toHaveProperty('stationUuid');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('playUrl');
    expect(result).toHaveProperty('votes');
    expect(result).toHaveProperty('clickCount');
    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.languageCodes)).toBe(true);
  });

  it('throws not-found when Radio Browser returns empty array', async () => {
    global.fetch = makeFetch(200, []);

    const { getStationByUuid } = await import('../../../src/tools/radio-discovery.js');
    await expect(getStationByUuid(makeConfig(), { stationUuid: 'missing-uuid' })).rejects.toThrow();
  });

  it('throws on HTTP error', async () => {
    global.fetch = makeFetch(404, null);

    const { getStationByUuid } = await import('../../../src/tools/radio-discovery.js');
    await expect(getStationByUuid(makeConfig(), { stationUuid: 'any' })).rejects.toThrow();
  });
});

// ---- clickStation -----------------------------------------------------------

describe('clickStation', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns ok:true and playUrl on success', async () => {
    global.fetch = makeFetch(200, { ok: true, message: 'Click registered', url: 'http://stream.test/audio' });

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await clickStation(makeConfig(), { stationUuid: 'uuid-001' });

    expect(result.ok).toBe(true);
    expect(typeof result.playUrl).toBe('string');
    expect(typeof result.message).toBe('string');
  });

  it('returns ok:false when Radio Browser responds ok:false', async () => {
    global.fetch = makeFetch(200, { ok: false, message: 'Station not found' });

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await clickStation(makeConfig(), { stationUuid: 'bad-uuid' });

    expect(result.ok).toBe(false);
  });

  it('throws on HTTP error', async () => {
    global.fetch = makeFetch(503, null);

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');
    await expect(clickStation(makeConfig(), { stationUuid: 'uuid' })).rejects.toThrow();
  });
});

// ---- voteStation ------------------------------------------------------------

describe('voteStation', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns ok:true and message on success', async () => {
    global.fetch = makeFetch(200, { ok: true, message: 'Vote registered' });

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await voteStation(makeConfig(), { stationUuid: 'uuid-001' });

    expect(result.ok).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  it('returns ok:false when server declines the vote', async () => {
    global.fetch = makeFetch(200, { ok: false, message: 'Already voted' });

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await voteStation(makeConfig(), { stationUuid: 'uuid-001' });

    expect(result.ok).toBe(false);
  });

  it('throws on HTTP error', async () => {
    global.fetch = makeFetch(500, null);

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    await expect(voteStation(makeConfig(), { stationUuid: 'uuid' })).rejects.toThrow();
  });
});
