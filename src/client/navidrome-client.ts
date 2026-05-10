/**
 * Navidrome MCP Server - API Client
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
import { AuthManager } from './auth-manager.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { libraryManager } from '../services/library-manager.js';
import { buildSubsonicAuthParams } from '../utils/subsonic-auth.js';

export class NavidromeClient {
  private readonly authManager: AuthManager;
  private readonly baseUrl: string;
  private readonly config: Config;

  constructor(config: Config) {
    this.baseUrl = config.navidromeUrl;
    this.authManager = new AuthManager(config);
    this.config = config;
  }

  async initialize(): Promise<void> {
    await this.authManager.authenticate();
    logger.info('Navidrome client initialized');
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    this.assertSafeEndpoint(endpoint);
    let response = await this.doFetch(endpoint, options);
    if (response.status === 401) {
      // Token rejected — invalidate the cache and retry exactly once with a
      // fresh authenticate(). If the second attempt also returns 401, fall
      // through to parseResponse which throws the standard HTTP error.
      logger.debug('Got 401 from Navidrome; invalidating token and retrying once');
      this.authManager.invalidate();
      response = await this.doFetch(endpoint, options);
    }
    return this.parseResponse<T>(response);
  }

  /**
   * Make a request with automatic library filtering applied.
   * This method automatically adds library_id parameters for active libraries.
   */
  async requestWithLibraryFilter<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Parse the endpoint to extract path and existing query parameters
    const url = new URL(endpoint, 'http://localhost'); // Base doesn't matter, we just need to parse
    const path = url.pathname;
    const existingParams = url.searchParams;

    // Add library filtering if LibraryManager is initialized and has active libraries
    if (libraryManager.isInitialized()) {
      const libraryParams = libraryManager.getLibraryQueryParams();

      // Add library_id parameters (duplicate parameters as discovered from frontend)
      for (const [key, value] of libraryParams.entries()) {
        existingParams.append(key, value);
      }
    }

    // Reconstruct the endpoint with library filters
    const filteredEndpoint = existingParams.toString()
      ? `${path}?${existingParams.toString()}`
      : path;

    logger.debug(`Request with library filter: ${filteredEndpoint}`);
    return this.request<T>(filteredEndpoint, options);
  }

  /**
   * Send a Subsonic API request. Defaults to POST with auth in the body —
   * keeps the salted-MD5 secret out of URL query strings (where reverse
   * proxies and access logs would capture it). Pass `method: 'GET'` only
   * when the endpoint cannot accept POST (rare; Navidrome's Subsonic
   * implementation accepts POST for everything we use).
   */
  async subsonicRequest(
    endpoint: string,
    params: Record<string, string> = {},
    options: { method?: 'GET' | 'POST' } = {},
  ): Promise<unknown> {
    this.assertSafeEndpoint(endpoint);
    const method = options.method ?? 'POST';
    const authParams = buildSubsonicAuthParams(
      this.config.navidromeUsername,
      this.config.navidromePassword,
      params,
    );

    const url = `${this.baseUrl}/rest${endpoint}`;
    const response = method === 'POST'
      ? await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: authParams.toString(),
        })
      : await fetch(`${url}?${authParams.toString()}`);

    if (!response.ok) {
      throw new Error(ErrorFormatter.subsonicApi(response));
    }

    const data = await response.json() as { 'subsonic-response'?: { status?: string; error?: { message?: string } } };

    if (data['subsonic-response']?.status !== 'ok') {
      throw new Error(ErrorFormatter.subsonicResponse(data['subsonic-response']?.error?.message));
    }

    return data['subsonic-response'];
  }

  /**
   * Reject endpoints that could escape the `/api` path or hit a different
   * host. Tools build endpoints from constants + interpolated IDs, so an
   * endpoint with `..` segments or an absolute URL is always a bug —
   * either a loose schema or a hand-built string that bypassed validation.
   */
  private assertSafeEndpoint(endpoint: string): void {
    if (endpoint.includes('..')) {
      throw new Error('Endpoint must not contain path-traversal segments');
    }
    if (/^https?:\/\//i.test(endpoint)) {
      throw new Error('Endpoint must be a path, not an absolute URL');
    }
  }

  private async doFetch(endpoint: string, options: RequestInit): Promise<Response> {
    const token = await this.authManager.getToken();

    const defaultHeaders: Record<string, string> = {
      'X-ND-Authorization': `Bearer ${token}`,
    };

    // Only set Content-Type for non-GET requests
    if (options.method !== null && options.method !== undefined && options.method !== 'GET') {
      defaultHeaders['Content-Type'] = 'application/json';
    }

    return fetch(`${this.baseUrl}/api${endpoint}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(ErrorFormatter.httpRequest('navidrome API', response, errorText));
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json') === true) {
      return response.json() as Promise<T>;
    }

    // Navidrome's POST /playlist/{id}/tracks (and /song/{id}/playlists) return
    // JSON bodies with `Content-Type: text/plain`. Sniff the body and parse as
    // JSON if it looks like one — otherwise fall back to text (legitimately
    // used by M3U export, etc.).
    const text = await response.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(text) as T;
      } catch {
        // Body looked like JSON but didn't parse — fall through to text.
      }
    }
    return text as T;
  }
}
