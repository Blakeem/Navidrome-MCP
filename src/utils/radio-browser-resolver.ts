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

/**
 * Resolves a working Radio Browser API base URL via SRV record lookup.
 *
 * Per Radio Browser docs (https://api.radio-browser.info/), the canonical way
 * to find a live mirror is to resolve the `_api._tcp.radio-browser.info` SRV
 * record and pick one randomly. Hardcoding `de1.api.radio-browser.info` makes
 * us dependent on a single upstream — when `de1` is in maintenance every
 * radio-discovery tool fails.
 *
 * Strategy:
 *   1. If RADIO_BROWSER_BASE env var was explicitly set (i.e. the user picked
 *      a specific mirror) → respect that override, never hit DNS.
 *   2. Otherwise, lazily resolve the SRV record and cache the picked host
 *      for the rest of the process lifetime (1 hour TTL, refreshed on miss).
 *   3. If SRV lookup fails (DNS issues, sandboxed env, etc.) → fall back to
 *      the historical hardcoded `de1.api.radio-browser.info` so we don't
 *      take down radio discovery just because DNS is broken.
 *
 * The result is a plain `https://<host>` base URL — Radio Browser API runs
 * on standard HTTPS port 443 across every mirror, so the SRV port field is
 * informational only.
 */

import { resolveSrv } from 'node:dns/promises';
import { logger } from './logger.js';

/** Hardcoded fallback when SRV resolution fails. Matches old behavior. */
export const RADIO_BROWSER_FALLBACK_BASE = 'https://de1.api.radio-browser.info';

/** SRV record name documented by Radio Browser. */
const SRV_NAME = '_api._tcp.radio-browser.info';

/** Cache TTL — 1 hour. Mirrors don't churn often, refresh after this. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  base: string;
  expiresAt: number;
}

let cached: CacheEntry | null = null;
let inflight: Promise<string> | null = null;
// Bumped by every invalidation. A resolution captures the generation it started
// under and only writes to `cached` if the generation still matches — so an
// invalidation that races an in-flight resolution wins.
let cacheGeneration = 0;

/**
 * Reset cached state. Test-only — never called from production code.
 */
export function resetRadioBrowserResolverCache(): void {
  cached = null;
  inflight = null;
  cacheGeneration = 0;
}

/**
 * Drop the cached mirror so the next `getRadioBrowserBase()` call re-resolves
 * via SRV. Call from production caller error paths when a request fails in a
 * way that suggests the mirror is unhealthy (network errors, 5xx, timeouts).
 * Without this, a mirror that goes into maintenance immediately after caching
 * stays the active pick for up to CACHE_TTL_MS — so every subsequent radio
 * tool call fails for the rest of the cache window. Idempotent and cheap.
 *
 * Also drops any in-flight SRV resolution and bumps a generation token: without
 * the token, a resolution started by a concurrent call would complete after
 * invalidation and re-cache its (now stale) result with a fresh 1h TTL,
 * silently undoing the invalidation. The bumped generation makes that late
 * resolution's cache write a no-op. Clearing `inflight` also forces the next
 * getRadioBrowserBase() to start a fresh resolution. A caller already holding
 * the in-flight promise reference still receives its result.
 */
export function invalidateRadioBrowserBase(): void {
  cached = null;
  inflight = null;
  cacheGeneration += 1;
}

/**
 * Returns a Radio Browser API base URL.
 *
 * @param override - If provided (e.g., user set RADIO_BROWSER_BASE), bypass
 *   SRV resolution entirely and return this value. Lets users pin a specific
 *   mirror for compliance / debugging without DNS round-trips.
 */
export async function getRadioBrowserBase(override?: string): Promise<string> {
  if (override !== undefined && override !== '') {
    return override;
  }

  // Cache hit: return immediately.
  if (cached !== null && cached.expiresAt > Date.now()) {
    return cached.base;
  }

  // In-flight dedup: a parallel call already started resolving; reuse its promise.
  if (inflight !== null) {
    return inflight;
  }

  // Snapshot the generation this resolution starts under; if an invalidation
  // bumps it mid-flight, the writes below become no-ops so we don't re-cache a
  // mirror that was just invalidated.
  const gen = cacheGeneration;
  inflight = resolveBaseFromSrv()
    .then((base) => {
      if (gen === cacheGeneration) {
        cached = { base, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      return base;
    })
    .catch((error: unknown) => {
      // Only DNS failures land here — resolveBaseFromSrv() catches its own
      // errors and returns the fallback. This catch is belt-and-suspenders
      // for unexpected resolver bugs; cache the fallback briefly so we don't
      // hammer DNS on every call when something is very wrong.
      logger.warn('Radio Browser SRV resolution threw unexpectedly; using fallback', error);
      if (gen === cacheGeneration) {
        cached = { base: RADIO_BROWSER_FALLBACK_BASE, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      return RADIO_BROWSER_FALLBACK_BASE;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

async function resolveBaseFromSrv(): Promise<string> {
  try {
    const records = await resolveSrv(SRV_NAME);
    if (records.length === 0) {
      logger.debug(`SRV ${SRV_NAME} returned no records, using fallback`);
      return RADIO_BROWSER_FALLBACK_BASE;
    }

    // Pick uniformly at random. Radio Browser docs note all mirrors are
    // equivalent, so RFC 2782 priority/weight selection is over-engineering.
    const picked = records[Math.floor(Math.random() * records.length)];
    if (picked === undefined) {
      // Defensive — Math.random()*length is always a valid index when length>0.
      return RADIO_BROWSER_FALLBACK_BASE;
    }

    // Strip trailing dot if DNS resolver returned the FQDN form.
    const host = picked.name.replace(/\.$/, '');
    return `https://${host}`;
  } catch (error: unknown) {
    // DNS lookup failed entirely (no network, sandboxed env, broken DNS).
    // Log at debug — this is recoverable and we don't want to spam logs.
    logger.debug('Radio Browser SRV lookup failed, using fallback', error);
    return RADIO_BROWSER_FALLBACK_BASE;
  }
}
