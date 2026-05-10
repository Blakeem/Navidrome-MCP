/**
 * Navidrome MCP Server - NavidromeClient unit tests
 * Copyright (C) 2025
 *
 * Covers the B1 retry-on-401 + B2 endpoint-traversal guard. Mocks
 * `global.fetch` so the request path is exercised without a live Navidrome.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

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
        .mockResolvedValueOnce(tokenResponse('first'))            // initial /auth/login
        .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))  // first /api/album fails
        .mockResolvedValueOnce(tokenResponse('second'))           // re-auth after invalidate
        .mockResolvedValueOnce(jsonResponse({ ok: true }));       // retry succeeds

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<{ ok: boolean }>('/album/123');

      expect(result).toEqual({ ok: true });
      // 4 fetches: login, request (401), re-login, request (200)
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Inspect the request fetches: both target /api/album/123 and the
      // second one carries the refreshed token.
      const apiCalls = mockFetch.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/api/album/123'),
      );
      expect(apiCalls).toHaveLength(2);
      const firstHeaders = (apiCalls[0]![1] as RequestInit).headers as Record<string, string>;
      const retryHeaders = (apiCalls[1]![1] as RequestInit).headers as Record<string, string>;
      expect(firstHeaders['X-ND-Authorization']).toBe('Bearer first');
      expect(retryHeaders['X-ND-Authorization']).toBe('Bearer second');
    });

    it('401 twice throws the standard HTTP error (one retry max)', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ ok: false }, 401))
        .mockResolvedValueOnce(tokenResponse('second'))
        .mockResolvedValueOnce(jsonResponse({ ok: false }, 401));

      const client = new NavidromeClient(makeConfig());
      await expect(client.request('/album/123')).rejects.toThrow();
      // login + req + re-login + retry = 4 fetches; no third attempt.
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('non-401 errors do not trigger retry', async () => {
      mockFetch
        .mockResolvedValueOnce(tokenResponse('first'))
        .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500));

      const client = new NavidromeClient(makeConfig());
      await expect(client.request('/album/123')).rejects.toThrow();
      // login + one request only — 500 is not retried.
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('parseResponse content-type sniffing', () => {
    // Navidrome returns JSON bodies with Content-Type: text/plain on several
    // endpoints (POST /playlist/{id}/tracks, GET /song/{id}/playlists, etc.).
    // The client must fall back to JSON-parsing when the body looks like JSON,
    // otherwise callers like addTracksToPlaylist see `response.added` as
    // undefined and silently report 0 added.
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
    // The pagination-correctness fix surfaces Navidrome's `X-Total-Count`
    // header so listing tools can report the real match count instead of
    // the page size. Subsonic and single-resource REST endpoints don't
    // emit this header, so callers fall back to items.length when
    // `total` comes back null.

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
      // 401 → invalidate → retry → 200 + header. We assert the retry
      // path still works AND the second response's header is what gets
      // returned (not the failed first response's).
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
      // Regression: ensure the body-only wrapper still works after the
      // refactor that made it call requestWithMeta internally. JSON-sniff
      // for text/plain bodies must still kick in.
      mockFetch
        .mockResolvedValueOnce(tokenResponse('t'))
        .mockResolvedValueOnce(new Response('{"added":3}', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Total-Count': '999' },
        }));

      const client = new NavidromeClient(makeConfig());
      const result = await client.request<{ added: number }>('/playlist/abc/tracks', { method: 'POST' });
      // Body-only — total is silently discarded.
      expect(result.added).toBe(3);
    });

    it('requestWithLibraryFilterAndMeta appends library_id AND surfaces total', async () => {
      // The library-filter URL mutation should run AND the X-Total-Count
      // should still come through. We can't easily assert the URL contains
      // library_id without initializing the LibraryManager, but the call
      // shape and total propagation are the regression we want to lock in.
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

    it('rejects absolute URLs', async () => {
      await expect(client.request('http://evil.example/api')).rejects.toThrow(/path, not an absolute URL/);
      await expect(client.request('https://evil.example/api')).rejects.toThrow(/path, not an absolute URL/);
    });

    it('also guards subsonicRequest', async () => {
      await expect(client.subsonicRequest('/../auth/login')).rejects.toThrow(/path-traversal/);
    });
  });

  describe('subsonicRequest', () => {
    it('defaults to POST with auth in form-encoded body (no auth params in URL)', async () => {
      // subsonicRequest does NOT use the JWT auth path — it builds its own
      // salted-MD5 auth — so no /auth/login fetch is queued.
      mockFetch.mockResolvedValueOnce(jsonResponse({ 'subsonic-response': { status: 'ok' } }));

      const client = new NavidromeClient(makeConfig());
      await client.subsonicRequest('/getStarred');

      const call = mockFetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/rest/getStarred'),
      );
      expect(call).toBeDefined();
      const [url, init] = call!;
      // URL must be the bare endpoint — no `?u=...&t=...` query string.
      expect(url).toBe('http://test:4533/rest/getStarred');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = init?.body as string;
      // Body carries the salted-MD5 auth — never plaintext password.
      expect(body).toContain('u=tester');
      expect(body).toContain('t=');
      expect(body).toContain('s=');
      expect(body).not.toContain('p=pw');
    });
  });
});
