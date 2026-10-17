/**
 * Navidrome MCP Server - API Client
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

// The tool-facing resources whose second path segment is an item ID, so a not-found error can
// name the item.
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

// Navidrome answers a missing item with 404, or with 400 or 500 and this body, which would
// otherwise read as a server outage.
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

  /** LibraryManager decodes user-scoped claims such as `uid` from this JWT. */
  async getCurrentToken(): Promise<string> {
    return this.authManager.getToken();
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { data } = await this.requestWithMeta<T>(endpoint, options);
    return data;
  }

  /**
   * `total` is Navidrome's X-Total-Count, the full match count across pages. It is null when the
   * header is absent or unparseable, so the caller picks the fallback.
   */
  async requestWithMeta<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<{ data: T; total: number | null }> {
    this.assertSafeEndpoint(endpoint);
    let token = await this.authManager.getToken();
    let response = await this.doFetch(endpoint, options, token);
    if (response.status === 401) {
      logger.debug('Got 401 from Navidrome; invalidating token and retrying once');
      this.authManager.invalidate(token);
      // An unread body holds its socket until GC, so the discarded 401 body is cancelled.
      await response.body?.cancel().catch(() => undefined);
      token = await this.authManager.getToken();
      response = await this.doFetch(endpoint, options, token);
    }
    const totalHeader = response.headers.get('x-total-count');
    const parsed = totalHeader !== null ? Number.parseInt(totalHeader, 10) : NaN;
    const total = Number.isFinite(parsed) ? parsed : null;
    const method = options.method ?? 'GET';
    const data = await this.parseResponse<T>(response, method, endpoint);
    return { data, total };
  }

  async requestWithLibraryFilter<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const { data } = await this.requestWithLibraryFilterAndMeta<T>(endpoint, options);
    return data;
  }

  async requestWithLibraryFilterAndMeta<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<{ data: T; total: number | null }> {
    // `new URL()` in buildLibraryFilteredEndpoint collapses `..` and `%2e%2e` segments, which
    // would hide traversal from requestWithMeta's check, so the raw endpoint is checked first.
    this.assertSafeEndpoint(endpoint);
    const filteredEndpoint = this.buildLibraryFilteredEndpoint(endpoint);
    logger.debug(`Request with library filter: ${filteredEndpoint}`);
    return this.requestWithMeta<T>(filteredEndpoint, options);
  }

  private buildLibraryFilteredEndpoint(endpoint: string): string {
    // The base is a placeholder, since only the path and query are kept.
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

  /** POST keeps the salted-MD5 auth params out of the URL, which proxies and access logs record. */
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

    // star, setRating, and the now-playing scrobble are idempotent, so 'safe' is the default.
    // Station create and delete and scrobble submission pass 'never', since a resend repeats them.
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
      throw new Error(ErrorFormatter.subsonicResponse('unexpected Subsonic response shape'));
    }

    const body = (data as { 'subsonic-response'?: { status?: string; error?: { message?: string } } })['subsonic-response'];
    if (body?.status !== 'ok') {
      throw new Error(ErrorFormatter.subsonicResponse(body?.error?.message));
    }

    return body;
  }

  /**
   * Tools build endpoints from constants and validated IDs, so `..` or an absolute URL means a
   * validation gap. Only the path is checked, since a query string cannot traverse.
   */
  private assertSafeEndpoint(endpoint: string): void {
    const queryStart = endpoint.indexOf('?');
    const path = queryStart === -1 ? endpoint : endpoint.slice(0, queryStart);
    if (path.includes('..')) {
      throw new Error('Endpoint must not contain path-traversal segments');
    }
    // The URL parser treats `%2e%2e` as `..`, so the decoded path is checked too.
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

    if (options.method !== undefined && options.method !== 'GET') {
      defaultHeaders['Content-Type'] = 'application/json';
    }

    // A timed-out write may already have applied, and a resend could add the same tracks to a
    // playlist twice, so only GET and HEAD are retried.
    const method = options.method ?? 'GET';
    const isIdempotent = method === 'GET' || method === 'HEAD';

    // Object-spreading a Headers instance yields `{}`, so the Headers API merges every HeadersInit
    // form. Caller headers win.
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
      // The error body reaches the LLM, and a proxy's HTML error page can be large.
      const errorText = (await response.text()).slice(0, 512);
      // A write to a path that names no item, such as POST /playlist, answers 404 for a wrong
      // route, not a wrong ID.
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

    // Navidrome sends some JSON bodies, such as POST /playlist/{id}/tracks and
    // GET /song/{id}/playlists, as text/plain.
    const text = await response.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(text) as T;
      } catch {
        // A body that only looks like JSON is returned as text.
      }
    }
    // The cast is sound only when T is string or unknown, as for the M3U export.
    return text as T;
  }
}
