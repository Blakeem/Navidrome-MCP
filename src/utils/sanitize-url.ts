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

// Stream URLs carry replay-grade Subsonic auth (u, p, s, t) that must not reach the LLM transcript.
export function stripSubsonicAuthParams(rawUrl: string): string {
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

// mpv's filename fallback is the URL basename, which has no scheme for URL to parse.
export function hasSubsonicAuthParams(value: string): boolean {
  const queryStart = value.indexOf('?');
  if (queryStart === -1) return false;
  const params = new URLSearchParams(value.slice(queryStart + 1));
  return SUBSONIC_AUTH_PARAMS.some((key) => params.has(key));
}
