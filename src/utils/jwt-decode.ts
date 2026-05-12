/**
 * Navidrome MCP Server - JWT Payload Decoder
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

import { logger } from './logger.js';

/**
 * Shape of the Navidrome JWT payload (`/auth/login` token, second segment).
 * Confirmed live against Navidrome ND issuer:
 *   { sub: "<username>", uid: "<user-uuid>", iss: "ND",
 *     adm: boolean, exp: number, iat: number }
 *
 * The library list is NOT carried in the JWT — it is fetched from
 * `/api/user/{uid}` after extracting the `uid` claim.
 */
interface NavidromeJwtClaims {
  /** User UUID — the path segment for `/api/user/{uid}`. Always required. */
  uid: string;
  /** Username (subject). */
  sub?: string;
  /** Issuer — Navidrome sets this to "ND". */
  iss?: string;
  /** Admin flag. */
  adm?: boolean;
  /** Expiration (seconds since epoch). */
  exp?: number;
  /** Issued-at (seconds since epoch). */
  iat?: number;
}

/**
 * Decode a JWT payload (the middle segment) into a typed object.
 *
 * Why this exists instead of `atob(...)` + `JSON.parse(...)`:
 *
 * 1. **Base64url, not base64.** JWTs use the URL-safe alphabet (`_` and `-`
 *    in place of `/` and `+`, no `=` padding). Browser-style `atob` expects
 *    classic base64 — feeding it a base64url segment that happens to contain
 *    `_`/`-` decodes to garbage bytes. `Buffer.from(seg, 'base64url')` is
 *    Node 16+ built-in and handles the alphabet correctly.
 *
 * 2. **Defensive parse.** A truncated, mis-encoded, or non-JSON payload would
 *    throw synchronously from `JSON.parse` and crash MCP startup. We log and
 *    return `null` so the caller can fall back to "no scoping available"
 *    rather than taking the whole server down.
 *
 * 3. **Shape validation.** Even a successful parse may yield an object missing
 *    the `uid` we need. We only return claims when `uid` is a non-empty string;
 *    otherwise null. Callers get a single null-check contract.
 *
 * Returns `null` on:
 *   - malformed JWT structure (not three dot-separated segments)
 *   - empty payload segment
 *   - base64url decode failure (Buffer.from is permissive but can produce empty)
 *   - JSON.parse failure (truncated / invalid JSON)
 *   - missing or non-string `uid` claim
 *
 * Each failure is logged at error level with a clear message — diagnosis-first.
 */
export function decodeJwtPayload(token: string): NavidromeJwtClaims | null {
  // Phase 1: structural validation
  if (typeof token !== 'string' || token.length === 0) {
    logger.error('JWT decode failed: token is empty or not a string');
    return null;
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    logger.error(
      `JWT decode failed: expected 3 dot-separated segments, got ${segments.length}`,
    );
    return null;
  }

  const payloadSegment = segments[1];
  if (payloadSegment === undefined || payloadSegment === '') {
    logger.error('JWT decode failed: payload segment is empty');
    return null;
  }

  // Phase 2: base64url → utf-8
  // Buffer.from(_, 'base64url') is built-in since Node 16. It accepts both
  // padded and unpadded base64url. On invalid characters it silently produces
  // a shorter buffer rather than throwing — that gets caught by JSON.parse
  // below.
  let payloadJson: string;
  try {
    payloadJson = Buffer.from(payloadSegment, 'base64url').toString('utf8');
  } catch (error) {
    logger.error(
      'JWT decode failed: base64url decode threw — token format may have changed',
      error,
    );
    return null;
  }

  if (payloadJson.length === 0) {
    logger.error('JWT decode failed: decoded payload is empty');
    return null;
  }

  // Phase 3: guarded JSON parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    logger.error(
      'Failed to decode JWT payload — token format may have changed',
      error,
    );
    return null;
  }

  // Phase 4: shape validation
  // Defense-in-depth: reject anything that isn't a plain object with a
  // string `uid`. Callers depend on `uid` to fetch /api/user/{uid}; missing
  // or wrong type would either 404 or — worse — be coerced into a path
  // segment that hits the wrong endpoint.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.error('JWT decode failed: payload is not a plain object');
    return null;
  }

  const claims = parsed as Record<string, unknown>;
  if (typeof claims['uid'] !== 'string' || claims['uid'].length === 0) {
    logger.error('JWT decode failed: payload missing required string `uid` claim');
    return null;
  }

  // Return a typed view; we only enforce `uid` strictness here. Optional
  // fields are passed through as-is (callers that read `sub`/`exp` etc.
  // should narrow at the use site).
  const result: NavidromeJwtClaims = { uid: claims['uid'] };
  if (typeof claims['sub'] === 'string') result.sub = claims['sub'];
  if (typeof claims['iss'] === 'string') result.iss = claims['iss'];
  if (typeof claims['adm'] === 'boolean') result.adm = claims['adm'];
  if (typeof claims['exp'] === 'number') result.exp = claims['exp'];
  if (typeof claims['iat'] === 'number') result.iat = claims['iat'];

  // `sub` ends up optional in the returned shape if the source token omitted
  // it; for Navidrome it is always present, but we don't depend on it here
  // so we don't fail the decode.
  return result;
}
