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
import {
  fetchWithTimeout,
  getNavidromeRequestTimeoutMs,
  type RetryPolicy,
} from '../utils/fetch-with-timeout.js';

// Only these resources take an item ID as their second path segment, so only they can name the missing item.
const ITEM_RESOURCE_NAMES: Readonly<Record<string, string>> = {
  song: 'Song',
  album: 'Album',
  artist: 'Artist',
  playlist: 'Playlist',
};

function itemFromEndpoint(endpoint: string): { resource: string; id: string } | null {
  const [, resourceSegment, idSegment] = (endpoint.split('?')[0] ?? '').split('/');
  const resource = resourceSegment === undefined ? undefined : ITEM_RESOURCE_NAMES[resourceSegment];
  if (resource === undefined || idSegment === undefined || idSegment === '') return null;
  return { resource, id: decodeURIComponent(idSegment) };
}

/** A request for an item Navidrome does not hold, so the caller's ID is probably wrong. */
export class NavidromeNotFoundError extends Error {
  constructor(label: string, endpoint: string) {
    const item = itemFromEndpoint(endpoint);
    super(item === null ? `${label} found no item. The ID is probably wrong.` : ErrorFormatter.notFound(item.resource, item.id));
    this.name = 'NavidromeNotFoundError';
  }
}

// Navidrome answers a missing item with 404, or with 400 or 500 and this body, which reads as a server outage.
const MISSING_ITEM_ERROR_BODY = 'data not found';

