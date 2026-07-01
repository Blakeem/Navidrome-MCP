/**
 * Navidrome MCP Server - get_artist_albums orchestration tests
 * Copyright (C) 2025
 *
 * Covers the three-source merge (MusicBrainz spine + Last.fm enrichment +
 * Navidrome library compare) per docs/ARTIST-ALBUMS-SPEC.md: type filtering,
 * junk dropping, popularity ranking, onlyMissing, the unverified bucket,
 * per-source degradation, and the multi-artist-id alias union. External APIs
 * are mocked via a host-routed global.fetch; Navidrome via createMockClient()
 * (we assert specific membership outcomes, so live reads don't apply).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { resetMusicBrainzThrottleForTests } from '../../../src/utils/musicbrainz.js';
import {
  getArtistAlbums,
  clearArtistAlbumsCachesForTests,
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
  mbArtistSearch?: (url: URL) => unknown;
  mbBrowse?: (url: URL) => unknown;
  lastFm?: (url: URL) => unknown;
}

/** Route global.fetch by host/path; throwing handlers simulate a source being down. */
function installFetch(routes: FetchRoutes): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown) => {
    const url = new URL(String(input));
    try {
      if (url.host === 'musicbrainz.org') {
        if (url.pathname.startsWith('/ws/2/artist')) {
          if (routes.mbArtistSearch === undefined) throw new Error('unexpected MB artist call');
          return Promise.resolve(jsonResponse(routes.mbArtistSearch(url)));
        }
        if (url.pathname.startsWith('/ws/2/release-group')) {
          if (routes.mbBrowse === undefined) throw new Error('unexpected MB browse call');
          return Promise.resolve(jsonResponse(routes.mbBrowse(url)));
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

// ---- fixtures ----------------------------------------------------------------

function mbArtist(id: string, name: string, score = 100): unknown {
  return { artists: [{ id, name, score, disambiguation: 'synthwave' }] };
}

function mbRg(id: string, title: string, year: string, secondary: string[] = [], genres: Array<{ name: string; count: number }> = []): unknown {
  return {
    id,
    title,
    'first-release-date': year,
    'primary-type': 'Album',
    'secondary-types': secondary,
    genres,
  };
}

function mbBrowseBody(groups: unknown[]): unknown {
  return { 'release-group-count': groups.length, 'release-groups': groups };
}

function lastFmAlbum(name: string, playcount: number, mbid = ''): unknown {
  return { name, playcount: String(playcount), mbid, url: `https://last.fm/music/x/${encodeURIComponent(name)}` };
}

function lastFmBody(albums: unknown[]): unknown {
  return { topalbums: { album: albums, '@attr': { artist: 'X' } } };
}

// The GUNSHIP fixture mirrors the live data shape: 5 MB albums of which two
// are Remix-secondary instrumentals, Last.fm rows with junk + a single, and
// one owned library album. Default filters ⇒ 3 real albums, 1 in library.
const GUNSHIP_BROWSE = mbBrowseBody([
  mbRg('rg-gunship', 'GUNSHIP', '2015-07-24', [], [{ name: 'synthwave', count: 7 }, { name: 'electronic', count: 3 }]),
  mbRg('rg-dad', 'Dark All Day', '2018-10-05'),
  mbRg('rg-unicorn', 'UNICORN', '2023-09-29', [], [{ name: 'pop', count: 1 }]),
  mbRg('rg-instr-1', 'GUNSHIP: Instrumentals', '2015-07-22', ['Remix']),
  mbRg('rg-instr-2', 'Dark All Day: Instrumentals', '2018-10-03', ['Remix']),
]);

const GUNSHIP_LASTFM = lastFmBody([
  lastFmAlbum('Gunship', 3633923),
  lastFmAlbum('Dark All Day', 2478434),
  lastFmAlbum('Unicorn', 1461520, 'release-mbid-not-rg'),
  lastFmAlbum('Tech Noir', 99999), // single — no spine match, unverified bucket
  lastFmAlbum('null', 50),
  lastFmAlbum('uploaded by synthfan99', 10),
]);

function gunshipRoutes(): FetchRoutes {
  return {
    mbArtistSearch: () => mbArtist('mb-gunship', 'GUNSHIP'),
    mbBrowse: () => GUNSHIP_BROWSE,
    lastFm: () => GUNSHIP_LASTFM,
  };
}

/** Navidrome mock: GUNSHIP resolved, owning exactly the self-titled album. */
function wireGunshipNavidrome(client: MockNavidromeClient): void {
  client.requestWithLibraryFilterAndMeta.mockImplementation((endpoint: string) => {
    if (endpoint.startsWith('/artist?')) {
      return Promise.resolve({ data: [{ id: 'nav-gunship', name: 'GUNSHIP' }], total: 1 });
    }
    if (endpoint.startsWith('/album?artist_id=nav-gunship')) {
      return Promise.resolve({ data: [{ id: 'nav-album-gunship', name: 'GUNSHIP' }], total: 1 });
    }
    return Promise.reject(new Error(`unexpected Navidrome endpoint: ${endpoint}`));
  });
}

function asClient(mock: MockNavidromeClient): NavidromeClient {
  return mock as unknown as NavidromeClient;
}

// ---- tests --------------------------------------------------------------------

let client: MockNavidromeClient;

beforeEach(() => {
  vi.restoreAllMocks();
  resetMusicBrainzThrottleForTests();
  clearArtistAlbumsCachesForTests();
  client = createMockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getArtistAlbums — happy path (GUNSHIP fixture)', () => {
  it('throws when LASTFM_API_KEY is missing', async () => {
    const config = makeTestConfig();
    await expect(getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP' }))
      .rejects.toThrow(/LASTFM_API_KEY/);
  });

  it('merges the three sources: counts, ranks, genres, library flags', async () => {
    installFetch(gunshipRoutes());
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP' });

    // Remix-secondary instrumentals are filtered; junk + unmatched singles dropped.
    expect(result.counts).toEqual({ discography: 3, inLibrary: 1, missing: 2, returned: 3 });
    expect(result.sources).toEqual({ musicbrainz: true, lastfm: true });
    expect(result.artist).toEqual({ name: 'GUNSHIP', mbid: 'mb-gunship', navidromeArtistId: 'nav-gunship' });

    const titles = result.albums.map(a => a.title);
    expect(titles).toEqual(['GUNSHIP', 'Dark All Day', 'UNICORN']); // playcount order
    expect(result.albums.map(a => a.popularityRank)).toEqual([1, 2, 3]);

    const self = result.albums[0];
    expect(self?.inLibrary).toBe(true);
    expect(self?.libraryAlbumId).toBe('nav-album-gunship');
    expect(self?.genres).toEqual(['synthwave', 'electronic']); // count-desc off the MB spine
    expect(self?.year).toBe(2015);
    expect(self?.source).toBe('musicbrainz');
    expect(self?.typeUnverified).toBe(false);

    expect(result.albums.filter(a => a.inLibrary === false).map(a => a.title))
      .toEqual(['Dark All Day', 'UNICORN']);

    // Junk and unmatched Last.fm rows never reach the response by default.
    expect(titles).not.toContain('null');
    expect(titles).not.toContain('Tech Noir');

    // Compact mode: no verbose-only fields.
    expect(self).not.toHaveProperty('playcount');
    expect(self).not.toHaveProperty('url');
  });

  it('onlyMissing returns only albums not in the library, with stable ranks', async () => {
    installFetch(gunshipRoutes());
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP', onlyMissing: true });

    expect(result.counts).toEqual({ discography: 3, inLibrary: 1, missing: 2, returned: 2 });
    expect(result.albums.map(a => a.title)).toEqual(['Dark All Day', 'UNICORN']);
    // Ranks are assigned across the full discography BEFORE the membership filter.
    expect(result.albums.map(a => a.popularityRank)).toEqual([2, 3]);
    expect(result.albums.every(a => a.inLibrary === false)).toBe(true);
  });

  it('excludeSecondary: [] keeps remix/instrumental albums', async () => {
    installFetch(gunshipRoutes());
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP', excludeSecondary: [] });

    expect(result.counts.discography).toBe(5);
    expect(result.albums.map(a => a.title)).toContain('GUNSHIP: Instrumentals');
    const instr = result.albums.find(a => a.title === 'GUNSHIP: Instrumentals');
    expect(instr?.secondaryTypes).toEqual(['remix']);
  });

  it('verbose adds playcount/url/disambiguation without any extra requests', async () => {
    const fetchMock = installFetch(gunshipRoutes());
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP', verbose: true });

    const self = result.albums[0];
    expect(self?.playcount).toBe(3633923);
    expect(typeof self?.url).toBe('string');
    // 2 MB (search + browse) + 1 Last.fm — constant request budget.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('calls Last.fm exactly once and never album.getInfo', async () => {
    const fetchMock = installFetch(gunshipRoutes());
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP' });

    const lastFmCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('audioscrobbler'));
    expect(lastFmCalls).toHaveLength(1);
    expect(String(lastFmCalls[0]?.[0])).toContain('artist.getTopAlbums');
  });
});

describe('getArtistAlbums — unverified bucket (Waveshaper fixture)', () => {
  function waveshaperRoutes(): FetchRoutes {
    return {
      mbArtistSearch: () => mbArtist('mb-waveshaper', 'Waveshaper'),
      mbBrowse: () => mbBrowseBody([mbRg('rg-velocity', 'Velocity', '2016-05-20')]),
      lastFm: () => lastFmBody([
        lastFmAlbum('66 MHz', 500000, 'mb-66mhz'),
        lastFmAlbum('Maniac', 400000),
        lastFmAlbum('Velocity', 100000),
      ]),
    };
  }

  function wireEmptyNavidrome(): void {
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });
  }

  it('singles that miss the spine join are dropped by default', async () => {
    installFetch(waveshaperRoutes());
    wireEmptyNavidrome();
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'Waveshaper' });

    expect(result.albums.map(a => a.title)).toEqual(['Velocity']);
    expect(result.albums[0]?.popularityRank).toBe(1); // rank within the returned set
  });

  it('includeUnverified surfaces them flagged, never as verified albums', async () => {
    installFetch(waveshaperRoutes());
    wireEmptyNavidrome();
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'Waveshaper', includeUnverified: true });

    expect(result.counts.discography).toBe(3);
    const single = result.albums.find(a => a.title === '66 MHz');
    expect(single?.typeUnverified).toBe(true);
    expect(single?.primaryType).toBe('Unknown');
    expect(single?.source).toBe('lastfm-only');
    // Ranks span the whole merged set, by playcount.
    expect(result.albums.map(a => a.title)).toEqual(['66 MHz', 'Maniac', 'Velocity']);
    expect(result.albums.map(a => a.popularityRank)).toEqual([1, 2, 3]);
  });
});

