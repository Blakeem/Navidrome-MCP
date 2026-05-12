/**
 * Navidrome MCP Server - URL Sanitization Helpers
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

const SUBSONIC_AUTH_PARAMS = ['u', 'p', 's', 't'] as const;

/**
 * Strip Subsonic auth params (`u`, `p`, `s`, `t`) from a URL before exposing
 * it to consumers we don't fully trust — specifically the LLM transcript via
 * tool responses. The MCP server's stream URLs sent to mpv may contain
 * salted-MD5 auth (or, in legacy paths, plaintext password) which has no
 * business reaching the LLM context window.
 *
 * Returns the input verbatim if it isn't a parseable URL or doesn't carry
 * any of the auth params (no allocation in the hot path).
 */
export function sanitizeFilename(rawUrl: string): string {
  if (rawUrl === '') return rawUrl;
  try {
    const u = new URL(rawUrl);
    let mutated = false;
    for (const key of SUBSONIC_AUTH_PARAMS) {
      if (u.searchParams.has(key)) {
        u.searchParams.delete(key);
        mutated = true;
      }
    }
    return mutated ? u.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}
