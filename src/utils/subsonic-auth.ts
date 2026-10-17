/**
 * Navidrome MCP Server - Subsonic Auth Helper
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import crypto from 'node:crypto';
import { SUBSONIC_API_VERSION, SUBSONIC_CLIENT_NAME } from '../constants/defaults.js';

/**
 * Salted MD5 keeps the plaintext password (`p`) off the wire. A GET URL carries the replay-grade
 * `t` and `s` pair, so it must pass stripSubsonicAuthParams before it is logged or returned.
 */
export function buildSubsonicAuthParams(
  username: string,
  password: string,
  extraParams: Record<string, string> = {},
): URLSearchParams {
  const salt = crypto.randomBytes(16).toString('hex');
  const token = crypto.createHash('md5').update(password + salt).digest('hex');
  return new URLSearchParams({
    u: username,
    t: token,
    s: salt,
    v: SUBSONIC_API_VERSION,
    c: SUBSONIC_CLIENT_NAME,
    f: 'json',
    ...extraParams,
  });
}
