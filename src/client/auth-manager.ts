/**
 * Navidrome MCP Server - Authentication Manager
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

import { setTimeout as delay } from 'node:timers/promises';

import type { Config } from '../config.js';
import { MAX_AUTH_RATE_LIMIT_WAIT_MS, NAVIDROME_LOGIN_RATE_LIMIT_WINDOW_MS } from '../constants/timeouts.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import {
  FetchTimeoutError,
  fetchWithTimeout,
  getNavidromeAuthTimeoutMs,
} from '../utils/fetch-with-timeout.js';

/** Navidrome answered the login with an outage status, so the URL and credentials were never judged. */
class NavidromeUnavailableError extends Error {}

const UNREACHABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const MAX_CAUSE_DEPTH = 5;

/**
 * True when a startup failure means Navidrome could not be reached, as opposed to rejecting the
 * configured URL or credentials. An unrecognized failure counts as a configuration problem.
 */
export function isNavidromeUnreachable(error: unknown): boolean {
  if (error instanceof FetchTimeoutError || error instanceof NavidromeUnavailableError) return true;
  return hasUnreachableCode(error, 0);
}

/** undici nests the socket error under `cause`, and a dual-stack connect wraps one per address in an AggregateError. */
function hasUnreachableCode(error: unknown, depth: number): boolean {
  if (depth > MAX_CAUSE_DEPTH || typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && UNREACHABLE_ERROR_CODES.has(code)) return true;
  const nested: unknown[] = error instanceof AggregateError ? error.errors : [];
  return [(error as { cause?: unknown }).cause, ...nested].some((inner) => hasUnreachableCode(inner, depth + 1));
}

export class AuthManager {
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private readonly config: Config;
  // Single-flight refresh: if N concurrent callers all hit getToken() with
  // an expired/invalidated token, only ONE actually POSTs /auth/login; the
  // rest await the same promise. Cleared on settle so failure can be retried.
  private refreshPromise: Promise<void> | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  async authenticate(): Promise<void> {
    this.refreshPromise ??= this.performAuthenticate();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Discard the cached token so the next getToken() call re-authenticates. A late 401
   * for a token already replaced by a refresh leaves the fresh token in place.
   */
  invalidate(staleToken: string): void {
    if (this.token !== staleToken) return;
    this.token = null;
    this.tokenExpiry = null;
  }

  async getToken(): Promise<string> {
    if (this.token === null || this.token === '' || this.tokenExpiry === null || this.tokenExpiry <= new Date()) {
      await this.authenticate();
    }

    if (this.token === null || this.token === '') {
      throw new Error(ErrorFormatter.authentication('token not available after authentication'));
    }

    return this.token;
  }

  private async performAuthenticate(): Promise<void> {
    let response = await this.postLogin();

    // Navidrome allows a few logins per window, so processes started together
    // (MCP restarts, a spawned web player) wait out the window once.
    if (response.status === 429) {
      const waitMs = retryAfterMs(response.headers.get('retry-after'));
      logger.warn(`Navidrome is rate-limiting logins (HTTP 429). Retrying in ${Math.ceil(waitMs / 1000)}s.`);
      await response.body?.cancel().catch(() => undefined);
      await delay(waitMs);
      response = await this.postLogin();
    }
    if (response.status === 429) {
      throw new NavidromeUnavailableError(ErrorFormatter.authentication(
        `Navidrome is rate-limiting logins (HTTP 429). Wait about ${NAVIDROME_LOGIN_RATE_LIMIT_WINDOW_MS / 1000} seconds, then retry.`,
      ));
    }

    // Only 401 and 403 mean bad credentials. Any other status points at the URL or a down server.
    if (response.status === 401 || response.status === 403) {
      throw new Error(ErrorFormatter.authentication(
        `Navidrome rejected the username or password (${response.status} ${response.statusText})`,
      ));
    }
    if (!response.ok) {
      const message = ErrorFormatter.httpRequest(
        'Navidrome /auth/login',
        response,
        'check navidrome.url and that Navidrome is running',
      );
      throw response.status >= 500 ? new NavidromeUnavailableError(message) : new Error(message);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // 200 OK but body wasn't valid JSON (empty body, HTML error page from a
      // proxy, etc.) — surface with auth context instead of a bare SyntaxError.
      throw new Error(ErrorFormatter.authentication('invalid JSON in /auth/login response'));
    }
    if (data === null || typeof data !== 'object') {
      // 200 OK but the body was a non-object (literal `null`, string, number)
      // from a misbehaving proxy/cache — guard before reading `.token` so the
      // failure carries auth context instead of a native TypeError.
      throw new Error(ErrorFormatter.authentication('unexpected /auth/login response shape'));
    }
    const token = (data as { token?: unknown }).token;
    if (typeof token !== 'string' || token === '') {
      throw new Error(ErrorFormatter.authentication('server returned no token'));
    }
    this.token = token;
    this.tokenExpiry = new Date(Date.now() + this.config.tokenExpiry * 1000); // Convert seconds to milliseconds
    logger.debug('Authentication successful');
  }

  /**
   * A timed-out login is not retried, since a retry could trip an account
   * lockout. The caller retries the tool call through the single-flight path.
   */
  private postLogin(): Promise<Response> {
    return fetchWithTimeout(
      `${this.config.navidromeUrl}/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.config.navidromeUsername,
          password: this.config.navidromePassword,
        }),
      },
      {
        timeoutMs: getNavidromeAuthTimeoutMs(),
        retryPolicy: 'never',
        operationLabel: 'Navidrome /auth/login',
      },
    );
  }
}

/** Reads a delta-seconds `Retry-After`, falling back to Navidrome's default login window. */
function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  const waitMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : NAVIDROME_LOGIN_RATE_LIMIT_WINDOW_MS;
  return Math.min(waitMs, MAX_AUTH_RATE_LIMIT_WAIT_MS);
}
