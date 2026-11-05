/**
 * Navidrome MCP Server - Last.fm and LRCLIB parsing and error-path tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from '../../../src/config.js';
import { makeTestConfig } from '../../helpers/test-config.js';

function makeMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...makeTestConfig(),
    navidromeUrl: 'http://mock-server:4533',
    navidromeUsername: 'testuser',
    navidromePassword: 'testpass',
    debug: false,
    tokenExpiry: 86400,
    features: {
      lastfm: true,
      radioBrowser: false,
      lyrics: true,
      playback: false,
    },
    lastFmApiKey: 'test-api-key',
    lyricsProvider: 'lrclib',
    lrclibUserAgent: 'TestAgent/1.0',
    lrclibBase: 'https://lrclib.net',
    playbackTranscodeFormat: 'mp3',
    playbackTranscodeBitrate: '192',
    filterCacheEnabled: true,
    ...overrides,
  };
}

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

// NaN serializes to null in JSON, so a non-numeric match must fall back to a finite 0.
describe('Last.fm match field parsing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getSimilarArtists: match is 0 when Last.fm returns a non-numeric string', async () => {
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

    const matchValue = result.similarArtists[0]?.match;

    expect(Number.isFinite(matchValue)).toBe(true);
    expect(matchValue).toBe(0);
  });

  it('getSimilarArtists: match is 0 when Last.fm returns null', async () => {
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

    const matchValue = result.similarArtists[0]?.match;
    expect(Number.isFinite(matchValue)).toBe(true);
    expect(matchValue).toBe(0);
  });

  it('getSimilarArtists: valid numeric string is parsed correctly', async () => {
    // Last.fm sends match as a numeric string such as "0.823".
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

  it('getSimilarTracks: match is 0 when Last.fm returns a non-numeric string', async () => {
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
    expect(Number.isFinite(matchValue)).toBe(true);
    expect(matchValue).toBe(0);
  });

  it('JSON serializes a NaN match as null', () => {
    expect(JSON.stringify({ match: NaN })).toBe('{"match":null}');
    expect(JSON.parse(JSON.stringify({ match: NaN })).match).toBeNull();
  });
});

describe('Last.fm error:0 handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('callLastFmApi does NOT throw when response contains error:0 (success signal)', async () => {
    // Some legacy Last.fm endpoints return error:0 with no message on success.
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

    await expect(getSimilarArtists(config, { artist: 'Portishead', limit: 5 }))
      .resolves.toMatchObject({ count: 1 });
  });

  it('callLastFmApi still throws for real Last.fm errors (error:6 = artist not found)', async () => {
    // Last.fm reports an unknown artist as error 6, its invalid-parameters code.
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
    const errorWithNoMessage = {
      error: 8,
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

describe('LRCLIB transport errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolveLyricsByMetadata propagates 5xx transport error (not silently "not found")', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(503, null, 'Service Unavailable'));

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      resolveLyricsByMetadata(config, { title: 'Creep', artist: 'Radiohead' })
    ).rejects.toThrow();
  });

  it('resolveLyricsByMetadata propagates 429 rate-limit as an error (not silently "not found")', async () => {
    // LRCLIB rate-limits with 429, which a missing or wrong User-Agent tends to trigger.
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(429, null, 'Too Many Requests'));

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      resolveLyricsByMetadata(config, { title: 'Fake Plastic Trees', artist: 'Radiohead' })
    ).rejects.toThrow();
  });

  it('resolveLyricsByMetadata propagates network failure (fetch throws) as an error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error: ECONNREFUSED'));

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      resolveLyricsByMetadata(config, { title: 'Creep', artist: 'Radiohead' })
    ).rejects.toThrow();
  });

  it('resolveLyricsByMetadata rejects an empty title', async () => {
    // LyricsMetadataSchema rejects an empty title or artist before any fetch.
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      resolveLyricsByMetadata(config, { title: '', artist: 'Radiohead' })
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolveLyricsByMetadata rejects an empty artist', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    await expect(
      resolveLyricsByMetadata(config, { title: 'Creep', artist: '' })
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolveLyricsByMetadata still returns "no lyrics found" shape on genuine 404 from /api/get (song not in LRCLIB)', async () => {
    // LRCLIB answers a missing exact match with 404, and an empty search with 200 and [].
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse(404, null, 'Not Found'))  // /api/get
      .mockResolvedValueOnce(makeFetchResponse(200, [], 'OK'));            // /api/search

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await resolveLyricsByMetadata(config, {
      title: 'SongThatDoesNotExist99999',
      artist: 'NoSuchArtist',
    });

    expect(result).toMatchObject({
      track: { title: 'SongThatDoesNotExist99999', artist: 'NoSuchArtist' },
      provider: 'lrclib',
    });
    expect(result.synced).toBeUndefined();
    expect(result.unsynced).toBeUndefined();
  });

  it('resolveLyricsByMetadata returns "no lyrics found" when /api/get returns 404 and /api/search returns empty array', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse(404, null, 'Not Found'))  // /api/get
      .mockResolvedValueOnce(makeFetchResponse(200, [], 'OK'));            // /api/search

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await resolveLyricsByMetadata(config, { title: 'GhostSong', artist: 'GhostArtist' });

    expect(result).toHaveProperty('provider', 'lrclib');
    expect(result.synced).toBeUndefined();
    expect(result.unsynced).toBeUndefined();
  });

  it('resolveLyricsByMetadata returns valid lyrics when both exact and search return 200', async () => {
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

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await resolveLyricsByMetadata(config, { title: 'Creep', artist: 'Radiohead' });

    expect(result).toMatchObject({
      track: { title: 'Creep', artist: 'Radiohead' },
      provider: 'lrclib',
    });
    expect(result.unsynced).toContain('When you were here before');
    expect(result.synced).toBeDefined();
    expect(result.synced?.length).toBeGreaterThan(0);
  });

  it('resolveLyricsByMetadata parses 3-digit millisecond LRC timestamps (does not silently drop them)', async () => {
    // Community LRCLIB lyrics mix 2-digit centisecond and 3-digit millisecond fractions.
    const lrclibResponse = {
      id: 456,
      trackName: 'Precise',
      artistName: 'Test Artist',
      albumName: 'Test Album',
      duration: 120,
      instrumental: false,
      plainLyrics: 'Line one\nLine two',
      syncedLyrics: '[00:01.05]Line one\n[00:09.123]Line two\n[00:10.500]Line three',
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, lrclibResponse));

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await resolveLyricsByMetadata(config, { title: 'Precise', artist: 'Test Artist' });

    expect(result.synced).toBeDefined();
    expect(result.synced).toHaveLength(3);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1050, text: 'Line one' });
    expect(result.synced?.[1]).toMatchObject({ timeMs: 9123, text: 'Line two' });
    expect(result.synced?.[2]).toMatchObject({ timeMs: 10500, text: 'Line three' });
  });

  it('resolveLyricsByMetadata keeps lines whose timestamp tag is not the first char (leading whitespace/CR/indent)', async () => {
    // Community LRC text can carry a leading space, a stray `\r` from CRLF endings, or
    // indentation before the timestamp tag.
    const lrclibResponse = {
      id: 789,
      trackName: 'Whitespace',
      artistName: 'Test Artist',
      albumName: 'Test Album',
      duration: 120,
      instrumental: false,
      plainLyrics: 'One\nTwo\nThree',
      syncedLyrics: ' [00:01.00]One\n\r[00:02.00]Two\n\t[00:03.00]Three',
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, lrclibResponse));

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await resolveLyricsByMetadata(config, { title: 'Whitespace', artist: 'Test Artist' });

    expect(result.synced).toBeDefined();
    expect(result.synced).toHaveLength(3);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1000, text: 'One' });
    expect(result.synced?.[1]).toMatchObject({ timeMs: 2000, text: 'Two' });
    expect(result.synced?.[2]).toMatchObject({ timeMs: 3000, text: 'Three' });
  });

  it('resolveLyricsByMetadata splits grouped timestamps separated by whitespace (no bracket leak into text)', async () => {
    // LRC groups the timestamps of a repeated section on one line, and some files put a space
    // between the grouped tags, such as `[..] [..]lyric`.
    const lrclibResponse = {
      id: 790,
      trackName: 'Grouped',
      artistName: 'Test Artist',
      albumName: 'Test Album',
      duration: 120,
      instrumental: false,
      plainLyrics: 'Chorus',
      syncedLyrics: '[00:01.00] [00:05.00]Chorus',
    };
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(200, lrclibResponse));

    const { resolveLyricsByMetadata } = await import('../../../src/tools/lyrics.js');
    const config = makeMockConfig();

    const result = await resolveLyricsByMetadata(config, { title: 'Grouped', artist: 'Test Artist' });

    expect(result.synced).toBeDefined();
    expect(result.synced).toHaveLength(2);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1000, text: 'Chorus' });
    expect(result.synced?.[1]).toMatchObject({ timeMs: 5000, text: 'Chorus' });
  });
});
