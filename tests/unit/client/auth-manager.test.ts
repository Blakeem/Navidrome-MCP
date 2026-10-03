/**
 * Navidrome MCP Server - AuthManager unit tests
 * Copyright (C) 2025
 *
 * Covers the B1 production-hardening changes: single-flight refresh dedup +
 * invalidate(). Mocks `global.fetch` so the auth flow is exercised without a
 * live Navidrome server.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { AuthManager } from '../../../src/client/auth-manager.js';
import { FetchTimeoutError } from '../../../src/utils/fetch-with-timeout.js';
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

describe('AuthManager', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getToken() returns the stored token when not expired', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ token: 'abc' }));
    const auth = new AuthManager(makeConfig());

    expect(await auth.getToken()).toBe('abc');
    expect(await auth.getToken()).toBe('abc'); // cached, no fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('getToken() re-authenticates when the cached token has expired', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ token: 'first' }))
      .mockResolvedValueOnce(jsonResponse({ token: 'second' }));
    const auth = new AuthManager(makeConfig());

    expect(await auth.getToken()).toBe('first');
    // Backdate the cached expiry so the next check sees an expired token
    // without depending on real time advancement (avoids fake-timer flake).
    (auth as unknown as { tokenExpiry: Date }).tokenExpiry = new Date(0);
    expect(await auth.getToken()).toBe('second');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('5 concurrent authenticate() calls trigger only 1 fetch (single-flight)', async () => {
    let resolveLogin!: (response: Response) => void;
    mockFetch.mockReturnValueOnce(new Promise<Response>(res => { resolveLogin = res; }));

    const auth = new AuthManager(makeConfig());
    const concurrent = Promise.all([
      auth.authenticate(),
      auth.authenticate(),
      auth.authenticate(),
      auth.authenticate(),
      auth.authenticate(),
    ]);

    // Let the microtask queue settle so all five callers reached the
    // refreshPromise dedup point.
    await Promise.resolve();
    resolveLogin(jsonResponse({ token: 'singleflight' }));
    await concurrent;

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('after invalidate(), the next getToken() re-authenticates', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ token: 'first' }))
      .mockResolvedValueOnce(jsonResponse({ token: 'second' }));
    const auth = new AuthManager(makeConfig());

    expect(await auth.getToken()).toBe('first');
    auth.invalidate();
    expect(await auth.getToken()).toBe('second');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a failed authenticate() clears refreshPromise so the next call retries', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ message: 'bad creds' }, 401))
      .mockResolvedValueOnce(jsonResponse({ token: 'recovered' }));
    const auth = new AuthManager(makeConfig());

    await expect(auth.authenticate()).rejects.toThrow();
    // Second call must NOT see a stale rejected promise — should make a
    // brand-new POST and succeed.
    await auth.authenticate();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(await auth.getToken()).toBe('recovered');
  });

  it('throws an auth-context error (not a native TypeError) on a literal null JSON body', async () => {
    // A 200 OK body of literal `null` parses successfully but is not an object.
    // The shape guard must reject with auth context instead of letting the next
    // `.token` read throw a native "Cannot read properties of null" TypeError.
    mockFetch.mockResolvedValueOnce(jsonResponse(null));
    const auth = new AuthManager(makeConfig());

    await expect(auth.getToken()).rejects.toThrow(/Authentication failed: unexpected \/auth\/login response shape/);
  });

  it('reports a 401 login as rejected credentials', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 401, statusText: 'Unauthorized' }));
    const auth = new AuthManager(makeConfig());

    await expect(auth.authenticate()).rejects.toThrow(
      'Authentication failed: Navidrome rejected the username or password (401 Unauthorized)',
    );
  });

  it('reports a 404 login as a URL or server problem, not bad credentials', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 404, statusText: 'Not Found' }));
    const auth = new AuthManager(makeConfig());

    const error = await auth.authenticate().then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(error?.message).toContain('Navidrome /auth/login - 404 Not Found');
    expect(error?.message).toContain('check navidrome.url');
    expect(error?.message).not.toContain('Authentication failed');
  });

  it('waits out a 429 Retry-After once, then logs in', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0.01' } }))
      .mockResolvedValueOnce(jsonResponse({ token: 'after-wait' }));
    const auth = new AuthManager(makeConfig());

    expect(await auth.getToken()).toBe('after-wait');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reports a second 429 as rate limiting, not a URL problem', async () => {
    const limited = (): Response => new Response('', { status: 429, headers: { 'Retry-After': '0.01' } });
    mockFetch.mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited());
    const auth = new AuthManager(makeConfig());

    await expect(auth.authenticate()).rejects.toThrow(/rate-limiting logins \(HTTP 429\)/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers all see the same failure when authenticate fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'down' }, 500));
    const auth = new AuthManager(makeConfig());

    const results = await Promise.allSettled([
      auth.authenticate(),
      auth.authenticate(),
      auth.authenticate(),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(results.every(r => r.status === 'rejected')).toBe(true);
  });

  describe('authenticate() timeout', () => {
    // Auth uses retryPolicy: 'never' — see auth-manager.ts comment for why.
    // A timed-out /auth/login throws a FetchTimeoutError immediately;
    // re-running the original tool call will single-flight-dedup retry it.

    afterEach(() => {
      delete process.env['NAVIDROME_AUTH_TIMEOUT_MS'];
      vi.useRealTimers();
    });

    it('throws FetchTimeoutError when /auth/login hangs (no retry)', async () => {
      vi.useFakeTimers();
      process.env['NAVIDROME_AUTH_TIMEOUT_MS'] = '1000';

      mockFetch.mockImplementationOnce((_url, init) => {
        return new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'TimeoutError';
            rej(err);
          }, { once: true });
        });
      });

      const auth = new AuthManager(makeConfig());
      const promise = auth.authenticate();
      const settled = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1001);

      const result = await settled;
      expect(result).toBeInstanceOf(FetchTimeoutError);
      // No retry on auth — single attempt only.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