function isMissingItemResponse(status: number, errorText: string): boolean {
  if (status === 404) {
    return true;
  }
  if (status !== 400 && status !== 500) {
    return false;
  }
  if (errorText.trim() === MISSING_ITEM_ERROR_BODY) {
    return true;
  }
  try {
    const body: unknown = JSON.parse(errorText);
    return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === MISSING_ITEM_ERROR_BODY;
  } catch {
    return false;
  }
}

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
   * Public accessor for the current (cached or freshly-authenticated) JWT.
   *
   * Exposed so services like `LibraryManager` can decode user-scoped claims
   * (`uid`, etc.) without reaching into the private `authManager` field via
   * an `as unknown as` cast — that pattern silently breaks when fields are
   * renamed. Single-flight refresh + retry-on-401 still funnel through
   * AuthManager, so callers don't need to think about token freshness.
   */
  async getCurrentToken(): Promise<string> {
    return this.authManager.getToken();
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
    let token = await this.authManager.getToken();
    let response = await this.doFetch(endpoint, options, token);
    if (response.status === 401) {
      // Token rejected, so invalidate the cache and retry exactly once with a
      // fresh authenticate(). If the second attempt also returns 401, fall
      // through to parseResponse which throws the standard HTTP error.
      logger.debug('Got 401 from Navidrome; invalidating token and retrying once');
      this.authManager.invalidate(token);
      // Drain the discarded 401 body so undici can return the socket to the
      // keep-alive pool immediately instead of holding it until GC.
      await response.body?.cancel().catch(() => undefined);
      token = await this.authManager.getToken();
      response = await this.doFetch(endpoint, options, token);
    }
    // Read X-Total-Count alongside the body. Header / body streams are
    // independent so order doesn't matter, but reading first matches the
    // data flow. Number.parseInt loses precision above 2^53 — not a real
    // concern for music libraries (largest known Navidrome instance is in
    // the low millions).
    const totalHeader = response.headers.get('x-total-count');
    const parsed = totalHeader !== null ? Number.parseInt(totalHeader, 10) : NaN;
    const total = Number.isFinite(parsed) ? parsed : null;
    const method = options.method ?? 'GET';
    const data = await this.parseResponse<T>(response, method, endpoint);
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
    // Validate the RAW endpoint before buildLibraryFilteredEndpoint runs it
    // through `new URL()`, which collapses `..`/`%2e%2e` dot-segments and would
    // otherwise hide traversal from requestWithMeta's downstream guard.
    this.assertSafeEndpoint(endpoint);
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
   * Send a Subsonic API request as a POST with auth in the body, which keeps
   * the salted-MD5 secret out of URL query strings (where reverse proxies and
   * access logs would capture it).
   */
  async subsonicRequest(
    endpoint: string,
    params: Record<string, string> = {},
    options: { retryPolicy?: RetryPolicy } = {},
  ): Promise<unknown> {
    this.assertSafeEndpoint(endpoint);
    const authParams = buildSubsonicAuthParams(
      this.config.navidromeUsername,
      this.config.navidromePassword,
      params,
    );

    // Most Subsonic calls (star, setRating, now-playing scrobble) are idempotent, so 'safe' is the default.
    // Station create and delete and scrobble submission pass 'never', since a resend would double-apply.
    const retryPolicy = options.retryPolicy ?? 'safe';
    const response = await fetchWithTimeout(
      `${this.baseUrl}/rest${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: authParams.toString(),
      },
      {
        timeoutMs: getNavidromeRequestTimeoutMs(),
        retryPolicy,
        operationLabel: `Navidrome Subsonic ${endpoint}`,
        nonIdempotent: retryPolicy === 'never',
      },
    );

    if (!response.ok) {
      throw new Error(ErrorFormatter.subsonicApi(endpoint, response));
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(ErrorFormatter.subsonicResponse('invalid JSON in Subsonic response'));
    }

    if (data === null || typeof data !== 'object') {
      // 200 OK but the body was a non-object (literal `null`, etc.) from a
      // misbehaving proxy — guard before indexing so the failure carries
      // Subsonic context instead of a native TypeError.
      throw new Error(ErrorFormatter.subsonicResponse('unexpected Subsonic response shape'));
    }

    const body = (data as { 'subsonic-response'?: { status?: string; error?: { message?: string } } })['subsonic-response'];
    if (body?.status !== 'ok') {
      throw new Error(ErrorFormatter.subsonicResponse(body?.error?.message));
    }

    return body;
  }

  /**
   * Reject endpoints that could escape the `/api` path or hit a different
   * host. Tools build endpoints from constants + interpolated IDs, so an
   * endpoint with `..` segments or an absolute URL is always a bug, either a
   * loose schema or a hand-built string that bypassed validation. The
   * traversal check covers the path component only, since a query string
   * cannot traverse and legitimately carries text such as an ellipsis.
   */
  private assertSafeEndpoint(endpoint: string): void {
    const queryStart = endpoint.indexOf('?');
    const path = queryStart === -1 ? endpoint : endpoint.slice(0, queryStart);
    if (path.includes('..')) {
      throw new Error('Endpoint must not contain path-traversal segments');
    }
    // Node normalizes URL-encoded traversal (`%2e%2e`) back to `..`, so decode
    // and re-check. A malformed escape sequence is itself suspect.
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      throw new Error('Endpoint contains a malformed percent-encoding sequence');
    }
    if (decoded.includes('..')) {
      throw new Error('Endpoint must not contain path-traversal segments');
    }
    if (/^https?:\/\//i.test(endpoint)) {
      throw new Error('Endpoint must be a path, not an absolute URL');
    }
  }

  private async doFetch(endpoint: string, options: RequestInit, token: string): Promise<Response> {
    const defaultHeaders: Record<string, string> = {
      'X-ND-Authorization': `Bearer ${token}`,
    };

    // Only set Content-Type for non-GET requests
    if (options.method !== undefined && options.method !== 'GET') {
      defaultHeaders['Content-Type'] = 'application/json';
    }

    // Only retry idempotent methods. POST/PUT/DELETE may have side effects
    // even on timeout (the server might have applied the mutation just before
    // the connection dropped) — surfacing the timeout to the LLM is safer
    // than risking a double-apply (e.g. adding the same tracks to a playlist
    // twice). GET and HEAD are spec-idempotent; an undefined method defaults
    // to GET in fetch().
    const method = options.method ?? 'GET';
    const isIdempotent = method === 'GET' || method === 'HEAD';

    // RequestInit.headers is HeadersInit, which can be a Headers instance, a
    // [k, v][] tuple array, or a plain object. Object-spreading a Headers
    // instance yields `{}` and silently drops the caller's headers, so merge
    // via the Headers API to preserve every form. Caller headers win on
    // collision (last write).
    const merged = new Headers(defaultHeaders);
    if (options.headers !== undefined) {
      new Headers(options.headers).forEach((value, key) => {
        merged.set(key, value);
      });
    }

    return fetchWithTimeout(
      `${this.baseUrl}/api${endpoint}`,
      {
        ...options,
        headers: merged,
      },
      {
        timeoutMs: getNavidromeRequestTimeoutMs(),
        retryPolicy: isIdempotent ? 'safe' : 'never',
        operationLabel: `Navidrome ${method} ${endpoint}`,
        nonIdempotent: !isIdempotent,
      },
    );
  }

  private async parseResponse<T>(response: Response, method: string, endpoint: string): Promise<T> {
    const label = `Navidrome ${method} ${endpoint}`;
    if (!response.ok) {
      // Cap the raw error body before it flows to the LLM via toolExecution: a
      // proxy's large HTML 5xx page (server version/OS/path info) or a 4xx body
      // referencing internal paths would otherwise reach the context unbounded.
      const errorText = (await response.text()).slice(0, 512);
      // A write to a path that names no item, such as POST /playlist, answers 404 for a wrong route, not a wrong ID.
      const namesItem = method === 'GET' || itemFromEndpoint(endpoint) !== null;
      if (namesItem && isMissingItemResponse(response.status, errorText)) {
        throw new NavidromeNotFoundError(label, endpoint);
      }
      throw new Error(ErrorFormatter.httpRequest(label, response, errorText));
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json') === true) {
      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(ErrorFormatter.httpRequest(label, response, 'invalid JSON in response body'));
      }
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
        // The body looked like JSON but didn't parse, so fall through to text.
      }
    }
    // The cast is sound only when T is string or unknown, for callers that want
    // a raw text/plain body such as M3U export.
    return text as T;
  }
}
