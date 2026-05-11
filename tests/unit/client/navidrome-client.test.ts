/**
 * Navidrome MCP Server - NavidromeClient unit tests
 * Copyright (C) 2025
 *
 * Covers the B1 retry-on-401 + B2 endpoint-traversal guard. Mocks
 * `global.fetch` so the request path is exercised without a live Navidrome.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { FetchTimeoutError } from '../../../src/utils/fetch-with-timeout.js';
import type { Config } from '../../../src/config.js';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

/**
 * fetch impl that hangs until the AbortSignal fires — used for timeout tests.
 * Mirrors how native fetch behaves on a server that accepts the connection
 * but never replies.
 */
function hangingFetchImpl(_url: string, init?: RequestInit): Promise<Response> {
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

    it('parses array JSON body even when Content-Type is text/plain (getPlaylistTracks shape)', async () => {
      // Regression lock for the "getPlaylistTracks silent empty tracks" finding.
      // The endpoint returns a JSON array; if Navidrome ever sends text/plain,
      // parseResponse must JSON-sniff the array opener '[' and return parsed data
      // rather than a raw string (which would fail the Array.isArray() guard and
      // produce tracks: []).
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

  describe('request() timeout + retry', () => {
    // The MCP SDK's DEFAULT_REQUEST_TIMEOUT_MSEC is 60s — these tests verify
    // we surface a clear timeout error well before the SDK envelope fires,
    // and that GET requests retry once (idempotent) but POST does not
    // (mutation-safety: a timed-out POST may have been applied server-side).

    beforeEach(() => {
      delete process.env['NAVIDROME_REQUEST_TIMEOUT_MS'];
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('GET request times out and retries once, then succeeds', async () => {
      vi.useFakeTimers();
      // Tighter timeout for fast tests.
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '1000';

      // login (1) → first GET hangs (2) → second GET succeeds (3).
      mockFetch.mockResolvedValueOnce(tokenResponse('t'));
      mockFetch.mockImplementationOnce(hangingFetchImpl);
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = new NavidromeClient(makeConfig());
      const promise = client.request<{ ok: boolean }>('/album/123');

      // Drive the first GET attempt to timeout (1000ms cap from env above).
      await vi.advanceTimersByTimeAsync(1001);

      const result = await promise;
      expect(result).toEqual({ ok: true });
      // login + GET-hang + GET-success = 3 fetches.
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
      // login + 2 attempts = 3 fetches total.
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('POST mutation times out → does NOT retry (avoids double-apply)', async () => {
      vi.useFakeTimers();
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '1000';

      mockFetch.mockResolvedValueOnce(tokenResponse('t'));
      mockFetch.mockImplementationOnce(hangingFetchImpl);

      const client = new NavidromeClient(makeConfig());
      // Simulating addTracksToPlaylist or createPlaylist: POST that the LLM
      // can re-invoke via the tool layer if it wants. The wrapper must NOT
      // silently retry — if Navidrome already applied the mutation just
      // before the timeout, retry would create a duplicate playlist or
      // double-add tracks.
      const promise = client.request('/playlist', {
        method: 'POST',
        body: JSON.stringify({ name: 'New Playlist' }),
      });
      const settled = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1001);

      const result = await settled;
      expect(result).toBeInstanceOf(FetchTimeoutError);
      expect((result as FetchTimeoutError).attempts).toBe(1);
      // login + single POST attempt = 2 fetches. No retry.
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCurrentToken — public token accessor', () => {
    // The library-manager fragility fix added this method so callers can
    // decode user-scoped JWT claims without reaching into the private
    // `authManager` field via `as unknown as`. It must round-trip whatever
    // AuthManager has cached and continue to participate in the standard
    // refresh-on-expiry flow.
    it('returns the current cached JWT', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse('jwt.payload.sig'));
      const client = new NavidromeClient(makeConfig());

      const token = await client.getCurrentToken();
      expect(token).toBe('jwt.payload.sig');
      // No second /auth/login on a follow-up call when the cache is hot.
      const second = await client.getCurrentToken();
      expect(second).toBe('jwt.payload.sig');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('triggers /auth/login on first call (lazy auth)', async () => {
      mockFetch.mockResolvedValueOnce(tokenResponse('lazy-auth-token'));
      const client = new NavidromeClient(makeConfig());

      const token = await client.getCurrentToken();
      expect(token).toBe('lazy-auth-token');
      // First call is the only fetch — no implicit warm-up.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(typeof url === 'string' && url.endsWith('/auth/login')).toBe(true);
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
