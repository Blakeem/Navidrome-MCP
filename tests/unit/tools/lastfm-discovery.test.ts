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
import { makeTestConfig } from '../../helpers/test-config.js';

// ---- helpers ----------------------------------------------------------------

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...makeTestConfig(),
    navidromeUrl: 'http://mock:4533',
    navidromeUsername: 'u',
    navidromePassword: 'p',
    debug: false,
    tokenExpiry: 86400,
    features: { lastfm: true, radioBrowser: false, lyrics: false, playback: false },
    lastFmApiKey: 'test-key',
    lyricsProvider: undefined,
    lrclibUserAgent: undefined,
    lrclibBase: 'https://lrclib.net',
    playbackTranscodeFormat: 'mp3',
    playbackTranscodeBitrate: '192',
    filterCacheEnabled: true,
    ...overrides,
  };
}

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function makeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(makeResponse(status, body));
}

function fetchedUrl(fetchMock: typeof fetch, callIndex: number): URL {
  return new URL(vi.mocked(fetchMock).mock.calls[callIndex]?.[0] as string);
}

function tagRows(count: number): { name: string; count: string; url: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `tag-${i + 1}`,
    count: String(1000 - i),
    url: `https://last.fm/tag/tag-${i + 1}`,
  }));
}

// ---- getArtistInfo ----------------------------------------------------------

describe('getArtistInfo', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('throws naming features.lastFmApiKey when the key is missing', async () => {
    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    const config = makeConfig({ lastFmApiKey: '' });
    await expect(getArtistInfo(config, { artist: 'Radiohead' })).rejects.toThrow(/features\.lastFmApiKey/);
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
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the English biography when the requested language has none', async () => {
    const localized = {
      artist: {
        name: 'Carpenter Brut',
        url: 'https://www.last.fm/music/Carpenter+Brut',
        stats: { listeners: '500000', playcount: '30000000' },
        bio: { summary: '<a href="https://www.last.fm/music/Carpenter+Brut">Read more on Last.fm</a>' },
        tags: { tag: [{ name: 'synthwave', url: 'https://last.fm/tag/synthwave' }] },
        similar: { artist: [{ name: 'Perturbator' }] },
      },
    };
    const english = {
      artist: {
        name: 'Carpenter Brut',
        url: 'https://www.last.fm/music/Carpenter+Brut',
        stats: { listeners: '1', playcount: '1' },
        bio: { summary: 'A French synthwave project. <a href="more">Read more on Last.fm</a>' },
        tags: { tag: [] },
        similar: { artist: [] },
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse(200, localized))
      .mockResolvedValueOnce(makeResponse(200, english)) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getArtistInfo(makeConfig(), { artist: 'Carpenter Brut', lang: 'ja' });

    expect(result.biography).toBe('A French synthwave project.');
    expect(result.listeners).toBe(500000);
    expect(result.tags).toEqual([{ name: 'synthwave', url: 'https://last.fm/tag/synthwave' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchedUrl(fetchMock, 0).searchParams.get('lang')).toBe('ja');
    expect(fetchedUrl(fetchMock, 1).searchParams.get('lang')).toBe('en');
  });

  it('throws when Last.fm returns HTTP error', async () => {
    global.fetch = makeFetch(503, null);
    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getArtistInfo(makeConfig(), { artist: 'Test' })).rejects.toThrow();
  });

  it("surfaces Last.fm's own message from a non-2xx JSON error body", async () => {
    global.fetch = makeFetch(403, { error: 10, message: 'Invalid API key - You must be granted a valid key by last.fm' });
    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getArtistInfo(makeConfig(), { artist: 'Test' })).rejects.toThrow(/Last\.fm API error: Invalid API key/);
  });

  it('falls back to the status line when the error body is not Last.fm JSON', async () => {
    global.fetch = makeFetch(503, null);
    const { getArtistInfo } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getArtistInfo(makeConfig(), { artist: 'Test' })).rejects.toThrow(/API request failed: Last\.fm artist\.getInfo - 503 Error/);
  });
});

