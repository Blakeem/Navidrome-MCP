/**
 * Navidrome MCP Server - Last.fm API Client
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Config } from '../config.js';
import { logger } from './logger.js';
import { ErrorFormatter } from './error-formatter.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from './fetch-with-timeout.js';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';

/** The Last.fm tools register only with a key, so this guard narrows the type for callers. */
export function requireLastFmApiKey(config: Config): string {
  if (config.lastFmApiKey === undefined || config.lastFmApiKey === '') {
    throw new Error(ErrorFormatter.configMissing('Last.fm', 'features.lastFmApiKey'));
  }
  return config.lastFmApiKey;
}

/**
 * Last.fm's non-2xx JSON body, such as {"error":6,"message":"Album not found"}, names the cause the
 * status line hides.
 */
function parseLastFmErrorMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    return typeof record['error'] === 'number' && typeof record['message'] === 'string' ? record['message'] : null;
  } catch {
    return null;
  }
}

export async function callLastFmApi(method: string, params: Record<string, string>, apiKey: string): Promise<Record<string, unknown>> {
  const url = new URL(LASTFM_API_BASE);
  url.searchParams.append('method', method);
  url.searchParams.append('api_key', apiKey);
  url.searchParams.append('format', 'json');

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  logger.debug(`Calling Last.fm API: ${method}`, params);

  // Every Last.fm method this server calls is a read, so a timeout is safe to retry.
  const response = await fetchWithTimeout(
    url.toString(),
    {},
    {
      timeoutMs: getExternalApiTimeoutMs(),
      retryPolicy: 'safe',
      operationLabel: `Last.fm ${method}`,
      respectProxy: true,
    },
  );

  if (!response.ok) {
    const errorMessage = parseLastFmErrorMessage(await response.text().catch(() => ''));
    throw new Error(errorMessage !== null ? ErrorFormatter.lastfmResponse(errorMessage) : ErrorFormatter.httpRequest(`Last.fm ${method}`, response));
  }

  const data = await response.json() as Record<string, unknown>;

  // Some Last.fm endpoints send `error: 0` on success, so only a nonzero code is an error.
  if (typeof data['error'] === 'number' && data['error'] !== 0) {
    const message = typeof data['message'] === 'string' ? data['message'] : undefined;
    throw new Error(ErrorFormatter.lastfmResponse(message));
  }

  return data;
}

/**
 * Last.fm sends a one-element container as a bare object instead of an array, such as the track
 * list of a one-track album.
 */
export function asLastFmArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
  }
  if (typeof value === 'object' && value !== null) {
    return [value as Record<string, unknown>];
  }
  return [];
}

/** Every Last.fm wiki summary ends with a "Read more on Last.fm" link that carries no content. */
export function stripWikiHtml(html: string): string | null {
  const text = html
    .replace(/<a\s[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s*Read more on Last\.fm\.?\s*$/i, '')
    .trim();
  return text === '' ? null : text;
}
