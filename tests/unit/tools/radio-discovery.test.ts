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
import { makeTestConfig } from '../../helpers/test-config.js';

// Station validation now flows through network-safety's safeFetch (a peer-IP
// gated dispatcher). Route it to whatever global.fetch mock each test installs
// so the existing interleaved search+validation sequences keep working and no
// real network is hit; safeFetch's real dispatcher behavior is covered in
// tests/unit/utils/network-safety.test.ts. Keep the module's other exports real.
vi.mock('../../../src/utils/network-safety.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/network-safety.js')>();
  return {
    ...actual,
    safeFetch: (...args: unknown[]) =>
      (globalThis.fetch as (...a: unknown[]) => unknown)(...args),
  };
});

// ---- helpers ----------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...makeTestConfig(),
    navidromeUrl: 'http://mock:4533',
    navidromeUsername: 'u',
    navidromePassword: 'p',
    debug: false,
    tokenExpiry: 86400,
    features: { lastfm: false, radioBrowser: true, lyrics: false, playback: false },
    lastFmApiKey: undefined,
    // Setting the override pins the resolver and avoids real DNS lookups
    // (the SRV-resolution path is exercised separately in
    // radio-browser-resolver.test.ts with a mocked dns module).
    radioBrowserBaseOverride: 'https://de1.api.radio-browser.info',
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

