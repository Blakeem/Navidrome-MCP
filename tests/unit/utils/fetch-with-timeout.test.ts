/**
 * Navidrome MCP Server - fetch-with-timeout unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * AbortSignal.timeout ignores vi.useFakeTimers, so each timeout case waits its real timeoutMs.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

/**
 * `vi.mock`'s factory is hoisted, so the mocks it closes over come from `vi.hoisted`. The real
 * EnvHttpProxyAgent stays, since constructing one opens no socket.
 */
const { mockUndiciFetch, proxyAgentOptions } = vi.hoisted(() => ({
  mockUndiciFetch:
    vi.fn<(url: string, init: { signal?: AbortSignal; dispatcher?: unknown }) => Promise<Response>>(),
  proxyAgentOptions: [] as unknown[],
}));

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  class RecordingEnvHttpProxyAgent extends actual.EnvHttpProxyAgent {
    constructor(options?: ConstructorParameters<typeof actual.EnvHttpProxyAgent>[0]) {
      super(options);
      proxyAgentOptions.push(options);
    }
  }
  return { ...actual, fetch: mockUndiciFetch, EnvHttpProxyAgent: RecordingEnvHttpProxyAgent };
});

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
import { logger } from '../../../src/utils/logger.js';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

/** Mirrors native fetch against a server that accepts the connection but never replies. */
function hangingFetch(): (
  url: unknown,
  init?: { signal?: AbortSignal | null },
) => Promise<Response> {
  return (_url: unknown, init?: { signal?: AbortSignal | null }) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) {
        return;
      }
      if (signal.aborted) {
        const reason = signal.reason instanceof Error ? signal.reason : new Error('aborted');
        reject(reason);
        return;
      }
      signal.addEventListener('abort', () => {
        // Native fetch rejects with TimeoutError for AbortSignal.timeout, and AbortError otherwise.
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
      mockFetch
        .mockImplementationOnce(hangingFetch())
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const promise = fetchWithTimeout(
        'http://x/y',
        {},
        baseOptions({ timeoutMs: 1000, retryPolicy: 'safe' }),
      );

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
      // An early catch keeps the pending rejection from surfacing as unhandled.
      const settled = promise.catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(1001);
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
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on non-timeout errors (DNS / connection-refused / 4xx-5xx)', async () => {
      // fetch resolves a 4xx or 5xx response, so only a rejected network failure needs a case here.
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }));

      await expect(
        fetchWithTimeout('http://x/y', {}, baseOptions({ retryPolicy: 'safe' })),
      ).rejects.toThrow(/ECONNREFUSED/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('surfaces the root cause of a "fetch failed" error with the operation label', async () => {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:4533');
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed', { cause }));

      const error = await fetchWithTimeout('http://x/y', {}, baseOptions({ operationLabel: 'Navidrome GET /album' })).then(
        () => null,
        (err: unknown) => err as Error,
      );
      expect(error?.message).toBe('Navidrome GET /album failed: connect ECONNREFUSED 127.0.0.1:4533');
      expect(error?.cause).toBeInstanceOf(TypeError);
    });
  });

  describe('non-timeout errors', () => {
    it('redacts URL credentials from the rethrown message', async () => {
      mockFetch.mockRejectedValueOnce(
        new TypeError('Request cannot be constructed from a URL that includes credentials: https://u:secret@host/x'),
      );

      const err = await fetchWithTimeout('https://u:secret@host/x', {}, baseOptions()).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('test op failed:');
      expect((err as Error).message).not.toContain('secret');
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

      callerController.abort();
      await vi.advanceTimersByTimeAsync(0);

      const result = await settled;
      // abort() with no reason yields an AbortError, which the wrapper rethrows unchanged.
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).name).toBe('AbortError');
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
      'op did not respond within 1000ms. The server may be down or overloaded.',
    );
    expect(new FetchTimeoutError('op', 1000, 2).message).toBe(
      'op did not respond within 1000ms (after 2 attempts). The server may be down or overloaded.',
    );
  });

  it('adds a check-before-retry note for a non-idempotent write', () => {
    expect(new FetchTimeoutError('op', 1000, 1, true).message).toBe(
      'op did not respond within 1000ms. The server may be down or overloaded. ' +
        'The change may already have been applied. Check the current state before retrying.',
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

  // The warn-once Set is module-level, so each case uses an env value no other test warned about.
  describe('misconfiguration warn-once dedup', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('warns once per distinct bad value, not once per call', () => {
      // The resolvers run on every request, so an undeduplicated warning would repeat for the
      // process lifetime.
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = 'dedup-garbage-a';
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = 'dedup-garbage-b';
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('keeps recomputing the clamped return value even when the warn is deduped', () => {
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = '17';
      expect(getNavidromeRequestTimeoutMs()).toBe(MIN_FETCH_TIMEOUT_MS);
      expect(getNavidromeRequestTimeoutMs()).toBe(MIN_FETCH_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('dedups the same value independently per env var name', () => {
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = 'shared-garbage';
      process.env['EXTERNAL_API_TIMEOUT_MS'] = 'shared-garbage';
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(getExternalApiTimeoutMs()).toBe(DEFAULT_EXTERNAL_API_TIMEOUT_MS);
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(getExternalApiTimeoutMs()).toBe(DEFAULT_EXTERNAL_API_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe('proxy transport selection', () => {
  const PROXY_ENV_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const;

  function clearProxyEnv(): void {
    for (const name of PROXY_ENV_VARS) {
      delete process.env[name];
    }
  }

  beforeEach(() => {
    mockFetch.mockReset();
    mockUndiciFetch.mockReset();
    clearProxyEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearProxyEnv();
  });

  describe('takes the direct transport (global fetch)', () => {
    it('when respectProxy is true but no proxy var is set', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const response = await fetchWithTimeout('http://x/y', {}, baseOptions({ respectProxy: true }));

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockUndiciFetch).not.toHaveBeenCalled();
    });

    it('when respectProxy is omitted (the Navidrome/LAN default) despite a proxy being set', async () => {
      process.env['HTTPS_PROXY'] = 'http://proxy.test:8080';
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await fetchWithTimeout('http://navidrome.lan/api/album', {}, baseOptions());

      // An internet proxy must never divert Navidrome REST/Subsonic/auth traffic.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockUndiciFetch).not.toHaveBeenCalled();
    });

    it('when every proxy var is set but empty', async () => {
      for (const name of PROXY_ENV_VARS) {
        process.env[name] = '';
      }
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await fetchWithTimeout('http://x/y', {}, baseOptions({ respectProxy: true }));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockUndiciFetch).not.toHaveBeenCalled();
    });
  });

  describe('takes the proxied transport (undici fetch + EnvHttpProxyAgent)', () => {
    it('when respectProxy is true and HTTPS_PROXY is set', async () => {
      process.env['HTTPS_PROXY'] = 'http://proxy.test:8080';
      mockUndiciFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const response = await fetchWithTimeout(
        'https://ws.audioscrobbler.com/2.0/',
        { headers: { 'X-Test': '1' } },
        baseOptions({ respectProxy: true }),
      );

      expect(response.status).toBe(200);
      expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();

      const [, init] = mockUndiciFetch.mock.calls[0]!;
      expect(init.dispatcher).toBeDefined();
      // The timeout signal must survive the switch of transport.
      expect(init.signal).toBeDefined();
    });

    it('when only the lowercase http_proxy is set', async () => {
      process.env['http_proxy'] = 'http://proxy.test:8080';
      mockUndiciFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await fetchWithTimeout('http://x/y', {}, baseOptions({ respectProxy: true }));

      expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('when HTTP_PROXY is empty but HTTPS_PROXY is real', async () => {
      // Compose files and CI emit an empty `HTTP_PROXY=`, which must not hide a real HTTPS_PROXY.
      process.env['HTTP_PROXY'] = '';
      process.env['HTTPS_PROXY'] = 'http://proxy.test:8080';
      mockUndiciFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await fetchWithTimeout('https://lrclib.net/api/search', {}, baseOptions({ respectProxy: true }));

      expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('hands the agent HTTPS_PROXY when the lowercase https_proxy is empty', async () => {
      // A plain object keeps both spellings distinct. Windows process.env is case-insensitive.
      const savedEnv = process.env;
      process.env = { ...savedEnv, https_proxy: '', HTTPS_PROXY: 'http://proxy.test:8080' };
      try {
        vi.resetModules();
        const fresh = await import('../../../src/utils/fetch-with-timeout.js');
        proxyAgentOptions.length = 0;
        mockUndiciFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

        await fresh.fetchWithTimeout('https://lrclib.net/api/search', {}, baseOptions({ respectProxy: true }));

        expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
        expect(proxyAgentOptions).toEqual([{ httpProxy: '', httpsProxy: 'http://proxy.test:8080' }]);
      } finally {
        process.env = savedEnv;
      }
    });

    it('still applies the timeout and the single safe retry', async () => {
      vi.useFakeTimers();
      process.env['HTTPS_PROXY'] = 'http://proxy.test:8080';
      mockUndiciFetch
        .mockImplementationOnce(hangingFetch())
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const promise = fetchWithTimeout(
        'https://lrclib.net/api/search',
        {},
        baseOptions({ timeoutMs: 1000, retryPolicy: 'safe', respectProxy: true }),
      );

      await vi.advanceTimersByTimeAsync(1001);

      const response = await promise;
      expect(response.status).toBe(200);
      expect(mockUndiciFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

const _retryPolicies: readonly RetryPolicy[] = ['safe', 'never'];
void _retryPolicies;