// ---- getTopTracksByArtist ---------------------------------------------------

describe('getTopTracksByArtist', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('throws naming features.lastFmApiKey when the key is missing', async () => {
    const { getTopTracksByArtist } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getTopTracksByArtist(makeConfig({ lastFmApiKey: '' }), { artist: 'Test' })).rejects.toThrow(/features\.lastFmApiKey/);
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
    expect(first).not.toHaveProperty('url');
    // rank starts at 1
    expect(first.rank).toBe(1);
    expect(result.tracks[1]!.rank).toBe(2);
  });

  it('emits the Last.fm url only when verbose is true', async () => {
    const mockBody = {
      toptracks: {
        track: [{ name: 'Creep', playcount: '5000000', listeners: '2000000', url: 'https://last.fm/track/Creep', mbid: 'abc' }],
      },
    };
    global.fetch = makeFetch(200, mockBody);

    const { getTopTracksByArtist } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTopTracksByArtist(makeConfig(), { artist: 'Radiohead', limit: 5, verbose: true });

    expect(result.tracks[0]!.url).toBe('https://last.fm/track/Creep');
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

  it('throws naming features.lastFmApiKey when the key is missing', async () => {
    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getTrendingMusic(makeConfig({ lastFmApiKey: '' }), { type: 'artists' })).rejects.toThrow(/features\.lastFmApiKey/);
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
    expect(result.hasMore).toBe(false);
    const item = result.items[0] as { rank: number; name: string; playcount: number; listeners: number };
    expect(item.rank).toBe(1);
    expect(typeof item.name).toBe('string');
    expect(Number.isFinite(item.playcount)).toBe(true);
    expect(Number.isFinite(item.listeners)).toBe(true);
    expect(item).not.toHaveProperty('url');
  });

  it('forwards page to Last.fm and reports hasMore on a full page', async () => {
    const mockBody = {
      artists: {
        artist: [
          { name: 'A', playcount: '2', listeners: '2', url: 'https://last.fm/a', mbid: '' },
          { name: 'B', playcount: '1', listeners: '1', url: 'https://last.fm/b', mbid: '' },
        ],
      },
    };
    const fetchMock = makeFetch(200, mockBody);
    global.fetch = fetchMock;

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTrendingMusic(makeConfig(), { type: 'artists', limit: 2, page: 3, verbose: true });

    expect(result.hasMore).toBe(true);
    expect((result.items[0] as { rank: number }).rank).toBe(5);
    expect((result.items[0] as { url?: string }).url).toBe('https://last.fm/a');
    expect(fetchedUrl(fetchMock, 0).searchParams.get('page')).toBe('3');
    expect(fetchedUrl(fetchMock, 0).searchParams.get('limit')).toBe('2');
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
    expect(result.hasMore).toBe(false);
    const item = result.items[0] as { name: string; artist: string; rank: number };
    expect(typeof item.artist).toBe('string');
    expect(item.rank).toBe(1);
  });
});

