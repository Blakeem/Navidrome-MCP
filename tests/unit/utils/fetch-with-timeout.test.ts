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
 *
 * The proxy branch additionally mocks undici's own `fetch`, so which of the two
 * transports ran is observable without any real proxy or network.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

/**
 * The undici mocks must exist before `vi.mock`'s hoisted factory runs, hence
 * `vi.hoisted`. `fetch` is replaced. The real `EnvHttpProxyAgent` is kept, since
 * constructing one opens no socket, and a subclass records its options.
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

/**
 * Create a fetch impl that hangs forever, only rejecting when the passed
 * AbortSignal aborts. Mirrors how native fetch behaves on a server that
 * accepts the connection but never replies.
 */
function hangingFetch(): (
  url: unknown,
  init?: { signal?: AbortSignal | null },
) => Promise<Response> {
  return (_url: unknown, init?: { signal?: AbortSignal | null }) => {
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

  // NOTE: the warn-once dedup Set is module-level, so these tests use env
  // values unique to each case — a value another test already warned about
  // would be (correctly) deduped and skew the call counts.
  describe('misconfiguration warn-once dedup', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('warns once per distinct bad value, not once per call', () => {
      // Bug-fix lock-in: these resolvers run on every request, so pre-fix a
      // misconfigured env var emitted an identical warning per request for
      // the process lifetime.
      process.env['NAVIDROME_REQUEST_TIMEOUT_MS'] = 'dedup-garbage-a';
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(getNavidromeRequestTimeoutMs()).toBe(DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // A DIFFERENT bad value is a new misconfiguration — warn again, once.
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
      // One warn per env-var name, despite the identical raw value.
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe('proxy transport selection', () => {
  const PROXY_ENV_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const;

  // Windows `process.env` is case-insensitive, so deleting all four names also
  // covers the lowercase aliases of the same variable.
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
      // Bug-fix lock-in: a `??` chain stopped at the empty HTTP_PROXY and never
      // read HTTPS_PROXY, so the request went out direct and failed on a
      // proxy-only host. Compose files and CI emit `HTTP_PROXY=` this way.
      process.env['HTTP_PROXY'] = '';
      process.env['HTTPS_PROXY'] = 'http://proxy.test:8080';
      mockUndiciFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await fetchWithTimeout('https://lrclib.net/api/search', {}, baseOptions({ respectProxy: true }));

      expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('hands the agent HTTPS_PROXY when the lowercase https_proxy is empty', async () => {
      // A plain object keeps the two spellings distinct, since Windows process.env is case-insensitive.
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

// Type-only export reference — keeps RetryPolicy alive for ts-unused-exports
// (the type is used in the public surface but TS-only types don't always
// satisfy the dead-code analyzer through structural usage alone).
const _retryPolicies: readonly RetryPolicy[] = ['safe', 'never'];
void _retryPolicies;
