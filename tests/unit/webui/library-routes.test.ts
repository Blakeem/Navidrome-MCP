/**
 * Web remote library browse routes, driven directly with a captured
 * ServerResponse and a mocked Navidrome client so no request leaves the process.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';

// searchAll refreshes the filter cache before resolving text filters, which would hit Navidrome.
vi.mock('../../../src/services/filter-cache-manager.js', () => ({
  filterCacheManager: {
    ensureFresh: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/tools/playback.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/playback.js')>();
  return { ...actual, playLibrarySource: vi.fn() };
});

import { EmptyLibrarySourceError, playLibrarySource } from '../../../src/tools/playback.js';
import {
  handleAlbumSongs,
  handleArtistAlbums,
  handleLibraryFavorites,
  handleLibraryPlay,
  handleLibraryRecent,
  handleLibrarySearch,
} from '../../../src/webui/routes/library.js';

interface CapturedRes {
  res: ServerResponse;
  status: () => number | undefined;
  json: () => unknown;
}

function fakeRes(): CapturedRes {
  let status: number | undefined;
  let body = '';
  const res = {
    writableEnded: false,
    writeHead(code: number): ServerResponse {
      status = code;
      return res;
    },
    end(chunk?: string): void {
      if (typeof chunk === 'string') body += chunk;
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    json: () => (body === '' ? undefined : JSON.parse(body)),
  };
}

function fakeReq(rawBody: string): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  queueMicrotask(() => {
    emitter.emit('data', Buffer.from(rawBody));
    emitter.emit('end');
  });
  return emitter;
}

function asClient(mock: MockNavidromeClient): NavidromeClient {
  return mock as unknown as NavidromeClient;
}

function endpointParams(endpoint: string): URLSearchParams {
  return new URL(endpoint, 'http://localhost').searchParams;
}

function ids(items: unknown): string[] {
  return (items as Array<{ id: string }>).map((item) => item.id);
}

let client: MockNavidromeClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = createMockClient();
});

describe('handleLibraryRecent', () => {
  it('reads the three recent windows and drops never-played rows', async () => {
    const played = '2026-10-01T10:00:00Z';
    client.requestWithLibraryFilter.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/artist?')) {
        return Promise.resolve([
          { id: 'ar1', name: 'Played Artist', playDate: played },
          { id: 'ar2', name: 'Never Played Artist' },
        ]);
      }
      if (endpoint.startsWith('/album?')) {
        return Promise.resolve([
          { id: 'al1', name: 'Played Album', playDate: played },
          { id: 'al2', name: 'Blank Date Album', playDate: '' },
        ]);
      }
      if (endpoint.startsWith('/song?')) {
        return Promise.resolve([
          { id: 'so1', title: 'Played Song', playDate: played },
          { id: 'so2', title: 'Never Played Song' },
        ]);
      }
      return Promise.reject(new Error(`unexpected endpoint: ${endpoint}`));
    });

    const cap = fakeRes();
    await handleLibraryRecent(cap.res, asClient(client));

    const endpoints = client.requestWithLibraryFilter.mock.calls.map((call) => call[0]);
    expect(endpoints).toHaveLength(3);
    for (const prefix of ['/artist?', '/album?', '/song?']) {
      const endpoint = endpoints.find((e) => e.startsWith(prefix));
      expect(endpoint).toBeDefined();
      const params = endpointParams(endpoint ?? '');
      expect(params.get('_sort')).toBe('playDate');
      expect(params.get('_order')).toBe('DESC');
      expect(params.get('_start')).toBe('0');
      expect(params.get('_end')).toBe('5');
    }
    const artistEndpoint = endpoints.find((e) => e.startsWith('/artist?')) ?? '';
    expect(endpointParams(artistEndpoint).get('role')).toBe('maincredit');

    expect(cap.status()).toBe(200);
    const body = cap.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['albums', 'artists', 'songs']);
    expect(ids(body['artists'])).toEqual(['ar1']);
    expect(ids(body['albums'])).toEqual(['al1']);
    expect(ids(body['songs'])).toEqual(['so1']);
  });
});

describe('handleLibrarySearch', () => {
  it.each([
    ['missing', null],
    ['empty', ''],
    ['whitespace-only', '   '],
    ['501-character', 'a'.repeat(501)],
  ])('rejects a %s query with 400 and no client call', async (_label, rawQuery) => {
    const cap = fakeRes();
    await handleLibrarySearch(cap.res, asClient(client), makeTestConfig(), rawQuery);

    expect(cap.status()).toBe(400);
    expect(cap.json()).toEqual({ error: 'Invalid query' });
    expect(client.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });

  it('searches all three types by play count and responds with only the three arrays', async () => {
    client.requestWithLibraryFilterAndMeta.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/artist?')) return Promise.resolve({ data: [{ id: 'ar1', name: 'Artist' }], total: 1 });
      if (endpoint.startsWith('/album?')) return Promise.resolve({ data: [{ id: 'al1', name: 'Album' }], total: 1 });
      if (endpoint.startsWith('/song?')) return Promise.resolve({ data: [{ id: 'so1', title: 'Song' }], total: 1 });
      return Promise.reject(new Error(`unexpected endpoint: ${endpoint}`));
    });

    const cap = fakeRes();
    await handleLibrarySearch(cap.res, asClient(client), makeTestConfig(), '  daft  ');

    const endpoints = client.requestWithLibraryFilterAndMeta.mock.calls.map((call) => call[0]);
    expect(endpoints).toHaveLength(3);
    for (const [prefix, searchField] of [['/artist?', 'name'], ['/album?', 'name'], ['/song?', 'title']] as const) {
      const endpoint = endpoints.find((e) => e.startsWith(prefix));
      expect(endpoint).toBeDefined();
      const params = endpointParams(endpoint ?? '');
      expect(params.get(searchField)).toBe('daft');
      expect(params.get('_sort')).toBe('playCount');
      expect(params.get('_order')).toBe('DESC');
      expect(params.get('_end')).toBe('10');
    }

    expect(cap.status()).toBe(200);
    const body = cap.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['albums', 'artists', 'songs']);
    expect(ids(body['artists'])).toEqual(['ar1']);
    expect(ids(body['albums'])).toEqual(['al1']);
    expect(ids(body['songs'])).toEqual(['so1']);
  });
});

describe('handleLibraryFavorites', () => {
  it('reads one starred row from each endpoint and responds with both X-Total-Count values', async () => {
    client.requestWithLibraryFilterAndMeta.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/album?')) return Promise.resolve({ data: [{ id: 'al1' }], total: 8 });
      if (endpoint.startsWith('/song?')) return Promise.resolve({ data: [{ id: 'so1' }], total: 238 });
      return Promise.reject(new Error(`unexpected endpoint: ${endpoint}`));
    });

    const cap = fakeRes();
    await handleLibraryFavorites(cap.res, asClient(client));

    const endpoints = client.requestWithLibraryFilterAndMeta.mock.calls.map((call) => call[0]);
    expect(endpoints).toHaveLength(2);
    for (const prefix of ['/album?', '/song?']) {
      const endpoint = endpoints.find((e) => e.startsWith(prefix));
      expect(endpoint).toBeDefined();
      const params = endpointParams(endpoint ?? '');
      expect(params.get('starred')).toBe('true');
      expect(params.get('_start')).toBe('0');
      expect(params.get('_end')).toBe('1');
    }
    expect(cap.status()).toBe(200);
    expect(cap.json()).toEqual({ albumCount: 8, songCount: 238 });
  });

  it('counts a missing X-Total-Count header as 0', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: null });

    const cap = fakeRes();
    await handleLibraryFavorites(cap.res, asClient(client));

    expect(cap.status()).toBe(200);
    expect(cap.json()).toEqual({ albumCount: 0, songCount: 0 });
  });
});

describe('handleArtistAlbums', () => {
  it.each([
    ['missing', null],
    ['slash-bearing', 'ar1/../x'],
  ])('rejects a %s id with 400 and no client call', async (_label, rawId) => {
    const cap = fakeRes();
    await handleArtistAlbums(cap.res, asClient(client), rawId);

    expect(cap.status()).toBe(400);
    expect(cap.json()).toEqual({ error: 'Invalid id' });
    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });

  it('lists the artist albums oldest first with their release year', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([
      { id: 'al1', name: 'First Album', maxYear: 1999 },
      { id: 'al2', name: 'Second Album', maxYear: 2004 },
    ]);

    const cap = fakeRes();
    await handleArtistAlbums(cap.res, asClient(client), 'ar-1_x');

    expect(client.requestWithLibraryFilter).toHaveBeenCalledTimes(1);
    expect(client.requestWithLibraryFilter).toHaveBeenCalledWith(
      '/album?artist_id=ar-1_x&_sort=maxYear&_order=ASC&_start=0&_end=500',
    );
    expect(cap.status()).toBe(200);
    const body = cap.json() as { albums: Array<{ id: string; releaseYear?: number }> };
    expect(Object.keys(body)).toEqual(['albums']);
    expect(body.albums.map((album) => [album.id, album.releaseYear])).toEqual([
      ['al1', 1999],
      ['al2', 2004],
    ]);
  });
});

describe('handleAlbumSongs', () => {
  it.each([
    ['missing', null],
    ['slash-bearing', 'al1/x'],
  ])('rejects a %s id with 400 and no client call', async (_label, rawId) => {
    const cap = fakeRes();
    await handleAlbumSongs(cap.res, asClient(client), rawId);

    expect(cap.status()).toBe(400);
    expect(cap.json()).toEqual({ error: 'Invalid id' });
    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });

  it('lists the album tracks in disc and track order', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([
      { id: 'so1', title: 'Track One' },
      { id: 'so2', title: 'Track Two' },
    ]);

    const cap = fakeRes();
    await handleAlbumSongs(cap.res, asClient(client), 'al-1_x');

    expect(client.requestWithLibraryFilter).toHaveBeenCalledTimes(1);
    expect(client.requestWithLibraryFilter).toHaveBeenCalledWith(
      '/song?album_id=al-1_x&_sort=album&_order=ASC&_start=0&_end=500',
    );
    expect(cap.status()).toBe(200);
    const body = cap.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['songs']);
    expect(ids(body['songs'])).toEqual(['so1', 'so2']);
  });

  it('maps an upstream failure to 500', async () => {
    client.requestWithLibraryFilter.mockRejectedValue(new Error('upstream down'));

    const cap = fakeRes();
    await handleAlbumSongs(cap.res, asClient(client), 'al1');

    expect(cap.status()).toBe(500);
    expect(cap.json()).toEqual({ error: 'upstream down' });
  });
});

describe('handleLibraryPlay', () => {
  const playMock = vi.mocked(playLibrarySource);

  it('rejects malformed JSON with 400 and does not play', async () => {
    const cap = fakeRes();
    await handleLibraryPlay(fakeReq('{"type":'), cap.res, asClient(client));

    expect(cap.status()).toBe(400);
    expect(playMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown type', { type: 'genre', id: 'ge1', mode: 'append' }, /type must be one of/],
    ['a slash-bearing id', { type: 'song', id: 'so1/../x', mode: 'append' }, /ID contains invalid characters/],
    ['a missing mode', { type: 'album', id: 'al1' }, /expected one of "replace"\|"append"/],
    ['an album without an id', { type: 'album', mode: 'append' }, /ID is required/],
    ['a playlist without an id', { type: 'playlist', mode: 'replace' }, /ID is required/],
    ['a non-boolean shuffle flag', { type: 'starred-songs', mode: 'append', shuffleSongs: 'yes' }, /boolean/],
  ])('rejects %s with 400 and does not play', async (_label, body, message) => {
    const cap = fakeRes();
    await handleLibraryPlay(fakeReq(JSON.stringify(body)), cap.res, asClient(client));

    expect(cap.status()).toBe(400);
    expect((cap.json() as { error: string }).error).toMatch(message);
    expect(playMock).not.toHaveBeenCalled();
  });

  it.each([
    ['song', { type: 'song', id: 'so1', mode: 'append' }],
    ['album', { type: 'album', id: 'al1', mode: 'replace' }],
    ['artist', { type: 'artist', id: 'ar1', mode: 'append' }],
    ['playlist', { type: 'playlist', id: 'pl1', mode: 'replace' }],
    ['starred-songs', { type: 'starred-songs', mode: 'append' }],
    ['starred-albums', { type: 'starred-albums', mode: 'replace' }],
  ] as const)('dispatches a %s to playLibrarySource with shuffle flags defaulted to false', async (_label, body) => {
    playMock.mockResolvedValue({ success: true, count: 1 });

    const cap = fakeRes();
    await handleLibraryPlay(fakeReq(JSON.stringify(body)), cap.res, asClient(client));

    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock).toHaveBeenCalledWith(asClient(client), { ...body, shuffleSongs: false, shuffleAlbums: false });
    expect(cap.status()).toBe(200);
    expect(cap.json()).toEqual({ success: true, count: 1 });
  });

  it('passes the shuffle flags through', async () => {
    playMock.mockResolvedValue({ success: true, count: 3 });
    const body = { type: 'starred-albums', mode: 'replace', shuffleSongs: true, shuffleAlbums: true };

    const cap = fakeRes();
    await handleLibraryPlay(fakeReq(JSON.stringify(body)), cap.res, asClient(client));

    expect(playMock).toHaveBeenCalledWith(asClient(client), body);
    expect(cap.status()).toBe(200);
  });

  it('drops an id sent with a starred type', async () => {
    playMock.mockResolvedValue({ success: true, count: 1 });

    const cap = fakeRes();
    await handleLibraryPlay(
      fakeReq(JSON.stringify({ type: 'starred-songs', id: 'x1', mode: 'append' })),
      cap.res,
      asClient(client),
    );

    expect(playMock).toHaveBeenCalledWith(asClient(client), {
      type: 'starred-songs',
      mode: 'append',
      shuffleSongs: false,
      shuffleAlbums: false,
    });
  });

  it('maps an empty source to 409 with the empty-source code', async () => {
    playMock.mockRejectedValue(new EmptyLibrarySourceError('No starred songs'));

    const cap = fakeRes();
    await handleLibraryPlay(
      fakeReq(JSON.stringify({ type: 'starred-songs', mode: 'append' })),
      cap.res,
      asClient(client),
    );

    expect(cap.status()).toBe(409);
    expect(cap.json()).toEqual({ error: 'No starred songs', code: 'empty-source' });
  });

  it('maps an impl failure to 500', async () => {
    playMock.mockRejectedValue(new Error("Tool 'play_library_source' failed: Artist has no songs"));

    const cap = fakeRes();
    await handleLibraryPlay(
      fakeReq(JSON.stringify({ type: 'artist', id: 'ar1', mode: 'replace' })),
      cap.res,
      asClient(client),
    );

    expect(cap.status()).toBe(500);
    expect(cap.json()).toEqual({ error: "Tool 'play_library_source' failed: Artist has no songs" });
  });
});
