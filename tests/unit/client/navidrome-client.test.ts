/**
 * Navidrome MCP Server - NavidromeClient unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { NavidromeClient, NavidromeNotFoundError } from '../../../src/client/navidrome-client.js';
import { FetchTimeoutError } from '../../../src/utils/fetch-with-timeout.js';
import type { Config } from '../../../src/config.js';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

/** Mirrors native fetch against a server that accepts the connection but never replies. */
function hangingFetchImpl(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === undefined || signal === null) return;
    if (signal.aborted) {
      reject(new Error('aborted')); return;
    }
    signal.addEventListener('abort', () => {
      const reasonName = signal.reason instanceof Error ? signal.reason.name : 'AbortError';
      const err = new Error('aborted');
      err.name = reasonName === 'TimeoutError' ? 'TimeoutError' : 'AbortError';
      reject(err);
    }, { once: true });
  });
}

function makeConfig(): Config {
  return {
    navidromeUrl: 'http://test:4533',
    navidromeUsername: 'tester',
    navidromePassword: 'pw',
    tokenExpiry: 86400,
    debug: false,
  } as unknown as Config;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const tokenResponse = (token: string): Response => jsonResponse({ token });

describe('NavidromeClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request() retry-on-401', () => {
    it('401 then 200 returns the parsed body and uses the new token on retry', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))
        .mockResolvedValueOnce(tokenResponse('second'))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<{ ok: boolean }>('/album/123');

      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(4);

      const apiCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/api/album/123'),
      );
      expect(apiCalls).toHaveLength(2);
      // doFetch hands fetch a Headers instance, not a plain record.
      const firstHeaders = new Headers((apiCalls[0]![1] as RequestInit).headers);
      const retryHeaders = new Headers((apiCalls[1]![1] as RequestInit).headers);
      expect(firstHeaders.get('X-ND-Authorization')).toBe('Bearer first');
      expect(retryHeaders.get('X-ND-Authorization')).toBe('Bearer second');
    });

    it('401 twice throws the standard HTTP error (one retry max)', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))
        .mockResolvedValueOnce(tokenResponse('second'))
        .mockResolvedValueOnce(jsonResponse({ ok: false }, 401));

      const client = new NavidromeClient(makeConfig());
      await expect(client.request('/album/123')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('maps a 500 with the data-not-found body on a read to a wrong-ID error', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ error: 'data not found' }, 500));

      const client = new NavidromeClient(makeConfig());
      const failure = client.request('/song/missing?library_id=1');

      await expect(failure).rejects.toBeInstanceOf(NavidromeNotFoundError);
      await expect(failure).rejects.toThrow(/^Song not found: missing$/);
    });

    it('maps a 404 on a read to a wrong-ID error', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      const client = new NavidromeClient(makeConfig());

      await expect(client.request('/album/missing')).rejects.toBeInstanceOf(NavidromeNotFoundError);
    });

    it('names the playlist for a 404 on a write', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ error: 'playlist not found' }, 404));

      const client = new NavidromeClient(makeConfig());

      await expect(client.request('/playlist/missing', { method: 'PUT', body: '{}' })).rejects.toThrow(/^Playlist not found: missing$/);
    });

    it('names the playlist for a plain-text data-not-found 400 on a track write', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(new Response('data not found\n', { status: 400 }));

      const client = new NavidromeClient(makeConfig());

      await expect(client.request('/playlist/missing/tracks', { method: 'POST', body: '{}' })).rejects.toThrow(/^Playlist not found: missing$/);
    });

    it('keeps the request label when the endpoint names no item', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      const client = new NavidromeClient(makeConfig());

      await expect(client.request('/queue')).rejects.toThrow('Navidrome GET /queue found no item. The ID is probably wrong.');
    });

    it('keeps the HTTP error for a 404 on a write to a path that names no item', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

      const client = new NavidromeClient(makeConfig());
      const failure = client.request('/playlist', { method: 'POST', body: '{}' });

      await expect(failure).rejects.not.toBeInstanceOf(NavidromeNotFoundError);
      await expect(failure).rejects.toThrow(/Navidrome POST \/playlist - 404/);
    });

    it('keeps the HTTP error for a 400 that is not a missing item', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(new Response('invalid request', { status: 400 }));

      const client = new NavidromeClient(makeConfig());

      await expect(client.request('/playlist/abc/tracks', { method: 'POST', body: '{}' })).rejects.toThrow(/Navidrome POST \/playlist\/abc\/tracks - 400/);
    });

    it('non-401 errors do not trigger retry', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500));

      const client = new NavidromeClient(makeConfig());
      await expect(client.request('/album/123')).rejects.toThrow(/Navidrome GET \/album\/123 - 500/);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('doFetch header merge', () => {
    // Spreading a Headers instance yields `{}`, so the merge must accept each HeadersInit form.
    it('preserves a caller-supplied header alongside the default auth header', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('tok'))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = new NavidromeClient(makeConfig());
      await client.request('/album/123', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });

      const apiCall = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/api/album/123'),
      );
      expect(apiCall).toBeDefined();
      const sent = new Headers((apiCall![1] as RequestInit).headers);
      expect(sent.get('X-Custom-Header')).toBe('custom-value');
      expect(sent.get('X-ND-Authorization')).toBe('Bearer tok');
    });

    it('preserves a caller-supplied Headers instance', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('tok'))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = new NavidromeClient(makeConfig());
      await client.request('/album/123', {
        headers: new Headers({ 'X-Custom-Header': 'from-headers-instance' }),
      });

      const apiCall = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/api/album/123'),
      );
      const sent = new Headers((apiCall![1] as RequestInit).headers);
      expect(sent.get('X-Custom-Header')).toBe('from-headers-instance');
      expect(sent.get('X-ND-Authorization')).toBe('Bearer tok');
    });
  });

  describe('parseResponse content-type sniffing', () => {
    // Navidrome's POST /playlist/{id}/tracks and GET /song/{id}/playlists send JSON as text/plain.
    // Without the sniff, addTracksToPlaylist reads `added` as undefined and reports 0 added.
    it('parses JSON body even when Content-Type is text/plain', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response('{"added":3}', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<{ added: number }>('/playlist/abc/tracks', { method: 'POST' });
      expect(result.added).toBe(3);
    });

    it('parses array JSON body even when Content-Type is text/plain (getPlaylistTracks shape)', async () => {
      // An unparsed array reaches getPlaylistTracks as a string, which transforms to no tracks.
      const trackArray = [
        { id: 1, mediaFileId: 'abc', playlistId: 'pl1', title: 'Song A', duration: 180 },
        { id: 2, mediaFileId: 'def', playlistId: 'pl1', title: 'Song B', duration: 200 },
      ];
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response(JSON.stringify(trackArray), {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<unknown[]>('/playlist/pl1/tracks?_start=0&_end=2');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect((result[0] as { title: string }).title).toBe('Song A');
    });

    it('returns text verbatim when body is not JSON-shaped', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:120,Track\nfile.mp3', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<string>('/playlist/abc/tracks?_format=m3u');
      expect(result).toContain('#EXTM3U');
    });

    it('returns text verbatim when body looks JSON-ish but does not parse', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response('{this is not really json', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<string>('/weird');
      expect(result).toBe('{this is not really json');
    });
  });

  describe('requestWithMeta — X-Total-Count surfacing', () => {
    // Single-resource endpoints omit X-Total-Count, and a null total sends callers to items.length.

    function jsonWithTotal(body: unknown, total: string): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Total-Count': total },
      });
    }

    it('returns parsed body and numeric total when X-Total-Count is present', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(jsonWithTotal([{ id: '1' }, { id: '2' }], '12345'));

      const client = new NavidromeClient(makeConfig());
      const result = await client.requestWithMeta<unknown[]>('/album?_start=0&_end=2');
      expect(result.data).toEqual([{ id: '1' }, { id: '2' }]);
      expect(result.total).toBe(12345);
    });

    it('returns total: null when the header is absent', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.requestWithMeta<{ ok: boolean }>('/single-resource');
      expect(result.data).toEqual({ ok: true });
      expect(result.total).toBeNull();
    });

    it('returns total: null when the header is malformed', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Total-Count': 'not-a-number' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.requestWithMeta<unknown[]>('/album');
      expect(result.total).toBeNull();
    });

    it('total: null when the header is empty string', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Total-Count': '' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.requestWithMeta<unknown[]>('/album');
      expect(result.total).toBeNull();
    });

    it('preserves 401 retry semantics through requestWithMeta', async () => {
      // The total must come from the retried response, not the discarded 401.
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))
        .mockResolvedValueOnce(tokenResponse('second'))
        .mockResolvedValueOnce(jsonWithTotal([{ id: '1' }], '99'));

      const client = new NavidromeClient(makeConfig());
      const result = await client.requestWithMeta<unknown[]>('/album');
      expect(result.data).toEqual([{ id: '1' }]);
      expect(result.total).toBe(99);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('request<T>() delegates to requestWithMeta and discards total', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response('{"added":3}', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Total-Count': '999' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<{ added: number }>('/playlist/abc/tracks', { method: 'POST' });
      expect(result.added).toBe(3);
    });

    it('requestWithLibraryFilterAndMeta appends library_id AND surfaces total', async () => {
      // libraryManager is uninitialized here, so no library_id is appended. Only total is checked.
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(jsonWithTotal([{ id: '1' }], '42'));

      const client = new NavidromeClient(makeConfig());
      const result = await client.requestWithLibraryFilterAndMeta<unknown[]>('/song?_start=0&_end=1');
      expect(result.data).toEqual([{ id: '1' }]);
      expect(result.total).toBe(42);
    });
  });

  describe('assertSafeEndpoint', () => {
    let client: NavidromeClient;

    beforeEach(() => {
      mockFetch.mockResolvedValueOnce(tokenResponse('initial'));
      client = new NavidromeClient(makeConfig());
    });

    it('rejects endpoints with .. segments', async () => {
      await expect(client.request('/album/../user/admin')).rejects.toThrow(/path-traversal/);
    });

    it('rejects URL-encoded traversal (%2e%2e) that would normalize back to ..', async () => {
      await expect(client.request('/album/%2e%2e/user/admin')).rejects.toThrow(/path-traversal/);
    });

    it('rejects endpoints with a malformed percent-encoding sequence', async () => {
      await expect(client.request('/album/%zz')).rejects.toThrow(/malformed percent-encoding/);
    });

    it('rejects absolute URLs', async () => {
      await expect(client.request('http://evil.example/api')).rejects.toThrow(/path, not an absolute URL/);
      await expect(client.request('https://evil.example/api')).rejects.toThrow(/path, not an absolute URL/);
    });

    it('accepts an ellipsis in the query string', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([]));
      await expect(client.request('/album?name=...And+Justice+for+All')).resolves.toEqual([]);
    });

    it('still rejects traversal in the path when a query string follows', async () => {
      await expect(client.request('/album/../user?x=1')).rejects.toThrow(/path-traversal/);
    });

    it('also guards subsonicRequest', async () => {
      await expect(client.subsonicRequest('/../auth/login')).rejects.toThrow(/path-traversal/);
    });

    it('guards requestWithLibraryFilter on the RAW endpoint before URL-normalization hides the ..', async () => {
      await expect(client.requestWithLibraryFilter('/album/../user/admin')).rejects.toThrow(/path-traversal/);
    });
  });

  describe('subsonicRequest response-shape guard', () => {
    it('throws Subsonic-context error (not a native TypeError) on a literal null JSON body', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(null));

      const client = new NavidromeClient(makeConfig());
      await expect(client.subsonicRequest('/getStarred')).rejects.toThrow(/Subsonic API error: unexpected Subsonic response shape/);
    });
  });

  describe('401 retry drains the discarded first body', () => {
    it('cancels the first (401) response body before the retry fetch', async () => {
      // An unconsumed body holds undici's socket out of the keep-alive pool until GC.
      const first401 = new Response('unauthorized', { status: 401 });
      const cancelSpy = vi.spyOn(first401.body!, 'cancel');

      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(first401)
        .mockResolvedValueOnce(tokenResponse('second'))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<{ ok: boolean }>('/album/123');

      expect(result).toEqual({ ok: true });
      expect(cancelSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('request() timeout + retry', () => {
    beforeEach(() => {
      delete process.env['NAVIDROME_REQUEST_TIMEOUT_MS'];
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('GET request times out and retries once, then succeeds', async () => {
      vi.useFakeTimers();
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '1000';

      mockFetch.mockResolvedValueOnce(tokenResponse('t'));
      mockFetch.mockImplementationOnce(hangingFetchImpl);
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = new NavidromeClient(makeConfig());
      const promise = client.request<{ ok: boolean }>('/album/123');

      await vi.advanceTimersByTimeAsync(1001);

      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('GET request times out twice → throws FetchTimeoutError after second attempt', async () => {
      vi.useFakeTimers();
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '1000';

      mockFetch.mockResolvedValueOnce(tokenResponse('t'));
      mockFetch.mockImplementationOnce(hangingFetchImpl);
      mockFetch.mockImplementationOnce(hangingFetchImpl);

      const client = new NavidromeClient(makeConfig());
      const promise = client.request('/album/123');
      const settled = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1001);
      await vi.advanceTimersByTimeAsync(1001);

      const result = await settled;
      expect(result).toBeInstanceOf(FetchTimeoutError);
      // A read has no side effect, so its timeout carries no write note.
      expect((result as Error).message).not.toContain('may already have been applied');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('POST mutation times out → does NOT retry (avoids double-apply)', async () => {
      vi.useFakeTimers();
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '1000';

      mockFetch.mockResolvedValueOnce(tokenResponse('t'));
      mockFetch.mockImplementationOnce(hangingFetchImpl);

      const client = new NavidromeClient(makeConfig());
      const promise = client.request('/playlist', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Playlist' }),
      });
      const settled = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1001);

      const result = await settled;
      expect(result).toBeInstanceOf(FetchTimeoutError);
      expect((result as FetchTimeoutError).attempts).toBe(1);
      expect((result as Error).message).toContain(
        'The change may already have been applied. Check the current state before retrying.',
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCurrentToken — public token accessor', () => {
    it('returns the current cached JWT', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse('jwt.payload.sig'));
      const client = new NavidromeClient(makeConfig());

      const token = await client.getCurrentToken();
      expect(token).toBe('jwt.payload.sig');
      const second = await client.getCurrentToken();
      expect(second).toBe('jwt.payload.sig');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('triggers /auth/login on first call (lazy auth)', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse('lazy-auth-token'));
      const client = new NavidromeClient(makeConfig());

      const token = await client.getCurrentToken();
      expect(token).toBe('lazy-auth-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(typeof url === 'string' && url.endsWith('/auth/login')).toBe(true);
    });
  });

  describe('subsonicRequest', () => {
    it('defaults to POST with auth in form-encoded body (no auth params in URL)', async () => {
      // subsonicRequest signs with salted MD5, not the JWT, so no /auth/login response is queued.
      mockFetch.mockResolvedValueOnce(jsonResponse({ 'subsonic-response': { status: 'ok' } }));

      const client = new NavidromeClient(makeConfig());
      await client.subsonicRequest('/getStarred');

      const call = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/rest/getStarred'),
      );
      expect(call).toBeDefined();
      const [url, init] = call!;
      expect(url).toBe('http://test:4533/rest/getStarred');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = init?.body as string;
      expect(body).toContain('u=tester');
      expect(body).toContain('t=');
      expect(body).toContain('s=');
      expect(body).not.toContain('p=pw');
    });
  });
});
