/**
 * Navidrome MCP Server - JWT Payload Decoder
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { logger } from './logger.js';

/** The JWT carries no library list, so callers fetch it from `/api/user/{uid}`. */
interface NavidromeJwtClaims {
  uid: string;
  sub?: string;
  iss?: string;
  adm?: boolean;
  /** Seconds since the epoch. */
  exp?: number;
  /** Seconds since the epoch. */
  iat?: number;
}

/**
 * JWTs use base64url, which `atob` rejects. Every failure logs and returns null, so library scoping
 * degrades instead of throwing.
 */
export function decodeJwtPayload(token: string): NavidromeJwtClaims | null {
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

  // Buffer.from skips invalid characters instead of throwing, so a garbled segment fails below.
  const payloadJson = Buffer.from(payloadSegment, 'base64url').toString('utf8');

  if (payloadJson.length === 0) {
    logger.error('JWT decode failed: decoded payload is empty');
    return null;
  }

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

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.error('JWT decode failed: payload is not a plain object');
    return null;
  }

  const claims = parsed as Record<string, unknown>;
  if (typeof claims['uid'] !== 'string' || claims['uid'].length === 0) {
    logger.error('JWT decode failed: payload missing required string `uid` claim');
    return null;
  }

  const result: NavidromeJwtClaims = { uid: claims['uid'] };
  if (typeof claims['sub'] === 'string') result.sub = claims['sub'];
  if (typeof claims['iss'] === 'string') result.iss = claims['iss'];
  if (typeof claims['adm'] === 'boolean') result.adm = claims['adm'];
  if (typeof claims['exp'] === 'number') result.exp = claims['exp'];
  if (typeof claims['iat'] === 'number') result.iat = claims['iat'];

  return result;
}
