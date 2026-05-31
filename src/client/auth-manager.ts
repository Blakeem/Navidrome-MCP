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

import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import {
  fetchWithTimeout,
  getNavidromeAuthTimeoutMs,
} from '../utils/fetch-with-timeout.js';

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
   * Discard the cached token so the next getToken() call re-authenticates.
   * Used by NavidromeClient on 401 responses (server-rotated token, etc.).
   */
  invalidate(): void {
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
    // Auth gets no retry: a timed-out /auth/login could mean the server
    // accepted-but-didn't-respond, in which case retry is harmless, OR it
    // could mean account-lockout-on-N-failures policies were tripped on a
    // prior attempt and the server is rate-limiting us. Better to surface
    // the timeout to the caller — they (or the LLM) can retry the original
    // tool call, which goes through this single-flight path anyway.
    const response = await fetchWithTimeout(
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

    if (!response.ok) {
      throw new Error(ErrorFormatter.authentication(`${response.status} ${response.statusText}`));
    }

    const data = (await response.json()) as { token: string };
    if (typeof data.token !== 'string' || data.token === '') {
      throw new Error(ErrorFormatter.authentication('server returned no token'));
    }
    this.token = data.token;
    this.tokenExpiry = new Date(Date.now() + this.config.tokenExpiry * 1000); // Convert seconds to milliseconds
    logger.debug('Authentication successful');
  }
}
