/**
 * Navidrome MCP Server - Radio Browser Mirror Resolver
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Radio Browser publishes its mirrors as SRV records. A failed lookup caches the fallback mirror
// for CACHE_TTL_MS like any other pick, until a request failure invalidates it.

import { resolveSrv } from 'node:dns/promises';
import { logger } from './logger.js';

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

export function resetRadioBrowserResolverCacheForTests(): void {
  cached = null;
  inflight = null;
  cacheGeneration = 0;
}

/**
 * Only a failure against the cached mirror drops it, so a late failure against an older mirror
 * keeps a newer one.
 */
export function invalidateRadioBrowserBase(failedBase: string): void {
  if (cached === null || cached.base !== failedBase) return;
  cached = null;
  inflight = null;
  cacheGeneration += 1;
}

/**
 * @param override - settings.json `features.radioBrowserBase`. A non-empty value skips SRV lookup.
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
      // After an invalidation a newer resolution may own `inflight`, so only this chain's clears.
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

    // Radio Browser documents every mirror as equal, so RFC 2782 priority and weight are ignored.
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
