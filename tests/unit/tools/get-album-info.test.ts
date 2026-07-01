/**
 * Navidrome MCP Server - get_album_info orchestration tests
 * Copyright (C) 2025
 *
 * Covers the single-album deep dive per docs/ARTIST-ALBUMS-SPEC.md §9:
 * MB-primary tracklist (Official-release pick, ms→s durations), Last.fm
 * wiki/tags/popularity, the live-verified Last.fm parsing quirks (single-track
 * object, tags:"", absent keys), genre fallback, library matching, per-source
 * degradation, and verbose fields. External APIs are mocked via a host-routed
 * global.fetch; Navidrome via createMockClient().
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { resetMusicBrainzThrottleForTests } from '../../../src/utils/musicbrainz.js';
import {
  getAlbumInfo,
  clearAlbumInfoCachesForTests,
} from '../../../src/tools/lastfm-discovery.js';

// ---- fetch routing ----------------------------------------------------------

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

interface FetchRoutes {
  mbRgLookup?: (url: URL) => unknown;
  mbRgSearch?: (url: URL) => unknown;
  mbReleaseBrowse?: (url: URL) => unknown;
  lastFm?: (url: URL) => unknown;
}

/** Route global.fetch by host/path; throwing handlers simulate a source being down. */
function installFetch(routes: FetchRoutes): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown) => {
    const url = new URL(String(input));
    try {
      if (url.host === 'musicbrainz.org') {
        if (url.pathname.startsWith('/ws/2/release-group/')) {
          if (routes.mbRgLookup === undefined) throw new Error('unexpected MB RG lookup');
          return Promise.resolve(jsonResponse(routes.mbRgLookup(url)));
        }
        if (url.pathname === '/ws/2/release-group') {
          if (routes.mbRgSearch === undefined) throw new Error('unexpected MB RG search');
          return Promise.resolve(jsonResponse(routes.mbRgSearch(url)));
        }
        if (url.pathname === '/ws/2/release') {
          if (routes.mbReleaseBrowse === undefined) throw new Error('unexpected MB release browse');
          return Promise.resolve(jsonResponse(routes.mbReleaseBrowse(url)));
        }
        throw new Error(`unexpected MB path ${url.pathname}`);
      }
      if (url.host === 'ws.audioscrobbler.com') {
        if (routes.lastFm === undefined) throw new Error('unexpected Last.fm call');
        return Promise.resolve(jsonResponse(routes.lastFm(url)));
      }
      throw new Error(`unexpected host ${url.host}`);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

// ---- fixtures (mirror live shapes verified 2026-06-12) ------------------------

const RG_UNICORN = {
  id: 'rg-unicorn',
  title: 'UNICORN',
  'first-release-date': '2023-09-29',
  'primary-type': 'Album',
  'secondary-types': [],
  genres: [{ name: 'synthwave', count: 3 }, { name: 'pop', count: 1 }],
  'artist-credit': [{ name: 'GUNSHIP', artist: { id: 'mb-gunship', name: 'GUNSHIP' } }],
};

// Search hits carry score but no genres (live-verified).
const RG_SEARCH_UNICORN = {
  'release-groups': [{
    id: 'rg-unicorn',
    title: 'UNICORN',
    score: 100,
    'first-release-date': '2023-09-29',
    'primary-type': 'Album',
    'artist-credit': [{ name: 'GUNSHIP', artist: { id: 'mb-gunship', name: 'GUNSHIP' } }],
  }],
};

// Bootleg predates the Official release: the pick must prefer Official.
const RELEASES_UNICORN = {
  'release-count': 2,
  releases: [
    {
      id: 'rel-bootleg', status: 'Bootleg', date: '2022-01-01', country: 'XW',
      media: [{ position: 1, tracks: [{ position: 1, title: 'Leak', length: 100000 }] }],
    },
    {
      id: 'rel-official', status: 'Official', date: '2023-09-29', country: 'XW',
      media: [{
        position: 1,
        tracks: [
          { position: 1, title: 'Monster in Paradise', length: 330000 },
          { position: 2, title: 'Empress of the Damned', length: 206000 },
          { position: 3, title: 'Tech Noir II', length: null },
        ],
      }],
    },
  ],
};

const LASTFM_UNICORN = {
  album: {
    name: 'Unicorn',
    artist: 'Gunship',
    mbid: 'some-release-mbid',
    url: 'https://www.last.fm/music/Gunship/Unicorn',
    listeners: '61766',
    playcount: '1462447',
    // Mixes real genres with user shelf-keeping junk (observed live).
    tags: {
      tag: [
        { name: 'Synthwave', url: '' },
        { name: ':3star', url: '' },
        { name: '2015', url: '' },
        { name: 'albums I own', url: '' },
        { name: 'electronic', url: '' },
      ],
    },
    wiki: {
      published: '01 Oct 2023, 00:00',
      summary: 'Unicorn is the third studio album by GUNSHIP. <a href="https://www.last.fm/music/Gunship/Unicorn">Read more on Last.fm</a>.',
      content: 'Unicorn is the third studio album by GUNSHIP. Long-form content. <a href="https://www.last.fm/music/Gunship/Unicorn">Read more on Last.fm</a>.',
    },
    tracks: {
      track: [
        { name: 'Monster in Paradise (feat. Milkie Way)', duration: null, url: '', '@attr': { rank: 1 }, artist: { name: 'Gunship' } },
        { name: 'Empress of the Damned', duration: 206, url: '', '@attr': { rank: 2 }, artist: { name: 'Gunship' } },
      ],
    },
  },
};

function unicornRoutes(): FetchRoutes {
  return {
    mbRgLookup: () => RG_UNICORN,
    mbRgSearch: () => RG_SEARCH_UNICORN,
    mbReleaseBrowse: () => RELEASES_UNICORN,
    lastFm: () => LASTFM_UNICORN,
  };
}

/** Navidrome mock: GUNSHIP resolved, owning exactly "Unicorn". */
function wireNavidromeOwningUnicorn(client: MockNavidromeClient): void {
  client.requestWithLibraryFilterAndMeta.mockImplementation((endpoint: string) => {
    if (endpoint.startsWith('/artist?')) {
      return Promise.resolve({ data: [{ id: 'nav-gunship', name: 'GUNSHIP' }], total: 1 });
    }
    if (endpoint.startsWith('/album?artist_id=nav-gunship')) {
      return Promise.resolve({ data: [{ id: 'nav-album-unicorn', name: 'Unicorn' }], total: 1 });
    }
    return Promise.reject(new Error(`unexpected Navidrome endpoint: ${endpoint}`));
  });
}

function wireEmptyNavidrome(client: MockNavidromeClient): void {
  client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });
}

