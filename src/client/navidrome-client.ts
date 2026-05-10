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

  /**
   * Body-only request — thin wrapper over `requestWithMeta` that discards
   * the X-Total-Count value. Use this for single-resource fetches and any
   * endpoint where the caller doesn't need the total.
   */
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { data } = await this.requestWithMeta<T>(endpoint, options);
    return data;
  }

  /**
   * Like `request<T>()` but also surfaces the parsed `X-Total-Count` header
   * (Navidrome's listing endpoints expose this in `Access-Control-Expose-Headers`
   * and use it to communicate the full match count vs. the page-sized body).
   *
   * Returns `total: null` when the header is absent or unparseable — the caller
   * is responsible for choosing a fallback (typically `items.length`). Subsonic
   * endpoints don't emit this header at all; use `subsonicRequest` for those.
   */
  async requestWithMeta<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<{ data: T; total: number | null }> {
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
    // Read X-Total-Count alongside the body. Header / body streams are
    // independent so order doesn't matter, but reading first matches the
    // data flow. Number.parseInt loses precision above 2^53 — not a real
    // concern for music libraries (largest known Navidrome instance is in
    // the low millions).
    const totalHeader = response.headers.get('x-total-count');
    const parsed = totalHeader !== null ? Number.parseInt(totalHeader, 10) : NaN;
    const total = Number.isFinite(parsed) ? parsed : null;
    const data = await this.parseResponse<T>(response);
    return { data, total };
  }

  /**
   * Make a request with automatic library filtering applied. Body-only —
   * thin wrapper over `requestWithLibraryFilterAndMeta` that discards the
   * X-Total-Count value.
   */
  async requestWithLibraryFilter<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { data } = await this.requestWithLibraryFilterAndMeta<T>(endpoint, options);
    return data;
  }

  /**
   * Like `requestWithLibraryFilter<T>()` but also surfaces X-Total-Count.
   * Use this for any tool that paginates and needs to report the real total
   * (vs. the page size) back to the LLM.
   */
  async requestWithLibraryFilterAndMeta<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<{ data: T; total: number | null }> {
    const filteredEndpoint = this.buildLibraryFilteredEndpoint(endpoint);
    logger.debug(`Request with library filter: ${filteredEndpoint}`);
    return this.requestWithMeta<T>(filteredEndpoint, options);
  }

  /**
   * Append `library_id` query params for each active library (the frontend
   * convention is to repeat the param rather than send a comma-joined list).
   * Returns the path verbatim if no libraries are active.
   */
  private buildLibraryFilteredEndpoint(endpoint: string): string {
    // Base doesn't matter — only parsing the path + query.
    const url = new URL(endpoint, 'http://localhost');
    const path = url.pathname;
    const existingParams = url.searchParams;

    if (libraryManager.isInitialized()) {
      const libraryParams = libraryManager.getLibraryQueryParams();
      for (const [key, value] of libraryParams.entries()) {
        existingParams.append(key, value);
      }
    }

    return existingParams.toString() ? `${path}?${existingParams.toString()}` : path;
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
