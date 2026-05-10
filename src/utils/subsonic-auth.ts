/**
 * Navidrome MCP Server - Subsonic Auth Helper
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

import crypto from 'node:crypto';
import { SUBSONIC_API_VERSION, SUBSONIC_CLIENT_NAME } from '../constants/defaults.js';

/**
 * Build Subsonic auth params using salted-MD5 (`s` + `t`) — never the
 * plaintext password (`p`). Each call generates a fresh 16-byte salt.
 *
 * `extraParams` are merged on top so callers can pass endpoint-specific
 * keys (`id`, `streamUrl`, `name`, `format`, `maxBitRate`, etc.).
 *
 * Returns a URLSearchParams that can be appended to a GET URL OR passed
 * verbatim as a `application/x-www-form-urlencoded` POST body — either
 * keeps the secret out of any URL we control. POST is preferred; the
 * stream endpoint is the only place we still need GET (mpv loads URLs).
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
