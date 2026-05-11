/**
 * Navidrome MCP Server - fetch-with-timeout unit tests
 * Copyright (C) 2025
 *
 * Covers the fetch timeout + single-retry helper used by every outbound HTTP
 * path (NavidromeClient, AuthManager, Last.fm, LRCLIB, Radio Browser).
 *
 * Strategy: mock `global.fetch` so it returns a never-settling promise that
 * rejects only when the AbortSignal it was passed fires. Drive
 * `AbortSignal.timeout()` deterministically with `vi.useFakeTimers()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  fetchWithTimeout,
  FetchTimeoutError,
  getNavidromeRequestTimeoutMs,
  getNavidromeAuthTimeoutMs,
  getExternalApiTimeoutMs,
} from '../../../src/utils/fetch-with-timeout.js';
import type { RetryPolicy, FetchWithTimeoutOptions } from '../../../src/utils/fetch-with-timeout.js';
import {
  DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS,
  DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS,
  DEFAULT_EXTERNAL_API_TIMEOUT_MS,
  MAX_FETCH_TIMEOUT_MS,
  MIN_FETCH_TIMEOUT_MS,
} from '../../../src/constants/timeouts.js';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

/**
 * Create a fetch impl that hangs forever, only rejecting when the passed
 * AbortSignal aborts. Mirrors how native fetch behaves on a server that
 * accepts the connection but never replies.
 */
function hangingFetch(): (
  url: string,
  init?: RequestInit,
) => Promise<Response> {
  return (_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) {
        // No signal — would hang forever in real life. Tests that don't pass
        // a timeout shouldn't reach here.
        return;
      }
      if (signal.aborted) {
        // Synchronously aborted before fetch even ran.
        const reason = signal.reason instanceof Error ? signal.reason : new Error('aborted');
        reject(reason);
        return;
      }
      signal.addEventListener('abort', () => {
        // Mirror native fetch: throw the abort reason (a DOMException-like
        // with name='TimeoutError' for AbortSignal.timeout, or 'AbortError'
        // otherwise). Use a real Error subclass with the right `name`.
        const reasonName = signal.reason instanceof Error ? signal.reason.name : 'AbortError';
        const err = new Error('aborted');
        err.name = reasonName === 'TimeoutError' ? 'TimeoutError' : 'AbortError';
        reject(err);
      }, { once: true });
    });
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseOptions = (overrides: Partial<FetchWithTimeoutOptions> = {}): FetchWithTimeoutOptions => ({
  timeoutMs: 1000,
  retryPolicy: 'safe',
  operationLabel: 'test op',
  ...overrides,
});

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env['NAVIDROME_REQUEST_TIMEOUT_MS'];
    delete process.env['NAVIDROME_AUTH_TIMEOUT_MS'];
    delete process.env['EXTERNAL_API_TIMEOUT_MS'];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('happy path', () => {
    it('returns the Response when fetch resolves before timeout', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const response = await fetchWithTimeout('http://x/y', {}, baseOptions());

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('passes through custom headers and method', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await fetchWithTimeout(
        'http://x/y',
        { method: 'POST', headers: { 'X-Test': '1' }, body: 'payload' },
        baseOptions(),
      );

      const [, init] = mockFetch.mock.calls[0]!;
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['X-Test']).toBe('1');
      expect(init?.body).toBe('payload');
      // The signal is injected by fetchWithTimeout — the caller didn't pass one,
      // but the impl must still attach the timeout signal.
      expect(init?.signal).toBeDefined();
    });
  });

  describe('timeout firing', () => {
    it('aborts the underlying fetch after timeoutMs and throws FetchTimeoutError when retryPolicy="never"', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(hangingFetch());

      const promise = fetchWithTimeout(
        'http://x/y',
        {},
        baseOptions({ timeoutMs: 1000, retryPolicy: 'never' }),
      );

      await vi.advanceTimersByTimeAsync(1001);

      await expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
      await expect(promise).rejects.toMatchObject({
        name: 'TimeoutError',
        attempts: 1,
        timeoutMs: 1000,
      });
      // Single attempt — no retry.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('error message includes operationLabel and is LLM-friendly', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(hangingFetch());

      const promise = fetchWithTimeout(
        'http://x/y',
        {},
        baseOptions({ timeoutMs: 500, retryPolicy: 'never', operationLabel: 'Navidrome /api/album' }),
      );

      await vi.advanceTimersByTimeAsync(501);
      await expect(promise).rejects.toThrow(
        /Navidrome \/api\/album did not respond within 500ms.*server may be down or overloaded/,
      );
    });
  });

  describe('retry policy', () => {
    it('retries exactly once on timeout when retryPolicy="safe", then succeeds', async () => {
      vi.useFakeTimers();
      // First call hangs (will time out), second resolves.
      mockFetch
        .mockImplementationOnce(hangingFetch())
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const promise = fetchWithTimeout(
        'http://x/y',
        {},
        baseOptions({ timeoutMs: 1000, retryPolicy: 'safe' }),
      );

      // Drive the first attempt to timeout.
      await vi.advanceTimersByTimeAsync(1001);

      const response = await promise;
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries once on timeout when retryPolicy="safe", then throws if still hung', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockImplementationOnce(hangingFetch())
        .mockImplementationOnce(hangingFetch());

      const promise = fetchWithTimeout(
        'http://x/y',
        {},
        baseOptions({ timeoutMs: 1000, retryPolicy: 'safe' }),
      );
      // Catch immediately so the unhandled-rejection harness doesn't trip
      // while we drive the timers.
      const settled = promise.catch((e: unknown) => e);

      // First attempt times out.
      await vi.advanceTimersByTimeAsync(1001);
      // Second attempt times out.
      await vi.advanceTimersByTimeAsync(1001);

      const result = await settled;
      expect(result).toBeInstanceOf(FetchTimeoutError);
      expect((result as FetchTimeoutError).attempts).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry when retryPolicy="never" (POST mutation safety)', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(hangingFetch());

      const promise = fetchWithTimeout(
        'http://x/y',
        { method: 'POST', body: '{"name":"playlist"}' },
        baseOptions({ timeoutMs: 1000, retryPolicy: 'never' }),
      );
      const settled = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1001);

      const result = await settled;
      expect(result).toBeInstanceOf(FetchTimeoutError);
      expect((result as FetchTimeoutError).attempts).toBe(1);
      // Critical: POST that times out is NOT retried — server may have applied
      // the mutation just before the timeout, retry would double-apply.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on non-timeout errors (DNS / connection-refused / 4xx-5xx)', async () => {
      // 4xx/5xx are returned as resolved Responses, not errors — they go straight through.
      // Network errors (DNS, ECONNREFUSED) come back as rejected promises with names like
      // 'TypeError'. Those must NOT be retried, regardless of retryPolicy.
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }));

      await expect(
        fetchWithTimeout('http://x/y', {}, baseOptions({ retryPolicy: 'safe' })),
      ).rejects.toThrow(/ECONNREFUSED/);
      // Single attempt — connection-refused is a fail-fast, not a retry-eligible timeout.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('caller-provided AbortSignal', () => {
    it("respects caller's AbortController (does not retry when caller aborts)", async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(hangingFetch());

      const callerController = new AbortController();
      const promise = fetchWithTimeout(
        'http://x/y',
        { signal: callerController.signal },
        baseOptions({ timeoutMs: 5000, retryPolicy: 'safe' }),
      );
      const settled = promise.catch((e: unknown) => e);

      // Caller aborts immediately — before timeout.
      callerController.abort();
      await vi.advanceTimersByTimeAsync(0);

      const result = await settled;
      // The abort name from the caller's signal is 'AbortError' (default for
      // controller.abort() with no reason); the wrapper rethrows it as-is.
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).name).toBe('AbortError');
      // Critical: even with safe-retry, a caller-initiated abort must NOT trigger retry.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('FetchTimeoutError', () => {
  it('has name="TimeoutError" so callers can detect via err.name', () => {
    const err = new FetchTimeoutError('label', 1000, 2);
    expect(err.name).toBe('TimeoutError');
    expect(err).toBeInstanceOf(Error);
    expect(err.attempts).toBe(2);
    expect(err.timeoutMs).toBe(1000);
  });

  it('formats message differently when single vs. multiple attempts', () => {
    expect(new FetchTimeoutError('op', 1000, 1).message).toBe(
      'op did not respond within 1000ms — server may be down or overloaded',
    );
    expect(new FetchTimeoutError('op', 1000, 2).message).toBe(
      'op did not respond within 1000ms (after 2 attempts) — server may be down or overloaded',
    );
  });
});