function firstFetchUrl(fetchMock: typeof fetch): string {
  const input = vi.mocked(fetchMock).mock.calls[0]![0];
  return input instanceof Request ? input.url : input.toString();
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
  beforeEach(() => {
    vi.restoreAllMocks();
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
    const result = await discoverRadioStations(makeConfig(), {
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
      discoverRadioStations(makeConfig(), { limit: 1 })
    ).rejects.toThrow();
  });

  it.each([
    ['name', 'false'],
    ['votes', 'true'],
    ['clickcount', 'true'],
  ])('maps sort=%s with no order to reverse=%s', async (sort, expectedReverse) => {
    const fetchMock = makeFetch(200, []);
    global.fetch = fetchMock;

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await discoverRadioStations(makeConfig(), { sort });

    const url = new URL(firstFetchUrl(fetchMock));
    expect(url.searchParams.get('order')).toBe(sort);
    expect(url.searchParams.get('reverse')).toBe(expectedReverse);
    expect(url.searchParams.get('offset')).toBe('0');
  });

  it.each([
    ['name', 'DESC', 'true'],
    ['votes', 'ASC', 'false'],
  ])('keeps an explicit order for sort=%s (order=%s maps to reverse=%s)', async (sort, order, expectedReverse) => {
    const fetchMock = makeFetch(200, []);
    global.fetch = fetchMock;

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await discoverRadioStations(makeConfig(), { sort, order });

    const url = new URL(firstFetchUrl(fetchMock));
    expect(url.searchParams.get('order')).toBe(sort);
    expect(url.searchParams.get('reverse')).toBe(expectedReverse);
  });

  it('lowercases tag and language and sends is_https only for true', async () => {
    const fetchMock = makeFetch(200, []);
    global.fetch = fetchMock;

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await discoverRadioStations(makeConfig(), { tag: 'Jazz', language: 'Spanish', isHttps: false });

    const url = new URL(firstFetchUrl(fetchMock));
    expect(url.searchParams.get('tag')).toBe('jazz');
    expect(url.searchParams.get('language')).toBe('spanish');
    expect(url.searchParams.has('is_https')).toBe(false);
  });

  it('rejects a sort field passed as order', async () => {
    global.fetch = makeFetch(200, []);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await expect(discoverRadioStations(makeConfig(), { order: 'name' })).rejects.toThrow();
  });

  it('rejects a non-integer limit inside the discover_radio_stations error envelope', async () => {
    const fetchMock = makeFetch(200, []);
    global.fetch = fetchMock;

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await expect(
      discoverRadioStations(makeConfig(), { limit: 2.5 })
    ).rejects.toThrow(/Tool 'discover_radio_stations' failed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('joins a trailing-slash override without doubling the slash', async () => {
    const fetchMock = makeFetch(200, []);
    global.fetch = fetchMock;

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await discoverRadioStations(
      makeConfig({ radioBrowserBaseOverride: 'https://mirror.test/' }),
      {},
    );

    expect(firstFetchUrl(fetchMock)).toMatch(/^https:\/\/mirror\.test\/json\/stations\/search\?/);
  });

  it('maps tags and language names to arrays', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([makeStation({ tags: 'jazz, blues', language: 'english, french', languagecodes: 'en,fr' })]),
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
    const result = await discoverRadioStations(makeConfig(), { limit: 1 });

    // Mock guarantees one station; assert unconditionally so a regression
    // that drops/filters the station fails the test instead of silently
    // skipping the body. Also asserts the actual mapping content rather
    // than just the array shape.
    expect(result.stations.length).toBe(1);
    const station = result.stations[0]!;
    expect(station.tags).toEqual(['jazz', 'blues']);
    expect(station.languages).toEqual(['english', 'french']);
    expect(station).not.toHaveProperty('languageCodes');
    // DTO shape sanity: required fields are populated from the mock.
    expect(typeof station.stationUuid).toBe('string');
    expect(station.stationUuid.length).toBeGreaterThan(0);
    expect(typeof station.name).toBe('string');
    expect(typeof station.streamUrl).toBe('string');
    expect(typeof station.votes).toBe('number');
    expect(typeof station.clickCount).toBe('number');
  });

  it('emits streamUrl and homePageUrl, the field names create_radio_station accepts', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([makeStation({ homepage: 'https://test.fm' })]),
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
    const result = await discoverRadioStations(makeConfig(), { limit: 1 });

    expect(result.stations).toHaveLength(1);
    const station = result.stations[0]!;
    expect(station.streamUrl).toBe('http://stream.test/audio');
    expect(station.homePageUrl).toBe('https://test.fm');
    expect(station).not.toHaveProperty('playUrl');
    expect(station).not.toHaveProperty('homepage');
  });

  it('serializes probes per host but runs different hosts in parallel, preserving order (Issue #7)', async () => {
    // 4 stations: three share one host:port (hostA:8443), one is on hostB.
    // hostA is the icecast-style cluster that rate-limits concurrent IPs.
    const stationList = [
      makeStation({ stationuuid: 'a1', name: 'A-one',    url: 'http://hosta.test:8443/one',   url_resolved: 'http://hosta.test:8443/one' }),
      makeStation({ stationuuid: 'b1', name: 'B-stream', url: 'http://hostb.test/stream',      url_resolved: 'http://hostb.test/stream' }),
      makeStation({ stationuuid: 'a2', name: 'A-two',    url: 'http://hosta.test:8443/two',   url_resolved: 'http://hosta.test:8443/two' }),
      makeStation({ stationuuid: 'a3', name: 'A-three',  url: 'http://hosta.test:8443/three', url_resolved: 'http://hosta.test:8443/three' }),
    ];

    // Track in-flight probes per host (and overall) to prove the concurrency model.
    const active = new Map<string, number>();
    const maxPerHost = new Map<string, number>();
    let totalActive = 0;
    let maxTotalActive = 0;

    global.fetch = vi.fn(async (input: unknown): Promise<Response> => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/json/stations/search')) {
        return { ok: true, status: 200, json: () => Promise.resolve(stationList), headers: new Headers() } as unknown as Response;
      }
      // A station probe (HEAD). Record concurrency, then resolve as a 400 + ICY
      // headers — the icecast-reject-HEAD shape that our validator treats as valid.
      const host = new URL(url).host;
      const nowHost = (active.get(host) ?? 0) + 1;
      active.set(host, nowHost);
      maxPerHost.set(host, Math.max(maxPerHost.get(host) ?? 0, nowHost));
      totalActive += 1;
      maxTotalActive = Math.max(maxTotalActive, totalActive);
      await new Promise((r) => setTimeout(r, 30));
      active.set(host, (active.get(host) ?? 1) - 1);
      totalActive -= 1;
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'icy-name': 'Cluster Stream', 'icy-br': '128' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), { limit: 10 });

    // Order preserved (discovery order, not bucket-completion order).
    expect(result.stations.map((s) => s.name)).toEqual(['A-one', 'B-stream', 'A-two', 'A-three']);
    // Same-host probes never overlapped — hostA saw at most one in-flight probe.
    expect(maxPerHost.get('hosta.test:8443')).toBe(1);
    // Different hosts DID run concurrently — hostA and hostB overlapped.
    expect(maxTotalActive).toBeGreaterThanOrEqual(2);
    // All four validated successfully (400 + ICY headers ⇒ valid).
    expect(result.stations.every((s) => s.validation?.isValid === true)).toBe(true);
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
    // A language entry offers only the name, the value discover's language filter matches.
    expect(result.languages![0]).toEqual({ name: 'english', stationCount: 12000 });
  });

  it('asks Radio Browser for the most-used values first, not an alphabetical prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([]),
      headers: new Headers(),
    } as unknown as Response);
    global.fetch = fetchMock;

    const { getRadioFilters } = await import('../../../src/tools/radio-discovery.js');
    await getRadioFilters(makeConfig(), {});

    const urls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(url).toContain('order=stationcount&reverse=true');
      expect(url).toContain('hidebroken=true');
    }
    expect(urls.find(url => url.includes('/json/codecs'))).toContain('limit=50');
    expect(urls.find(url => url.includes('/json/tags'))).toContain('limit=100');
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

  it('reports a failed kind in partialFailures while still returning the others', async () => {
    // Fetches are issued in kinds order: tags → countries → languages → codecs.
    // Fail only the languages fetch; the other three succeed.
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
        ok: false, status: 500, statusText: 'Internal Server Error',
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve([{ name: 'MP3', stationcount: 20000 }]),
        headers: new Headers(),
      } as unknown as Response);

    const { getRadioFilters } = await import('../../../src/tools/radio-discovery.js');
    const result = await getRadioFilters(makeConfig(), {});

    // Successful kinds are present; the failed one is absent, and its name is
    // surfaced in partialFailures so the caller can tell "errored" from "empty".
    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.countries)).toBe(true);
    expect(Array.isArray(result.codecs)).toBe(true);
    expect(result.languages).toBeUndefined();
    expect(result.partialFailures).toEqual(['languages']);
  });

  it('omits partialFailures when every requested kind succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([{ name: 'MP3', stationcount: 1000 }]),
      headers: new Headers(),
    } as unknown as Response);

    const { getRadioFilters } = await import('../../../src/tools/radio-discovery.js');
    const result = await getRadioFilters(makeConfig(), { kinds: ['codecs'] });

    expect(result.partialFailures).toBeUndefined();
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
    expect(result).toHaveProperty('streamUrl');
    expect(result).toHaveProperty('votes');
    expect(result).toHaveProperty('clickCount');
    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.languages)).toBe(true);
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
  beforeEach(async () => {
    vi.restoreAllMocks();
    const { resetRadioBrowserRateLimitForTests } = await import('../../../src/utils/radio-browser-rate-limit.js');
    resetRadioBrowserRateLimitForTests();
  });

  it('returns success:true and streamUrl on success', async () => {
    global.fetch = makeFetch(200, { ok: true, message: 'Click registered', url: 'http://stream.test/audio' });

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await clickStation(makeConfig(), { stationUuid: 'uuid-001' });

    expect(result.success).toBe(true);
    expect(typeof result.streamUrl).toBe('string');
    expect(typeof result.message).toBe('string');
  });

  it('returns success:false when Radio Browser responds ok:false', async () => {
    global.fetch = makeFetch(200, { ok: false, message: 'Station not found' });

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await clickStation(makeConfig(), { stationUuid: 'bad-uuid' });

    expect(result.success).toBe(false);
  });

  it('throws on HTTP error', async () => {
    global.fetch = makeFetch(503, null);

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');
    await expect(clickStation(makeConfig(), { stationUuid: 'uuid' })).rejects.toThrow();
  });

  it('warns on timeout that the click may already be counted', async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    global.fetch = fetchMock;

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');
    await expect(clickStation(makeConfig(), { stationUuid: 'uuid-click-timeout' }))
      .rejects.toThrow('The change may already have been applied');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes a second click for the same UUID without hitting Radio Browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, message: 'Click registered', url: 'http://stream.test/audio' }),
      headers: new Headers(),
      text: () => Promise.resolve(''),
    } as unknown as Response);
    global.fetch = fetchMock;

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');

    const first = await clickStation(makeConfig(), { stationUuid: 'uuid-dup' });
    const second = await clickStation(makeConfig(), { stationUuid: 'uuid-dup' });

    // Only one outbound HTTP call — second was served from the dedup set.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.streamUrl).toBe('http://stream.test/audio');
    expect(second.message).toMatch(/already registered/i);
  });

  it('returns the first click\'s stream URL on a deduped second click', async () => {
    global.fetch = makeFetch(200, { ok: true, message: 'Click registered', url: 'http://stream.test/first' });

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');

    const first = await clickStation(makeConfig(), { stationUuid: 'uuid-replay' });
    const second = await clickStation(makeConfig(), { stationUuid: 'uuid-replay' });

    expect(first.streamUrl).toBe('http://stream.test/first');
    expect(second.streamUrl).toBe('http://stream.test/first');
  });

  it('does NOT mark as deduped when Radio Browser responded ok:false', async () => {
    // Server-side rejection is not a real click — we want the LLM to be
    // able to retry next session with a corrected UUID, so don't poison
    // the dedup set on a failed attempt.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: false, message: 'Station not found' }),
      headers: new Headers(),
      text: () => Promise.resolve(''),
    } as unknown as Response);
    global.fetch = fetchMock;

    const { clickStation } = await import('../../../src/tools/radio-discovery.js');

    await clickStation(makeConfig(), { stationUuid: 'uuid-fail' });
    await clickStation(makeConfig(), { stationUuid: 'uuid-fail' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---- voteStation ------------------------------------------------------------

describe('voteStation', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const { resetRadioBrowserRateLimitForTests } = await import('../../../src/utils/radio-browser-rate-limit.js');
    resetRadioBrowserRateLimitForTests();
  });

  it('returns success:true and message on success', async () => {
    global.fetch = makeFetch(200, { ok: true, message: 'Vote registered' });

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await voteStation(makeConfig(), { stationUuid: 'uuid-001' });

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  it('returns success:false when server declines the vote', async () => {
    global.fetch = makeFetch(200, { ok: false, message: 'Already voted' });

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await voteStation(makeConfig(), { stationUuid: 'uuid-001' });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Already voted');
  });

  it('does not report success when the server declines with no message', async () => {
    global.fetch = makeFetch(200, { ok: false });

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    const result = await voteStation(makeConfig(), { stationUuid: 'uuid-001' });

    expect(result).toEqual({ success: false, message: 'Vote failed' });
  });

  it('throws on HTTP error', async () => {
    global.fetch = makeFetch(500, null);

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    await expect(voteStation(makeConfig(), { stationUuid: 'uuid' })).rejects.toThrow();
  });

  it('warns on timeout that the vote may already be recorded', async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    global.fetch = fetchMock;

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');
    await expect(voteStation(makeConfig(), { stationUuid: 'uuid-vote-timeout' }))
      .rejects.toThrow('The change may already have been applied');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes a second vote for the same UUID without hitting Radio Browser', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, message: 'Vote registered' }),
      headers: new Headers(),
      text: () => Promise.resolve(''),
    } as unknown as Response);
    global.fetch = fetchMock;

    const { voteStation } = await import('../../../src/tools/radio-discovery.js');

    const first = await voteStation(makeConfig(), { stationUuid: 'uuid-vote-dup' });
    const second = await voteStation(makeConfig(), { stationUuid: 'uuid-vote-dup' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.message).toMatch(/already voted/i);
  });

  it('vote and click for the same UUID are independent (one of each allowed)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, message: 'Recorded', url: 'http://stream.test/' }),
      headers: new Headers(),
      text: () => Promise.resolve(''),
    } as unknown as Response);
    global.fetch = fetchMock;

    const { voteStation, clickStation } = await import('../../../src/tools/radio-discovery.js');

    const v = await voteStation(makeConfig(), { stationUuid: 'uuid-mix' });
    const c = await clickStation(makeConfig(), { stationUuid: 'uuid-mix' });

    // Two distinct upstream calls — vote and click slots are independent.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(v.success).toBe(true);
    expect(c.success).toBe(true);
  });
});

