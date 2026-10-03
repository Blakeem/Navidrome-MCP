/**
 * Navidrome MCP Server - Last.fm API Client
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

/** Last.fm's non-2xx JSON body ({"error":6,"message":"Album not found"}) names the cause the status line hides. */
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

  // All Last.fm endpoints we call are reads, so they are safe to retry on timeout.
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

  // Last.fm uses positive integers as error codes (e.g. 6 = artist not found).
  // error:0 means no error on some legacy endpoints, so it is not treated as one.
  if (typeof data['error'] === 'number' && data['error'] !== 0) {
    const message = typeof data['message'] === 'string' ? data['message'] : undefined;
    throw new Error(ErrorFormatter.lastfmResponse(message));
  }

  return data;
}

/**
 * Last.fm serves single-element containers as a bare object instead of a
 * one-element array (verified live on one-track albums), so coerce.
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

/**
 * Strip wiki HTML plus the boilerplate "Read more on Last.fm" anchor Last.fm
 * appends to every summary. Returns null when nothing readable remains.
 */
export function stripWikiHtml(html: string): string | null {
  const text = html
    .replace(/<a\s[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s*Read more on Last\.fm\.?\s*$/i, '')
    .trim();
  return text === '' ? null : text;
}