describe('getTrendingMusic — tags', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns trending tags with count, and url only under verbose', async () => {
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
    const compact = await getTrendingMusic(makeConfig(), { type: 'tags', limit: 10 });
    const verbose = await getTrendingMusic(makeConfig(), { type: 'tags', limit: 10, verbose: true });

    expect(compact.count).toBe(2);
    expect(compact.hasMore).toBe(false);
    const item = compact.items[0] as { name: string; count: number; rank: number };
    expect(typeof item.name).toBe('string');
    expect(Number.isFinite(item.count)).toBe(true);
    expect(item.rank).toBe(1);
    expect(item).not.toHaveProperty('url');
    expect((verbose.items[0] as { url?: string }).url).toBe('https://last.fm/tag/rock');
  });

  // chart.getTopTags ignores `page`, so a page is read from row one and sliced.
  it('slices the page out of a page * limit read and ranks from the page start', async () => {
    const fetchMock = makeFetch(200, { tags: { tag: tagRows(20) } });
    global.fetch = fetchMock;

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTrendingMusic(makeConfig(), { type: 'tags', limit: 10, page: 2 });

    const items = result.items as { rank: number; name: string }[];
    expect(items.map((t) => t.name)).toEqual(tagRows(20).slice(10).map((t) => t.name));
    expect(items[0]!.rank).toBe(11);
    expect(items[9]!.rank).toBe(20);
    expect(result.hasMore).toBe(true);
    const url = fetchedUrl(fetchMock, 0);
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.has('page')).toBe(false);
  });

  it('reports hasMore false on the last page under the 1000-row chart cap', async () => {
    const fetchMock = makeFetch(200, { tags: { tag: tagRows(1000) } });
    global.fetch = fetchMock;

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTrendingMusic(makeConfig(), { type: 'tags', limit: 100, page: 10 });

    expect(result.count).toBe(100);
    expect((result.items[0] as { rank: number }).rank).toBe(901);
    expect(result.hasMore).toBe(false);
    expect(fetchedUrl(fetchMock, 0).searchParams.get('limit')).toBe('1000');
  });

  it('returns an empty page without a fetch when the page starts past the chart cap', async () => {
    const fetchMock = makeFetch(200, { tags: { tag: tagRows(5) } });
    global.fetch = fetchMock;

    const { getTrendingMusic } = await import('../../../src/tools/lastfm-discovery.js');
    const result = await getTrendingMusic(makeConfig(), { type: 'tags', limit: 100, page: 11 });

    expect(result).toEqual({ count: 0, items: [], hasMore: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---- getSimilarArtists and getSimilarTracks are covered in lastfm-lyrics-bugs.test.ts
// but add one missing-key guard for completeness

describe('getSimilarArtists and getSimilarTracks — missing API key guard', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('getSimilarArtists throws naming features.lastFmApiKey when the key is missing', async () => {
    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getSimilarArtists(makeConfig({ lastFmApiKey: '' }), { artist: 'Test' })).rejects.toThrow(/features\.lastFmApiKey/);
  });

  it('getSimilarTracks throws naming features.lastFmApiKey when the key is missing', async () => {
    const { getSimilarTracks } = await import('../../../src/tools/lastfm-discovery.js');
    await expect(getSimilarTracks(makeConfig({ lastFmApiKey: '' }), { artist: 'Test', track: 'Song' })).rejects.toThrow(/features\.lastFmApiKey/);
  });
});

describe('getSimilarArtists and getSimilarTracks — url under verbose', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('getSimilarArtists emits url only when verbose is true', async () => {
    global.fetch = makeFetch(200, {
      similarartists: { artist: [{ name: 'Mogwai', match: '0.8', url: 'https://last.fm/mogwai', mbid: '' }] },
    });

    const { getSimilarArtists } = await import('../../../src/tools/lastfm-discovery.js');
    const compact = await getSimilarArtists(makeConfig(), { artist: 'Explosions in the Sky' });
    const verbose = await getSimilarArtists(makeConfig(), { artist: 'Explosions in the Sky', verbose: true });

    expect(compact.similarArtists[0]).not.toHaveProperty('url');
    expect(verbose.similarArtists[0]!.url).toBe('https://last.fm/mogwai');
  });

  it('getSimilarTracks reads the artist name and emits url only when verbose is true', async () => {
    global.fetch = makeFetch(200, {
      similartracks: {
        track: [{ name: 'Creep', match: '0.9', url: 'https://last.fm/creep', mbid: '', artist: { name: 'Radiohead', mbid: '', url: 'https://last.fm/radiohead' } }],
      },
    });

    const { getSimilarTracks } = await import('../../../src/tools/lastfm-discovery.js');
    const compact = await getSimilarTracks(makeConfig(), { artist: 'Muse', track: 'Unintended' });
    const verbose = await getSimilarTracks(makeConfig(), { artist: 'Muse', track: 'Unintended', verbose: true });

    expect(compact.similarTracks[0]!.artist).toBe('Radiohead');
    expect(compact.similarTracks[0]).not.toHaveProperty('url');
    expect(verbose.similarTracks[0]!.url).toBe('https://last.fm/creep');
  });
});
