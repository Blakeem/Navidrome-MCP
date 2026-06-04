/**
 * Navidrome MCP Server - Fetch with timeout + single-retry helper
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import {
  DEFAULT_EXTERNAL_API_TIMEOUT_MS,
  DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS,
  DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS,
  MAX_FETCH_TIMEOUT_MS,
  MIN_FETCH_TIMEOUT_MS,
} from '../constants/timeouts.js';
import { logger } from './logger.js';

/**
 * Methods that are safe to retry on timeout.
 *
 * GET is always idempotent. We also include the Subsonic mutations
 * (`/star`, `/unstar`, `/setRating`) which ARE idempotent semantically — but
 * those go through `subsonicRequest` as POST, so we must classify by URL
 * intent, not method. The retry-policy decision is therefore made by the
 * caller (which knows whether the operation it's wrapping is idempotent),
 * not by inspecting `init.method`.
 */
export type RetryPolicy = 'safe' | 'never';

export interface FetchWithTimeoutOptions {
  /** Per-attempt timeout in ms. Clamped to [MIN_FETCH_TIMEOUT_MS, MAX_FETCH_TIMEOUT_MS]. */
  readonly timeoutMs: number;
  /** Whether to retry once on AbortError. `'safe'` = retry, `'never'` = single attempt. */
  readonly retryPolicy: RetryPolicy;
  /** Operation label used in timeout error messages surfaced to the LLM. */
  readonly operationLabel: string;
}

/**
 * Error thrown when all attempts (initial + optional retry) time out.
 *
 * Surfaced to the LLM via `ErrorFormatter.toolExecution`. Tagged with
 * `name = 'TimeoutError'` so callers / tests can detect it without parsing
 * the message string.
 */
export class FetchTimeoutError extends Error {
  override readonly name = 'TimeoutError';
  readonly attempts: number;
  readonly timeoutMs: number;

  constructor(operationLabel: string, timeoutMs: number, attempts: number) {
    const suffix = attempts > 1 ? ` (after ${attempts} attempts)` : '';
    super(
      `${operationLabel} did not respond within ${timeoutMs}ms${suffix} — server may be down or overloaded`,
    );
    this.attempts = attempts;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Read a positive-integer env var, or return `fallback` if unset/invalid.
 * Clamps to `[MIN_FETCH_TIMEOUT_MS, MAX_FETCH_TIMEOUT_MS]` and warns once
 * if the configured value was clamped (likely misconfiguration).
 */
function readTimeoutEnv(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      `${envName}="${raw}" is not a positive integer; falling back to ${fallback}ms`,
    );
    return fallback;
  }
  if (parsed < MIN_FETCH_TIMEOUT_MS) {
    logger.warn(
      `${envName}=${parsed} is below MIN_FETCH_TIMEOUT_MS (${MIN_FETCH_TIMEOUT_MS}); clamping`,
    );
    return MIN_FETCH_TIMEOUT_MS;
  }
  if (parsed > MAX_FETCH_TIMEOUT_MS) {
    logger.warn(
      `${envName}=${parsed} exceeds MAX_FETCH_TIMEOUT_MS (${MAX_FETCH_TIMEOUT_MS}); ` +
        'clamping to keep total wall-clock under the MCP SDK 60s envelope after retry',
    );
    return MAX_FETCH_TIMEOUT_MS;
  }
  return parsed;
}

/**
 * Resolve the configured Navidrome REST/Subsonic request timeout.
 * Reads `NAVIDROME_REQUEST_TIMEOUT_MS` env var or falls back to the default.
 * Computed once per call so tests can mutate process.env between cases.
 */
export function getNavidromeRequestTimeoutMs(): number {
  return readTimeoutEnv(
    'NAVIDROME_REQUEST_TIMEOUT_MS',
    DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS,
  );
}

/** Resolve the configured Navidrome auth (`/auth/login`) timeout. */
export function getNavidromeAuthTimeoutMs(): number {
  return readTimeoutEnv(
    'NAVIDROME_AUTH_TIMEOUT_MS',
    DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS,
  );
}

/** Resolve the configured external-API (Last.fm / LRCLIB / Radio Browser) timeout. */
export function getExternalApiTimeoutMs(): number {
  return readTimeoutEnv(
    'EXTERNAL_API_TIMEOUT_MS',
    DEFAULT_EXTERNAL_API_TIMEOUT_MS,
  );
}

/**
 * Detect whether an error is the "abort-due-to-timeout" signal. Native fetch
 * surfaces this as a DOMException-like object with `name === 'AbortError'`
 * (or, on some Node versions, a TimeoutError). Either way, both are eligible
 * for a single retry under `retryPolicy: 'safe'`.
 */
function isTimeoutAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.name === 'TimeoutError';
}

/**
 * fetch() wrapper that:
 *   1. Aborts the underlying request after `timeoutMs` (via AbortSignal.timeout).
 *   2. On AbortError, retries exactly once if `retryPolicy === 'safe'`.
 *   3. Surfaces a `FetchTimeoutError` (name: 'TimeoutError') on final failure
 *      with a message safe to expose to the LLM.
 *
 * Non-timeout errors (DNS failure, connection refused, 4xx/5xx) are re-thrown
 * unchanged — the standard error-handling paths upstream already format these.
 *
 * The caller-provided `init.signal`, if any, is respected and combined via
 * `AbortSignal.any` (Node 20.3+); on older Node the timeout signal alone is
 * used. Both `AbortSignal.timeout` and `AbortSignal.any` are part of the
 * package's stated `engines: ">=18"` because we already require Node 20+
 * for other features (verified at runtime via package.json `engines`).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, retryPolicy, operationLabel } = options;
  const maxAttempts = retryPolicy === 'safe' ? 2 : 1;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const callerSignal = init.signal;
    const signal =
      callerSignal !== null && callerSignal !== undefined
        ? AbortSignal.any([callerSignal, timeoutSignal])
        : timeoutSignal;

    try {
      return await fetch(url, { ...init, signal });
    } catch (err) {
      lastError = err;

      // If the caller's own signal aborted, don't retry — the caller wants out.
      if (callerSignal?.aborted === true) {
        throw err;
      }

      if (!isTimeoutAbort(err)) {
        // Non-timeout error (DNS, connection refused, etc.) — surface immediately.
        throw err;
      }

      if (attempt < maxAttempts) {
        logger.debug(
          `${operationLabel} timed out after ${timeoutMs}ms; retrying once (attempt ${attempt + 1}/${maxAttempts})`,
        );
        continue;
      }
    }
  }

  // All attempts exhausted on timeout. `lastError` is intentionally not chained
  // — the AbortError stack is uninformative, and surfacing it would expose the
  // string "AbortError" to the LLM where "TimeoutError" is more meaningful.
  void lastError;
  throw new FetchTimeoutError(operationLabel, timeoutMs, maxAttempts);
}
