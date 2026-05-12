/**
 * Navidrome MCP Server - lastfm-discovery happy-path tests
 * Copyright (C) 2025
 *
 * Covers the five Last.fm tools with mocked fetch responses.
 * Bug-fix regression cases live in lastfm-lyrics-bugs.test.ts; this file
 * adds function-level happy-path structural coverage.
 *
 * NOTE: `lastfm-lyrics-bugs.test.ts` already imports getSimilarArtists /
 * getSimilarTracks extensively. This file covers getArtistInfo,
 * getTopTracksByArtist, and getTrendingMusic (all three modes), and adds
 * one missing-apiKey guard for each function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../../src/config.js';

// ---- helpers ----------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    navidromeUrl: 'http://mock:4533',
    navidromeUsername: 'u',
    navidromePassword: 'p',
    debug: false,
    cacheTtl: 300,
    tokenExpiry: 86400,
    features: { lastfm: true, radioBrowser: false, lyrics: false, playback: false },
    lastFmApiKey: 'test-key',
    radioBrowserBase: 'https://de1.api.radio-browser.info',
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

// ---- getArtistInfo ----------------------------------------------------------

describe('getArtistInfo', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('throws when LASTFM_API_KEY is missing', async () => {
    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeConfig({ lastFmApiKey: '' });
    await expect(getArtistInfo(config, { artist: 'Radiohead' })).rejects.toThrow(/LASTFM_API_KEY/);
  });

  it('returns artist info DTO shape from happy-path response', async () => {
    const mockBody = {
      artist: {
        name: 'Radiohead',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        url: 'https://www.last.fm/music/Radiohead',
        stats: { listeners: '4000000', playcount: '150000000' },
        bio: { summary: 'An English band. <a href="more">more</a>' },
        tags: { tag: [{ name: 'alternative', url: 'https://last.fm/tag/alternative' }] },
        similar: { artist: [{ name: 'Thom Yorke' }, { name: 'Portishead' }] },
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getArtistInfo(makeConfig(), { artist: 'Radiohead' });

    expect(typeof result.name).toBe('string');
    expect(typeof result.url).toBe('string');
    expect(typeof result.listeners).toBe('number');
    expect(Number.isFinite(result.listeners)).toBe(true);
    expect(typeof result.playcount).toBe('number');
    expect(Number.isFinite(result.playcount)).toBe(true);
    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.similar)).toBe(true);
    // biography has HTML stripped
    expect(result.biography).not.toContain('<a');
  });

  it('returns null biography when bio.summary is absent', async () => {
    const mockBody = {
      artist: {
        name: 'Unknown',
        url: '',
        stats: { listeners: '0', playcount: '0' },
        tags: { tag: [] },
        similar: { artist: [] },
        // no bio field
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getArtistInfo(makeConfig(), { artist: 'Unknown' });
    expect(result.biography).toBeNull();
  });

  it('throws when Last.fm returns HTTP error', async () => {
    global.fetch = makeFetch(503, null);
    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getArtistInfo(makeConfig(), { artist: 'Test' })).rejects.toThrow();
  });
});

// ---- getTopTracksByArtist ---------------------------------------------------

describe('getTopTracksByArtist', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('throws when LASTFM_API_KEY is missing', async () => {
    const { getTopTracksByArtist } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getTopTracksByArtist(makeConfig({ lastFmApiKey: '' }), { artist: 'Test' })).rejects.toThrow(/LASTFM_API_KEY/);
  });

  it('returns count + tracks array with expected fields', async () => {
    const mockBody = {
      toptracks: {
        track: [
          { name: 'Creep', playcount: '5000000', listeners: '2000000', url: 'https://last.fm/track/Creep', mbid: 'abc' },
          { name: 'Karma Police', playcount: '4000000', listeners: '1800000', url: 'https://last.fm/track/KP', mbid: '' },
        ],
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getTopTracksByArtist } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTopTracksByArtist(makeConfig(), { artist: 'Radiohead', limit: 5 });

    expect(result.count).toBe(2);
    expect(Array.isArray(result.tracks)).toBe(true);
    expect(result.tracks).toHaveLength(2);

    const first = result.tracks[0]!;
    expect(typeof first.rank).toBe('number');
    expect(typeof first.name).toBe('string');
    expect(typeof first.playcount).toBe('number');
    expect(Number.isFinite(first.playcount)).toBe(true);
    expect(typeof first.listeners).toBe('number');
    expect(typeof first.url).toBe('string');
    // rank starts at 1
    expect(first.rank).toBe(1);
    expect(result.tracks[1]!.rank).toBe(2);
  });

  it('returns count=0 when Last.fm returns no tracks', async () => {
    global.fetch = makeFetch(200, { toptracks: { track: [] } });
    const { getTopTracksByArtist } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTopTracksByArtist(makeConfig(), { artist: 'Obscure' });
    expect(result.count).toBe(0);
    expect(result.tracks).toHaveLength(0);
  });
});

// ---- getTrendingMusic -------------------------------------------------------

describe('getTrendingMusic — artists', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('throws when LASTFM_API_KEY is missing', async () => {
    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getTrendingMusic(makeConfig({ lastFmApiKey: '' }), { type: 'artists' })).rejects.toThrow(/LASTFM_API_KEY/);
  });

  it('returns trending artists with rank, name, playcount, listeners', async () => {
    const mockBody = {
      artists: {
        artist: [
          { name: 'Taylor Swift', playcount: '900000000', listeners: '10000000', url: 'https://last.fm/ts', mbid: '' },
        ],
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTrendingMusic(makeConfig(), { type: 'artists', limit: 5 });

    expect(result.count).toBe(1);
    const item = result.items[0] as { rank: number; name: string; playcount: number; listeners: number };
    expect(item.rank).toBe(1);
    expect(typeof item.name).toBe('string');
    expect(Number.isFinite(item.playcount)).toBe(true);
    expect(Number.isFinite(item.listeners)).toBe(true);
  });
});

describe('getTrendingMusic — tracks', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns trending tracks with artist field', async () => {
    const mockBody = {
      tracks: {
        track: [
          {
            name: 'Blinding Lights',
            playcount: '500000000',
            listeners: '8000000',
            url: 'https://last.fm/track/bl',
            mbid: '',
            artist: { name: 'The Weeknd' },
          },
        ],
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTrendingMusic(makeConfig(), { type: 'tracks', limit: 5 });

    expect(result.count).toBe(1);
    const item = result.items[0] as { name: string; artist: string; rank: number };
    expect(typeof item.artist).toBe('string');
    expect(item.rank).toBe(1);
  });
});

describe('getTrendingMusic — tags', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns trending tags with count and url', async () => {
    const mockBody = {
      tags: {
        tag: [
          { name: 'rock', count: '5000000', url: 'https://last.fm/tag/rock' },
          { name: 'pop', count: '4500000', url: 'https://last.fm/tag/pop' },
        ],
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTrendingMusic(makeConfig(), { type: 'tags', limit: 10 });

    expect(result.count).toBe(2);
    const item = result.items[0] as { name: string; count: number; url: string; rank: number };
    expect(typeof item.name).toBe('string');
    expect(Number.isFinite(item.count)).toBe(true);
    expect(typeof item.url).toBe('string');
    expect(item.rank).toBe(1);
  });

  it('uses page offset for rank calculation', async () => {
    const mockBody = {
      tags: {
        tag: [
          { name: 'jazz', count: '1000000', url: 'https://last.fm/tag/jazz' },
        ],
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    // page=2, limit=10 -> rank starts at 11
    const result = await getTrendingMusic(makeConfig(), { type: 'tags', limit: 10, page: 2 });

    const item = result.items[0] as { rank: number };
    expect(item.rank).toBe(11);
  });
});

// ---- getSimilarArtists and getSimilarTracks are covered in lastfm-lyrics-bugs.test.ts
// but add one missing-key guard for completeness

describe('getSimilarArtists and getSimilarTracks — missing API key guard', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('getSimilarArtists throws when LASTFM_API_KEY is missing', async () => {
    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getSimilarArtists(makeConfig({ lastFmApiKey: '' }), { artist: 'Test' })).rejects.toThrow(/LASTFM_API_KEY/);
  });

  it('getSimilarTracks throws when LASTFM_API_KEY is missing', async () => {
    const { getSimilarTracks } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getSimilarTracks(makeConfig({ lastFmApiKey: '' }), { artist: 'Test', track: 'Song' })).rejects.toThrow(/LASTFM_API_KEY/);
  });
});