describe('getArtistAlbums — MB genres empty', () => {
  it('passes genres: [] through without any fallback Last.fm call', async () => {
    const fetchMock = installFetch({
      mbArtistSearch: () => mbArtist('mb-x', 'Thermostatic'),
      mbBrowse: () => mbBrowseBody([mbRg('rg-joy', 'Joy Toy', '2006-01-01')]),
      lastFm: () => lastFmBody([lastFmAlbum('Joy Toy', 1234)]),
    });
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'Thermostatic' });

    expect(result.albums[0]?.genres).toEqual([]);
    const lastFmCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('audioscrobbler'));
    expect(lastFmCalls).toHaveLength(1);
  });
});

describe('getArtistAlbums — degradation', () => {
  it('MB down ⇒ Last.fm rows become the spine, all typeUnverified, with a note', async () => {
    installFetch({
      // Both MB endpoints reject.
      mbArtistSearch: () => { throw new Error('MB 503'); },
      mbBrowse: () => { throw new Error('MB 503'); },
      lastFm: () => GUNSHIP_LASTFM,
    });
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP' });

    expect(result.sources.musicbrainz).toBe(false);
    expect(result.sources.lastfm).toBe(true);
    expect(result.albums.length).toBeGreaterThan(0);
    expect(result.albums.every(a => a.typeUnverified)).toBe(true);
    expect(result.albums.every(a => a.source === 'lastfm-only')).toBe(true);
    expect(result.note).toMatch(/MusicBrainz was unreachable/);
    // Junk still never gets through, even on the degraded path.
    expect(result.albums.map(a => a.title)).not.toContain('null');
    // Library compare still works (the in-library self-titled album matches).
    expect(result.albums.find(a => a.title === 'Gunship')?.inLibrary).toBe(true);
  });

  it('Last.fm down ⇒ MB-only output, ranks null, genres intact, with a note', async () => {
    installFetch({
      mbArtistSearch: () => mbArtist('mb-gunship', 'GUNSHIP'),
      mbBrowse: () => GUNSHIP_BROWSE,
      lastFm: () => { throw new Error('Last.fm down'); },
    });
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP' });

    expect(result.sources).toEqual({ musicbrainz: true, lastfm: false });
    expect(result.counts.discography).toBe(3);
    expect(result.albums.every(a => a.popularityRank === null)).toBe(true);
    expect(result.albums.find(a => a.title === 'GUNSHIP')?.genres).toEqual(['synthwave', 'electronic']);
    expect(result.note).toMatch(/Last\.fm was unreachable/);
  });

  it('Navidrome down ⇒ inLibrary null, counts null, onlyMissing not applied', async () => {
    installFetch(gunshipRoutes());
    client.requestWithLibraryFilterAndMeta.mockRejectedValue(new Error('Navidrome down'));
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP', onlyMissing: true });

    expect(result.albums.every(a => a.inLibrary === null)).toBe(true);
    expect(result.albums.every(a => a.libraryAlbumId === null)).toBe(true);
    expect(result.counts.inLibrary).toBeNull();
    expect(result.counts.missing).toBeNull();
    expect(result.counts.returned).toBe(3); // onlyMissing skipped — membership unknown
    expect(result.note).toMatch(/Navidrome was unreachable/);
    expect(result.note).toMatch(/onlyMissing was not applied/);
  });

  it('both discography sources down ⇒ the tool fails', async () => {
    installFetch({
      mbArtistSearch: () => { throw new Error('MB down'); },
      mbBrowse: () => { throw new Error('MB down'); },
      lastFm: () => { throw new Error('Last.fm down'); },
    });
    wireGunshipNavidrome(client);
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    await expect(getArtistAlbums(asClient(client), config, { artist: 'GUNSHIP' }))
      .rejects.toThrow(/no discography source available/);
  });

  it('input validation: artist or mbid is required', async () => {
    const config = makeTestConfig({ lastFmApiKey: 'k' });
    await expect(getArtistAlbums(asClient(client), config, {}))
      .rejects.toThrow(/artist.*mbid|mbid.*artist/i);
  });
});