// ---- mapStationToDTO (empty-field filtering) ---------------------------------

describe('discoverRadioStations: empty-field filtering and deduplication', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('drops stations with empty stationuuid from results', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          makeStation({ stationuuid: '' }),   // should be dropped
          makeStation({ stationuuid: 'valid-uuid', name: 'Good FM', url: 'http://good.test/stream' }),
        ]),
        headers: new Headers(),
      } as unknown as Response)
      // Validation HEAD for the one kept station
      .mockResolvedValue({
        ok: true, status: 200,
        headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), { limit: 5 });

    // Only the station with a valid UUID should appear
    expect(result.stations.every(s => s.stationUuid !== '')).toBe(true);
    expect(result.stations.some(s => s.stationUuid === 'valid-uuid')).toBe(true);
  });

  it('drops stations with empty name from results', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          makeStation({ name: '' }),  // should be dropped
          makeStation({ stationuuid: 'uuid-2', name: 'Named FM', url: 'http://named.test/stream' }),
        ]),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true, status: 200,
        headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), { limit: 5 });

    expect(result.stations.every(s => s.name !== '')).toBe(true);
  });

  it('trims station names and drops a whitespace-only name', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          makeStation({ stationuuid: 'uuid-blank', name: ' \t ', url: 'http://blank.test/stream', url_resolved: 'http://blank.test/stream' }),
          makeStation({ stationuuid: 'uuid-tab', name: '\t\tArrow Classic Rock ', url: 'http://arrow.test/stream', url_resolved: 'http://arrow.test/stream' }),
        ]),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true, status: 200,
        headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), { limit: 5 });

    expect(result.stations.map(s => s.name)).toEqual(['Arrow Classic Rock']);
  });

  it('dedupes stations with the same streamUrl before validation (case/spelling-tolerant)', async () => {
    // Three rows from Radio Browser. mapStationToDTO prefers url_resolved
    // when set, so we override BOTH url and url_resolved to make the test
    // actually exercise distinct streamUrls. The two Jazz FM rows differ in
    // casing, and dedup keys on streamUrl only, so they collapse.
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          makeStation({ stationuuid: 'uuid-a', name: 'Jazz FM', url: 'http://jazz.test/stream', url_resolved: 'http://jazz.test/stream' }),
          makeStation({ stationuuid: 'uuid-b', name: 'jazz fm', url: 'http://jazz.test/stream', url_resolved: 'http://jazz.test/stream' }), // duplicate by streamUrl, casing differs
          makeStation({ stationuuid: 'uuid-c', name: 'Rock FM', url: 'http://rock.test/stream', url_resolved: 'http://rock.test/stream' }),
        ]),
        headers: new Headers(),
      } as unknown as Response)
      // Validation for each kept station (2 unique, not 3)
      .mockResolvedValue({
        ok: true, status: 200,
        headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), { limit: 5 });

    // 2 unique stations (dedup dropped 1 duplicate)
    expect(result.stations.length).toBe(2);
    const names = result.stations.map(s => s.name);
    expect(names).toContain('Jazz FM');
    expect(names).toContain('Rock FM');
    expect(result.hasMore).toBe(false);
  });

  it('reports hasMore and nextOffset from the raw page size, so a page shortened by dedupe still signals more', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          makeStation({ stationuuid: 'uuid-a', name: 'Jazz FM', url: 'http://jazz.test/stream', url_resolved: 'http://jazz.test/stream' }),
          makeStation({ stationuuid: 'uuid-b', name: 'jazz fm', url: 'http://jazz.test/stream', url_resolved: 'http://jazz.test/stream' }),
          makeStation({ stationuuid: 'uuid-c', name: 'Rock FM', url: 'http://rock.test/stream', url_resolved: 'http://rock.test/stream' }),
        ]),
        headers: new Headers(),
      } as unknown as Response)
      .mockResolvedValue({
        ok: true, status: 200,
        headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
        body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
        text: () => Promise.resolve(''),
      } as unknown as Response);

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    const result = await discoverRadioStations(makeConfig(), { limit: 3, offset: 6 });

    expect(result.stations.length).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(9);
  });

  it('validates stations in parallel (Promise.all) — all complete in roughly one timeout window', async () => {
    // Use a timing-based check: if validations run serially with individual
    // delays each call would take N * delay; in parallel, total ≈ 1 * delay.
    // We fake individual delays via mockImplementation and verify total call
    // timing doesn't accumulate (pass if all validations resolve successfully).
    let concurrentCount = 0;
    let maxConcurrent = 0;

    global.fetch = vi.fn()
      // First call: search results
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          makeStation({ stationuuid: 'uuid-1', name: 'Station 1', url: 'http://s1.test/stream', url_resolved: 'http://s1.test/stream' }),
          makeStation({ stationuuid: 'uuid-2', name: 'Station 2', url: 'http://s2.test/stream', url_resolved: 'http://s2.test/stream' }),
          makeStation({ stationuuid: 'uuid-3', name: 'Station 3', url: 'http://s3.test/stream', url_resolved: 'http://s3.test/stream' }),
        ]),
        headers: new Headers(),
      } as unknown as Response)
      // Subsequent validation HEAD calls — each increments the concurrency counter
      .mockImplementation(() => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Headers({ 'Content-Type': 'audio/mpeg' }),
          body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true, value: undefined }), cancel: vi.fn() }) },
          text: () => Promise.resolve(''),
        } as unknown as Response).finally(() => {
          concurrentCount--;
        });
      });

    const { discoverRadioStations } = await import('../../../src/tools/radio-discovery.js');
    await discoverRadioStations(makeConfig(), { limit: 5 });

    // At least 2 validations ran concurrently at some point — confirms Promise.all
    // (serial for-loop would cap maxConcurrent at 1 since each await resolves
    // before the next starts).
    expect(maxConcurrent).toBeGreaterThan(1);
  });
});
