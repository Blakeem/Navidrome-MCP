/**
 * Navidrome MCP Server - Fetch with timeout + single-retry helper
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { EnvHttpProxyAgent } from 'undici';
import {
  DEFAULT_EXTERNAL_API_TIMEOUT_MS,
  DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS,
  DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS,
  MAX_FETCH_TIMEOUT_MS,
  MIN_FETCH_TIMEOUT_MS,
} from '../constants/timeouts.js';
import { logger, redact } from './logger.js';
import { describeFetchError, fetchWithDispatcher } from './network-safety.js';

/**
 * hasProxyEnvConfigured and the agent share this lookup, so a proxied request never reaches an
 * agent that resolves no proxy.
 */
function resolveProxyEnv(protocol: 'http' | 'https'): string | undefined {
  const lowercase = process.env[`${protocol}_proxy`] ?? '';
  if (lowercase !== '') return lowercase;
  const uppercase = process.env[`${protocol.toUpperCase()}_PROXY`] ?? '';
  return uppercase !== '' ? uppercase : undefined;
}

/**
 * Node's `fetch` ignores HTTP_PROXY, HTTPS_PROXY and NO_PROXY. The agent is built lazily and fixes
 * the proxy URLs at construction, so a proxy change needs a restart.
 */
let envProxyAgent: EnvHttpProxyAgent | undefined;
function getEnvProxyAgent(): EnvHttpProxyAgent {
  // '' stops undici from reading the env, where an empty lowercase var hides the uppercase one.
  envProxyAgent ??= new EnvHttpProxyAgent({
    httpProxy: resolveProxyEnv('http') ?? '',
    httpsProxy: resolveProxyEnv('https') ?? '',
  });
  return envProxyAgent;
}

/** Without a proxy, requests keep plain global `fetch`, which tests mock through `global.fetch`. */
function hasProxyEnvConfigured(): boolean {
  return resolveProxyEnv('http') !== undefined || resolveProxyEnv('https') !== undefined;
}

/**
 * `'safe'` retries a timeout once. The caller picks the policy because Subsonic sends idempotent
 * writes such as `/star` as POST.
 */
export type RetryPolicy = 'safe' | 'never';

export interface FetchWithTimeoutOptions {
  /** The value is used as given. Only the env getters clamp it to the MIN and MAX fetch timeout. */
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly operationLabel: string;
  /**
   * Third-party internet APIs may be unreachable without the proxy. Navidrome and other LAN calls
   * leave it off and stay direct.
   */
  readonly respectProxy?: boolean;
  /** A timeout leaves the write's outcome unknown, so the error says to check state first. */
  readonly nonIdempotent?: boolean;
}

export class FetchTimeoutError extends Error {
  override readonly name = 'TimeoutError';
  readonly attempts: number;
  readonly timeoutMs: number;

  constructor(operationLabel: string, timeoutMs: number, attempts: number, nonIdempotent = false) {
    const suffix = attempts > 1 ? ` (after ${attempts} attempts)` : '';
    const writeNote = nonIdempotent
      ? ' The change may already have been applied. Check the current state before retrying.'
      : '';
    super(
      `${operationLabel} did not respond within ${timeoutMs}ms${suffix}. The server may be down or overloaded.${writeNote}`,
    );
    this.attempts = attempts;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * readTimeoutEnv runs on every request, so each misconfigured value warns once instead of flooding
 * the log. Keying by the raw value lets a different bad value warn again.
 */
const warnedTimeoutEnv = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedTimeoutEnv.has(key)) return;
  warnedTimeoutEnv.add(key);
  logger.warn(message);
}

/** process.env is read on every call, not once, so tests can change it between cases. */
function readTimeoutEnv(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    warnOnce(
      `${envName}:${raw}`,
      `${envName}="${raw}" is not a positive integer; falling back to ${fallback}ms`,
    );
    return fallback;
  }
  if (parsed < MIN_FETCH_TIMEOUT_MS) {
    warnOnce(
      `${envName}:${raw}`,
      `${envName}=${parsed} is below MIN_FETCH_TIMEOUT_MS (${MIN_FETCH_TIMEOUT_MS}); clamping`,
    );
    return MIN_FETCH_TIMEOUT_MS;
  }
  if (parsed > MAX_FETCH_TIMEOUT_MS) {
    warnOnce(
      `${envName}:${raw}`,
      `${envName}=${parsed} exceeds MAX_FETCH_TIMEOUT_MS (${MAX_FETCH_TIMEOUT_MS}); ` +
        'clamping to keep total wall-clock under the MCP SDK 60s envelope after retry',
    );
    return MAX_FETCH_TIMEOUT_MS;
  }
  return parsed;
}

export function getNavidromeRequestTimeoutMs(): number {
  return readTimeoutEnv(
    'NAVIDROME_REQUEST_TIMEOUT_MS',
    DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS,
  );
}

export function getNavidromeAuthTimeoutMs(): number {
  return readTimeoutEnv(
    'NAVIDROME_AUTH_TIMEOUT_MS',
    DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS,
  );
}

export function getExternalApiTimeoutMs(): number {
  return readTimeoutEnv(
    'EXTERNAL_API_TIMEOUT_MS',
    DEFAULT_EXTERNAL_API_TIMEOUT_MS,
  );
}

/** AbortSignal.timeout rejects with a TimeoutError. Older Node may report an AbortError. */
function isTimeoutAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.name === 'TimeoutError';
}

/** 4xx and 5xx responses resolve normally, so callers check `response.ok`. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, retryPolicy, operationLabel, respectProxy = false, nonIdempotent = false } = options;
  const maxAttempts = retryPolicy === 'safe' ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const callerSignal = init.signal;
    const signal =
      callerSignal !== null && callerSignal !== undefined
        ? AbortSignal.any([callerSignal, timeoutSignal])
        : timeoutSignal;

    try {
      if (respectProxy && hasProxyEnvConfigured()) {
        return await fetchWithDispatcher(url, { ...init, signal }, getEnvProxyAgent());
      }
      return await fetch(url, { ...init, signal });
    } catch (err) {
      // A caller abort means the caller no longer wants the result, so it is never retried.
      if (callerSignal?.aborted === true) {
        throw err;
      }

      if (!isTimeoutAbort(err)) {
        // This message reaches the LLM, and Node's credentials TypeError embeds the full URL, so
        // redact() strips the userinfo.
        throw new Error(`${operationLabel} failed: ${redact(describeFetchError(err)) as string}`, { cause: err });
      }

      if (attempt < maxAttempts) {
        logger.debug(
          `${operationLabel} timed out after ${timeoutMs}ms; retrying once (attempt ${attempt + 1}/${maxAttempts})`,
        );
        continue;
      }
    }
  }

  throw new FetchTimeoutError(operationLabel, timeoutMs, maxAttempts, nonIdempotent);
}
