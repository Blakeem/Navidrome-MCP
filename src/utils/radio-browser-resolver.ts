/**
 * Navidrome MCP Server - Radio Browser Mirror Resolver
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

// Resolves a Radio Browser mirror from the `_api._tcp.radio-browser.info` SRV record, unless settings.json
// `features.radioBrowserBase` pins one. An SRV failure caches RADIO_BROWSER_FALLBACK_BASE for CACHE_TTL_MS until a request failure invalidates it.

import { resolveSrv } from 'node:dns/promises';
import { logger } from './logger.js';

/** Mirror used when SRV resolution fails. */
export const RADIO_BROWSER_FALLBACK_BASE = 'https://de1.api.radio-browser.info';

const SRV_NAME = '_api._tcp.radio-browser.info';

// Mirrors rarely churn, so a picked mirror is kept for an hour.
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  base: string;
  expiresAt: number;
}

let cached: CacheEntry | null = null;
let inflight: Promise<string> | null = null;
// Bumped by every invalidation. A resolution writes `cached` only while its starting
// generation still matches, so an invalidation that races it wins.
let cacheGeneration = 0;

/** Test-only reset of the cached state. */
export function resetRadioBrowserResolverCache(): void {
  cached = null;
  inflight = null;
  cacheGeneration = 0;
}

/**
 * Drop the cached mirror and any in-flight resolution so the next call re-resolves.
 * Callers invoke it when a request fails in a way that suggests an unhealthy mirror.
 */
export function invalidateRadioBrowserBase(): void {
  cached = null;
  inflight = null;
  cacheGeneration += 1;
}

/**
 * Returns a Radio Browser API base URL with no trailing slash.
 *
 * @param override - settings.json `features.radioBrowserBase`. A non-empty value skips SRV resolution.
 */
export async function getRadioBrowserBase(override?: string): Promise<string> {
  if (override !== undefined && override !== '') {
    // Call sites append `/json/...`, and a doubled slash makes Radio Browser answer 404.
    return override.replace(/\/+$/, '');
  }

  if (cached !== null && cached.expiresAt > Date.now()) {
    return cached.base;
  }

  if (inflight !== null) {
    return inflight;
  }

  const gen = cacheGeneration;
  const resolution = resolveBaseFromSrv()
    .then((base) => {
      if (gen === cacheGeneration) {
        cached = { base, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      return base;
    })
    .finally(() => {
      // A newer resolution may own `inflight` after an invalidation, so only this chain's own slot is cleared.
      if (inflight === resolution) {
        inflight = null;
      }
    });
  inflight = resolution;

  return resolution;
}

async function resolveBaseFromSrv(): Promise<string> {
  try {
    const records = await resolveSrv(SRV_NAME);
    if (records.length === 0) {
      logger.debug(`SRV ${SRV_NAME} returned no records, using fallback`);
      return RADIO_BROWSER_FALLBACK_BASE;
    }

    // Radio Browser documents every mirror as equivalent, so RFC 2782 priority and weight are ignored.
    const picked = records[Math.floor(Math.random() * records.length)];
    if (picked === undefined) {
      return RADIO_BROWSER_FALLBACK_BASE;
    }

    // DNS can return the FQDN form with a trailing dot.
    const host = picked.name.replace(/\.$/, '');
    return `https://${host}`;
  } catch (error: unknown) {
    // No network or broken DNS is recoverable, so it logs at debug.
    logger.debug('Radio Browser SRV lookup failed, using fallback', error);
    return RADIO_BROWSER_FALLBACK_BASE;
  }
}