describe('getArtistAlbums — Navidrome alias union (Miami Nights fixture)', () => {
  it("unions library albums across 'Miami Nights 1984' and \"Miami Nights '84\"", async () => {
    installFetch({
      mbArtistSearch: () => mbArtist('mb-mn84', 'Miami Nights 1984'),
      mbBrowse: () => mbBrowseBody([
        mbRg('rg-turbulence', 'Turbulence', '2010-06-01'),
        mbRg('rg-early-summer', 'Early Summer', '2012-06-26'),
        mbRg('rg-sentimental', 'Sentimental', '2020-01-01'),
      ]),
      lastFm: () => lastFmBody([
        lastFmAlbum('Turbulence', 300000),
        lastFmAlbum('Early Summer', 250000),
        lastFmAlbum('Sentimental', 50000),
      ]),
    });

    client.requestWithLibraryFilterAndMeta.mockImplementation((endpoint: string) => {
      // Contains-filter semantics: the full-name query only returns the exact
      // row; the stripped "Miami Nights" variant surfaces both spellings.
      if (endpoint.startsWith(`/artist?name=${encodeURIComponent('Miami Nights 1984')}`)) {
        return Promise.resolve({ data: [{ id: 'nav-mn1984', name: 'Miami Nights 1984' }], total: 1 });
      }
      if (endpoint.startsWith(`/artist?name=${encodeURIComponent('Miami Nights')}`)) {
        return Promise.resolve({
          data: [
            { id: 'nav-mn84', name: "Miami Nights '84" },
            { id: 'nav-mn1984', name: 'Miami Nights 1984' },
          ],
          total: 2,
        });
      }
      if (endpoint.startsWith('/album?artist_id=nav-mn1984')) {
        return Promise.resolve({ data: [{ id: 'nav-album-early-summer', name: 'Early Summer' }], total: 1 });
      }
      if (endpoint.startsWith('/album?artist_id=nav-mn84')) {
        return Promise.resolve({ data: [{ id: 'nav-album-turbulence', name: 'Turbulence' }], total: 1 });
      }
      return Promise.reject(new Error(`unexpected Navidrome endpoint: ${endpoint}`));
    });
    const config = makeTestConfig({ lastFmApiKey: 'k' });

    const result = await getArtistAlbums(asClient(client), config, { artist: 'Miami Nights 1984' });

    // Albums owned under EITHER spelling count as in-library.
    expect(result.counts).toEqual({ discography: 3, inLibrary: 2, missing: 1, returned: 3 });
    expect(result.albums.find(a => a.title === 'Turbulence')?.libraryAlbumId).toBe('nav-album-turbulence');
    expect(result.albums.find(a => a.title === 'Early Summer')?.libraryAlbumId).toBe('nav-album-early-summer');
    expect(result.albums.find(a => a.title === 'Sentimental')?.inLibrary).toBe(false);
  });
});