function asClient(mock: MockNavidromeClient): NavidromeClient {
  return mock as unknown as NavidromeClient;
}

// ---- tests --------------------------------------------------------------------

let client: MockNavidromeClient;

beforeEach(() => {
  vi.restoreAllMocks();
  resetMusicBrainzThrottleForTests();
  clearAlbumInfoCachesForTests();
  client = createMockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAlbumInfo — happy path (Unicorn fixture)', () => {
  it('throws when LASTFM_API_KEY is missing', async () => {
    const config = makeTestConfig();
    await expect(getAlbumInfo(asClient(client), config, { artist: 'GUNSHIP', album: 'Unicorn' }))
      .rejects.toThrow(/LASTFM_API_KEY/);
  });

  it('mbid path: MB tracklist from the Official release, Last.fm wiki/popularity, library match', async () => {
    installFetch(unicornRoutes());
    wireNavidromeOwningUnicorn(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { mbid: '56a2d3b3-cb32-4ba0-bf6b-e94ca1d45307' });

    expect(result.album).toEqual({
      title: 'UNICORN',
      artist: 'GUNSHIP',
      mbid: 'rg-unicorn',
      year: 2023,
      primaryType: 'Album',
      secondaryTypes: [],
      inLibrary: true,
      libraryAlbumId: 'nav-album-unicorn',
    });
    expect(result.sources).toEqual({ musicbrainz: true, lastfm: true });

    // MB is the tracklist source: Official release wins over the earlier
    // bootleg, lengths are ms→whole seconds, null length stays null.
    expect(result.tracksSource).toBe('musicbrainz');
    expect(result.trackCount).toBe(3);
    expect(result.tracks).toEqual([
      { position: 1, title: 'Monster in Paradise', durationSeconds: 330 },
      { position: 2, title: 'Empress of the Damned', durationSeconds: 206 },
      { position: 3, title: 'Tech Noir II', durationSeconds: null },
    ]);

    // MB genres (count-desc), Last.fm popularity as numbers, stripped wiki.
    expect(result.genres).toEqual(['synthwave', 'pop']);
    expect(result.listeners).toBe(61766);
    expect(result.playcount).toBe(1462447);
    expect(result.summary).toBe('Unicorn is the third studio album by GUNSHIP.');
    expect(result.summary).not.toMatch(/<|Read more/);
    expect(result.note).toBeUndefined();

    // Compact mode: no verbose-only fields.
    expect(result).not.toHaveProperty('wikiFull');
    expect(result).not.toHaveProperty('tags');
    expect(result).not.toHaveProperty('tracklistRelease');
  });

  it('names path resolves via MB release-group search', async () => {
    const fetchMock = installFetch(unicornRoutes());
    wireNavidromeOwningUnicorn(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { artist: 'GUNSHIP', album: 'Unicorn' });

    expect(result.album.mbid).toBe('rg-unicorn');
    expect(result.album.year).toBe(2023);
    expect(result.tracksSource).toBe('musicbrainz');
    // Search hits carry no genres ⇒ fallback to genre-like Last.fm tags,
    // lowercased, with shelf-keeping junk (":3star", "2015", "albums I own") dropped.
    expect(result.genres).toEqual(['synthwave', 'electronic']);

    // 2 MB (search + release browse) + 1 Last.fm — constant budget.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const searchCall = fetchMock.mock.calls.find(c => String(c[0]).includes('query='));
    expect(String(searchCall?.[0])).toContain('releasegroup');
  });

  it('verbose adds wikiFull/lastFmUrl/tags/tracklistRelease without extra requests', async () => {
    const fetchMock = installFetch(unicornRoutes());
    wireNavidromeOwningUnicorn(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { mbid: '56a2d3b3-cb32-4ba0-bf6b-e94ca1d45307', verbose: true });

    expect(result.wikiFull).toContain('Long-form content');
    expect(result.wikiFull).not.toMatch(/<|Read more/);
    expect(result.lastFmUrl).toBe('https://www.last.fm/music/Gunship/Unicorn');
    // verbose tags are the RAW Last.fm list — junk filtering applies only to genres.
    expect(result.tags).toEqual(['Synthwave', ':3star', '2015', 'albums I own', 'electronic']);
    expect(result.tracklistRelease).toEqual({
      mbid: 'rel-official', status: 'Official', date: '2023-09-29', country: 'XW',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('getAlbumInfo — Last.fm parsing quirks (live-verified)', () => {
  it('coerces the single-track object form of tracks.track', async () => {
    installFetch({
      mbRgSearch: () => ({ 'release-groups': [] }),
      lastFm: () => ({
        album: {
          name: 'The Mountain', artist: 'Gunship', url: 'https://last.fm/x',
          listeners: '1000', playcount: '5000',
          tags: { tag: [{ name: 'synthwave', url: '' }] },
          // Single track ⇒ Last.fm serves an OBJECT, not a one-element array.
          tracks: { track: { name: 'The Mountain', duration: 264, url: '', '@attr': { rank: 1 }, artist: { name: 'Gunship' } } },
        },
      }),
    });
    wireEmptyNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { artist: 'GUNSHIP', album: 'The Mountain' });

    expect(result.tracksSource).toBe('lastfm');
    expect(result.tracks).toEqual([{ position: 1, title: 'The Mountain', durationSeconds: 264 }]);
    expect(result.note).toMatch(/not found in MusicBrainz/);
  });

  it('survives the degenerate obscure-album shape: tags:"", no tracks key, no wiki, mbid:""', async () => {
    installFetch({
      mbRgSearch: () => ({ 'release-groups': [] }),
      lastFm: () => ({
        album: {
          name: 'Uebermovie Soundtrack', artist: 'Thermostatic', url: 'https://last.fm/x',
          listeners: '42', playcount: '99',
          mbid: '',
          tags: '',
        },
      }),
    });
    wireEmptyNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { artist: 'Thermostatic', album: 'Uebermovie Soundtrack' });

    expect(result.tracks).toEqual([]);
    expect(result.trackCount).toBeNull();
    expect(result.tracksSource).toBeNull();
    expect(result.genres).toEqual([]);
    expect(result.summary).toBeNull();
    expect(result.listeners).toBe(42);
    expect(result.album.year).toBeNull();
    expect(result.album.primaryType).toBe('Unknown');
    expect(result.note).toMatch(/No tracklist is available/);
  });

  it('null Last.fm durations become durationSeconds: null on the fallback path', async () => {
    installFetch({
      mbRgSearch: () => ({ 'release-groups': [] }),
      lastFm: () => LASTFM_UNICORN,
    });
    wireEmptyNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { artist: 'GUNSHIP', album: 'Unicorn' });

    expect(result.tracksSource).toBe('lastfm');
    expect(result.tracks).toEqual([
      { position: 1, title: 'Monster in Paradise (feat. Milkie Way)', durationSeconds: null },
      { position: 2, title: 'Empress of the Damned', durationSeconds: 206 },
    ]);
  });
});

describe('getAlbumInfo — degradation', () => {
  it('MB down ⇒ Last.fm-only with year null and a note', async () => {
    installFetch({
      mbRgSearch: () => { throw new Error('MB 503'); },
      lastFm: () => LASTFM_UNICORN,
    });
    wireNavidromeOwningUnicorn(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { artist: 'GUNSHIP', album: 'Unicorn' });

    expect(result.sources).toEqual({ musicbrainz: false, lastfm: true });
    expect(result.album.year).toBeNull();
    expect(result.album.primaryType).toBe('Unknown');
    expect(result.tracksSource).toBe('lastfm');
    expect(result.note).toMatch(/MusicBrainz was unreachable/);
    // Library compare still works.
    expect(result.album.inLibrary).toBe(true);
  });

  it('tracklist browse fails but RG resolved ⇒ MB still usable, tracklist falls back, no "unreachable" claim', async () => {
    installFetch({
      ...unicornRoutes(),
      mbReleaseBrowse: () => { throw new Error('MB 503'); },
    });
    wireNavidromeOwningUnicorn(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { mbid: '56a2d3b3-cb32-4ba0-bf6b-e94ca1d45307' });

    // Year/type/genres came from the resolve — the payload must not contradict the note.
    expect(result.sources.musicbrainz).toBe(true);
    expect(result.album.year).toBe(2023);
    expect(result.genres).toEqual(['synthwave', 'pop']);
    expect(result.tracksSource).toBe('lastfm');
    expect(result.note).toMatch(/tracklist could not be fetched/);
    expect(result.note).not.toMatch(/unreachable/);
  });

  it('Last.fm "Album not found" ⇒ MB-only with a distinct note', async () => {
    installFetch({
      ...unicornRoutes(),
      lastFm: () => ({ error: 6, message: 'Album not found' }),
    });
    wireNavidromeOwningUnicorn(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { mbid: '56a2d3b3-cb32-4ba0-bf6b-e94ca1d45307' });

    expect(result.sources).toEqual({ musicbrainz: true, lastfm: false });
    expect(result.listeners).toBeNull();
    expect(result.playcount).toBeNull();
    expect(result.summary).toBeNull();
    expect(result.tracksSource).toBe('musicbrainz');
    expect(result.trackCount).toBe(3);
    expect(result.genres).toEqual(['synthwave', 'pop']);
    expect(result.note).toMatch(/no entry for this album/);
  });

  it('both sources down ⇒ the tool fails', async () => {
    installFetch({
      mbRgSearch: () => { throw new Error('MB down'); },
      lastFm: () => { throw new Error('Last.fm down'); },
    });
    wireEmptyNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    await expect(getAlbumInfo(asClient(client), config, { artist: 'GUNSHIP', album: 'Unicorn' }))
      .rejects.toThrow(/no album info source available/);
  });

  it('mbid-only input with MB down ⇒ hard error (no names to pivot on)', async () => {
    installFetch({
      mbRgLookup: () => { throw new Error('MB down'); },
      lastFm: () => LASTFM_UNICORN,
    });
    wireEmptyNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    await expect(getAlbumInfo(asClient(client), config, { mbid: '56a2d3b3-cb32-4ba0-bf6b-e94ca1d45307' }))
      .rejects.toThrow(/no names were provided/);
  });

  it('Navidrome down ⇒ inLibrary null with a note', async () => {
    installFetch(unicornRoutes());
    client.requestWithLibraryFilterAndMeta.mockRejectedValue(new Error('Navidrome down'));
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getAlbumInfo(asClient(client), config, { mbid: '56a2d3b3-cb32-4ba0-bf6b-e94ca1d45307' });

    expect(result.album.inLibrary).toBeNull();
    expect(result.album.libraryAlbumId).toBeNull();
    expect(result.note).toMatch(/Navidrome was unreachable/);
    // The rest of the payload is unaffected.
    expect(result.trackCount).toBe(3);
  });

  it('input validation: mbid or artist+album required', async () => {
    const config = makeTestConfig({ lastFmApiKey: 'k' });
    await expect(getAlbumInfo(asClient(client), config, { artist: 'GUNSHIP' }))
      .rejects.toThrow(/mbid.*artist|artist.*mbid/i);
  });
});