describe('timeout env var resolvers', () => {
  beforeEach(() => {
    delete process.env['NAVIDROME_REQUEST_TIMEOUT_MS'];
    delete process.env['NAVIDROME_AUTH_TIMEOUT_MS'];
    delete process.env['EXTERNAL_API_TIMEOUT_MS'];
  });

  it('returns defaults when env vars are unset', () => {
    expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
    expect(getNavidromeAuthTimeoutMs()).toBe(DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS);
    expect(getExternalApiTimeoutMs()).toBe(DEFAULT_EXTERNAL_API_TIMEOUT_MS);
  });

  it('reads valid positive integer from env', () => {
    process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '8000';
    expect(getNavidromeRequestTimeoutMs()).toBe(8000);
  });

  it('clamps env values above MAX_FETCH_TIMEOUT_MS to keep us under the MCP SDK 60s envelope', () => {
    process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = String(MAX_FETCH_TIMEOUT_MS + 5000);
    expect(getNavidromeRequestTimeoutMs()).toBe(MAX_FETCH_TIMEOUT_MS);
  });

  it('clamps env values below MIN_FETCH_TIMEOUT_MS to prevent sub-second fail-fast', () => {
    process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '100';
    expect(getNavidromeRequestTimeoutMs()).toBe(MIN_FETCH_TIMEOUT_MS);
  });

  it('falls back to default on garbage env values', () => {
    process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = 'not-a-number';
    expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);

    process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '-5000';
    expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);

    process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '0';
    expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
  });
});

// Type-only export reference — keeps RetryPolicy alive for ts-unused-exports
// (the type is used in the public surface but TS-only types don't always
// satisfy the dead-code analyzer through structural usage alone).
const _retryPolicies: readonly RetryPolicy[] = ['safe', 'never'];
void _retryPolicies;
