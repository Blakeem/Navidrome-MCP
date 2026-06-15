/**
 * Navidrome MCP Server - Bug Reproduction Tests for Last.fm and LRCLIB Integration
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Reproduction and regression tests for three HIGH-severity bugs:
 *
 * Claim A — `match: NaN` from malformed Last.fm payloads
 *   Last.fm `getSimilarArtists` / `getSimilarTracks` use parseFloat() on the `match`
 *   field. When the field is an unexpected string (e.g. "unknown"), parseFloat returns
 *   NaN. NaN serializes as null in JSON, breaking any client filter on match >= 0.5.
 *
 * Claim B — `error: 0` false positive in callLastFmApi
 *   The guard `data['error'] !== null && data['error'] !== undefined` evaluates true
 *   for error:0, which Last.fm can return for success on some legacy endpoints.
 *   Also, missing `message` produces the error string "Last.fm API error: undefined".
 *
 * Claim C — Lyrics transport errors swallowed as "not found"
 *   `tryExactMatch` catches ALL errors (including 5xx, network failures) and returns
 *   null. A misconfigured LRCLIB_USER_AGENT or a downed server looks identical to
 *   "song not in LRCLIB". `searchLyrics` has the same catch-all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from '../../../src/config.js';

// ---- helpers ---------------------------------------------------------------

function makeMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    navidromeUrl: 'http://mock-server:4533',
    navidromeUsername: 'testuser',
    navidromePassword: 'testpass',
    debug: false,
    cacheTtl: 300,
    tokenExpiry: 86400,
    features: {
      lastfm: true,
      radioBrowser: false,
      lyrics: true,
      playback: false,
    },
    lastFmApiKey: 'test-api-key',
    radioBrowserBase: 'https://de1.api.radio-browser.info',
    lyricsProvider: 'lrclib',
    lrclibUserAgent: 'TestAgent/1.0',
    lrclibBase: 'https://lrclib.net',
    playbackTranscodeFormat: 'mp3',
    playbackTranscodeBitrate: '192',
    filterCacheEnabled: true,
    ...overrides,
  };
}

// Build a minimal Response-like object for mocking fetch
function makeFetchResponse(status: number, body: unknown, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

// ============================================================================
// CLAIM A — `match: NaN` from malformed payloads
// ============================================================================

describe('Claim A — Last.fm match field NaN handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getSimilarArtists: match is NaN when Last.fm returns a non-numeric string', async () => {
    // Arrange: Last.fm returns `match: "unknown"` — a real edge case on sparse data
    const malformedResponse = {
      similarartists: {
        artist: [
          { name: 'Radiohead', match: 'unknown', url: 'https://last.fm/radiohead', mbid: '' },
        ],
      },
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, malformedResponse));

    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeMockConfig();

    const result = await getSimilarArtists(config, { artist: 'Thom Yorke', limit: 5 });

    // BEFORE FIX: match is NaN (fails Number.isFinite check)
    // This test documents the bug — after fixing, it must be a finite number
    const matchValue = result.similarArtists[0]?.match;

    // The fix must produce a finite fallback (0), not NaN
    expect(Number.isFinite(matchValue)).toBe(true);
    expect(matchValue).toBe(0);
  });

  it('getSimilarArtists: match is NaN when Last.fm returns null (not caught by ??)', async () => {
    // When match is explicitly null, `null ?? 0` = 0 → "0" → parseFloat("0") = 0 — OK
    // But String(null) = "null" → parseFloat("null") = NaN — this case tests the real path
    const responseWithNull = {
      similarartists: {
        artist: [
          { name: 'Portishead', match: null, url: 'https://last.fm/portishead', mbid: null },
        ],
      },
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, responseWithNull));

    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeMockConfig();

    const result = await getSimilarArtists(config, { artist: 'Massive Attack', limit: 5 });

    // With the fix: null → safeNumber(null, 0) → 0 (finite)
    const matchValue = result.similarArtists[0]?.match;
    expect(Number.isFinite(matchValue)).toBe(true);
    expect(matchValue).toBe(0);
  });

  it('getSimilarArtists: valid numeric string is parsed correctly', async () => {
    // Last.fm actually returns match as a string like "0.823"
    const validResponse = {
      similarartists: {
        artist: [
          { name: 'Mogwai', match: '0.823', url: 'https://last.fm/mogwai', mbid: '' },
        ],
      },
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, validResponse));

    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeMockConfig();

    const result = await getSimilarArtists(config, { artist: 'Explosions in the Sky', limit: 5 });

    const matchValue = result.similarArtists[0]?.match;
    expect(Number.isFinite(matchValue)).toBe(true);
    expect(matchValue).toBeCloseTo(0.823);
  });

  it('getSimilarTracks: match is NaN when Last.fm returns a non-numeric string', async () => {
    const malformedResponse = {
      similartracks: {
        track: [
          {
            name: 'Creep',
            match: 'unknown',
            url: 'https://last.fm/creep',
            mbid: '',
            artist: { name: 'Radiohead' },
          },
        ],
      },
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, malformedResponse));

    const { getSimilarTracks } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeMockConfig();

    const result = await getSimilarTracks(config, {
      artist: 'Radiohead',
      track: 'Fake Plastic Trees',
      limit: 5,
    });

    const matchValue = result.similarTracks[0]?.match;
    // After fix: must be 0 (finite fallback), not NaN
    expect(Number.isFinite(matchValue)).toBe(true);
    expect(matchValue).toBe(0);
  });

  it('getSimilarArtists: match NaN round-trips to null in JSON (documents the data corruption)', () => {
    // This test documents WHY NaN is harmful: JSON.stringify(NaN) = "null"
    // A downstream filter `match >= 0.5` would silently drop all NaN entries
    expect(JSON.stringify({ match: NaN })).toBe('{"match":null}');
    expect(JSON.parse(JSON.stringify({ match: NaN })).match).toBeNull();
  });
});

// ============================================================================
// CLAIM B — `error: 0` false positive
// ============================================================================

describe('Claim B — Last.fm error:0 false positive', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('callLastFmApi does NOT throw when response contains error:0 (success signal)', async () => {
    // Some legacy Last.fm endpoints return error:0 with no message on success
    const legacySuccessResponse = {
      error: 0,
      similarartists: {
        artist: [
          { name: 'Portishead', match: '0.9', url: 'https://last.fm/portishead', mbid: '' },
        ],
      },
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, legacySuccessResponse));

    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeMockConfig();

    // BEFORE FIX: this throws "Last.fm API error: undefined" because
    //   `data['error'] !== null && data['error'] !== undefined` is true for 0
    // AFTER FIX: must succeed — error:0 means no error. `artist` is no
    // longer echoed in the response (LLM input echo), so assert on the
    // shape that survives — count + a non-empty similarArtists array.
    await expect(getSimilarArtists(config, { artist: 'Portishead', limit: 5 }))
      .resolves.toMatchObject({ count: 1 });
  });

  it('callLastFmApi still throws for real Last.fm errors (error:6 = artist not found)', async () => {
    // Last.fm error codes: 6 = Invalid parameters (artist not found)
    const errorResponse = {
      error: 6,
      message: 'The artist you supplied could not be found',
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, errorResponse));

    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeMockConfig();

    await expect(getSimilarArtists(config, { artist: 'NonExistentArtist123456', limit: 5 }))
      .rejects.toThrow('The artist you supplied could not be found');
  });

  it('callLastFmApi error message does not contain "undefined" when message field is missing', async () => {
    // When error is thrown with no `message` field, the old code produces
    // `Last.fm API error: undefined` — confusing to the user/LLM
    const errorWithNoMessage = {
      error: 8,
      // no message field
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, errorWithNoMessage));

    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeMockConfig();

    await expect(getSimilarArtists(config, { artist: 'test', limit: 5 }))
      .rejects.toSatisfy((err: unknown) => {
        if (!(err instanceof Error)) return false;
        return !err.message.includes('undefined');
      });
  });
});

// ============================================================================
// CLAIM C — Lyrics transport errors swallowed as "not found"
// ============================================================================

describe('Claim C — Lyrics transport errors visible vs. swallowed', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getLyrics propagates 5xx transport error (not silently "not found")', async () => {
    // A 503 from LRCLIB (e.g., service down) should NOT silently return "no lyrics"
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(503, null, 'Service Unavailable'));

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    // BEFORE FIX: getLyrics resolves to a valid LyricsDTO with no lyrics (silent failure)
    // AFTER FIX: must throw (transport error visible to caller)
    await expect(
      getLyrics(config, { title: 'Creep', artist: 'Radiohead' })
    ).rejects.toThrow();
  });

  it('getLyrics propagates 429 rate-limit as an error (not silently "not found")', async () => {
    // A 429 response (rate-limited, often from a missing/wrong User-Agent) must surface
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(429, null, 'Too Many Requests'));

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      getLyrics(config, { title: 'Fake Plastic Trees', artist: 'Radiohead' })
    ).rejects.toThrow();
  });

  it('getLyrics propagates network failure (fetch throws) as an error', async () => {
    // A total network failure (e.g., misconfigured LRCLIB_BASE)
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error: ECONNREFUSED'));

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      getLyrics(config, { title: 'Creep', artist: 'Radiohead' })
    ).rejects.toThrow();
  });

  it('getLyrics rejects an empty title (schema dedup → stricter .min(1) validation)', async () => {
    // After dedup onto the canonical GetLyricsSchema, title/artist carry .min(1),
    // so an empty title is rejected before any network call. fetch must not run.
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      getLyrics(config, { title: '', artist: 'Radiohead' })
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getLyrics rejects an empty artist (schema dedup → stricter .min(1) validation)', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      getLyrics(config, { title: 'Creep', artist: '' })
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getLyrics still returns "no lyrics found" shape on genuine 404 from /api/get (song not in LRCLIB)', async () => {
    // 404 on /api/get = song not in LRCLIB by exact lookup — legitimate "not found".
    // The search endpoint then returns 200 with an empty array (its standard "no results" shape).
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse(404, null, 'Not Found'))  // /api/get
      .mockResolvedValueOnce(makeFetchResponse(200, [], 'OK'));            // /api/search

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await getLyrics(config, {
      title: 'SongThatDoesNotExist99999',
      artist: 'NoSuchArtist',
    });

    // Must resolve (not throw) and return a proper LyricsDTO with no lyrics content
    expect(result).toMatchObject({
      track: { title: 'SongThatDoesNotExist99999', artist: 'NoSuchArtist' },
      provider: 'lrclib',
    });
    expect(result.synced).toBeUndefined();
    expect(result.unsynced).toBeUndefined();
  });

  it('getLyrics returns "no lyrics found" when /api/get returns 404 and /api/search returns empty array', async () => {
    // LRCLIB search returns 200 + [] when no results exist (not 404).
    // This is the standard "song not in LRCLIB" path.
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse(404, null, 'Not Found'))  // /api/get → not found
      .mockResolvedValueOnce(makeFetchResponse(200, [], 'OK'));            // /api/search → empty

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await getLyrics(config, { title: 'GhostSong', artist: 'GhostArtist' });

    expect(result).toHaveProperty('provider', 'lrclib');
    expect(result.synced).toBeUndefined();
    expect(result.unsynced).toBeUndefined();
  });

  it('getLyrics returns valid lyrics when both exact and search return 200', async () => {
    // Normal happy path — confirm it still works after the fix
    const lrclibResponse = {
      id: 123,
      trackName: 'Creep',
      artistName: 'Radiohead',
      albumName: 'Pablo Honey',
      duration: 238,
      instrumental: false,
      plainLyrics: 'When you were here before\nCouldn\'t look you in the eye',
      syncedLyrics: '[00:09.00]When you were here before\n[00:13.00]Couldn\'t look you in the eye',
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, lrclibResponse));

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await getLyrics(config, { title: 'Creep', artist: 'Radiohead' });

    expect(result).toMatchObject({
      track: { title: 'Creep', artist: 'Radiohead' },
      provider: 'lrclib',
    });
    expect(result.unsynced).toContain('When you were here before');
    expect(result.synced).toBeDefined();
    expect(result.synced?.length).toBeGreaterThan(0);
  });

  it('getLyrics parses 3-digit millisecond LRC timestamps (does not silently drop them)', async () => {
    // LRC permits 3-digit milliseconds (e.g. [00:09.123]) alongside the more
    // common 2-digit centiseconds. Community-sourced LRCLIB lyrics mix both.
    // Regression: the old regex required exactly 2 fractional digits, so any
    // ms-precision line failed to match and was silently dropped from `synced`.
    const lrclibResponse = {
      id: 456,
      trackName: 'Precise',
      artistName: 'Test Artist',
      albumName: 'Test Album',
      duration: 120,
      instrumental: false,
      plainLyrics: 'Line one\nLine two',
      // Mixed precision: centiseconds (.05), milliseconds (.123), milliseconds (.500)
      syncedLyrics: '[00:01.05]Line one\n[00:09.123]Line two\n[00:10.500]Line three',
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, lrclibResponse));

    const { getLyrics } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await getLyrics(config, { title: 'Precise', artist: 'Test Artist' });

    // All three lines must survive — none dropped due to precision mismatch.
    expect(result.synced).toBeDefined();
    expect(result.synced).toHaveLength(3);
    // .05  centiseconds → 1s + 50ms  = 1050ms
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1050, text: 'Line one' });
    // .123 milliseconds → 9s + 123ms = 9123ms (treated as ms, not cs*10)
    expect(result.synced?.[1]).toMatchObject({ timeMs: 9123, text: 'Line two' });
    // .500 milliseconds → 10s + 500ms = 10500ms
    expect(result.synced?.[2]).toMatchObject({ timeMs: 10500, text: 'Line three' });
  });
});
