/**
 * Navidrome MCP Server - URL Sanitization Helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
