/**
 * Navidrome MCP Server - Authentication Manager
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

/** Navidrome answered the login with 429 or 5xx, so the URL and credentials were never judged. */
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

/** An unrecognized failure counts as a configuration problem, so the settings page still opens. */
export function isNavidromeUnreachable(error: unknown): boolean {
  if (error instanceof FetchTimeoutError || error instanceof NavidromeUnavailableError) return true;
  return hasUnreachableCode(error, 0);
}

/**
 * undici nests the socket error under `cause`, and a dual-stack connect wraps one error per address
 * in an AggregateError.
 */
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
  // Concurrent callers with a stale token share one /auth/login POST. Cleared on settle, so a
  // failed login can be retried.
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

  /** A late 401 for a token that a refresh already replaced leaves the fresh token in place. */
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
      throw new Error(ErrorFormatter.authentication('invalid JSON in /auth/login response'));
    }
    if (data === null || typeof data !== 'object') {
      throw new Error(ErrorFormatter.authentication('unexpected /auth/login response shape'));
    }
    const token = (data as { token?: unknown }).token;
    if (typeof token !== 'string' || token === '') {
      throw new Error(ErrorFormatter.authentication('server returned no token'));
    }
    this.token = token;
    this.tokenExpiry = new Date(Date.now() + this.config.tokenExpiry * 1000);
    logger.debug('Authentication successful');
  }

  /** A timed-out login is not retried, since every attempt counts against a login rate limit. */
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
