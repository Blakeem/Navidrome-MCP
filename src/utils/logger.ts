/**
 * Navidrome MCP Server - Logger Utility
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

import { sanitizeFilename } from './sanitize-url.js';

// Strings larger than this are truncated before regex passes to avoid O(n)
// backtracking on megabyte-scale blobs. 50KB is generous for any realistic
// log argument (stack traces, JSON payloads, config dumps).
const MAX_REDACT_STRING_BYTES = 50_000;

// Maximum object depth to recurse into. Beyond this, the subtree is returned
// as-is — we assume deeply-nested structures don't carry credential leaves.
const MAX_REDACT_DEPTH = 5;

// ---- Redaction patterns (applied in order, all global + case-insensitive) ----

// 1a. Authorization / X-ND-Authorization header in serialized form:
//       "Authorization: Bearer <token>" or "Authorization= Bearer <token>"
const RE_BEARER_HEADER = /(Authorization|X-ND-Authorization)\s*[:=]\s*Bearer\s+\S+/gi;

// 1b. Bare "Bearer <token>" value — catches object values like
//       { 'X-ND-Authorization': 'Bearer nd.token.secretvalue99' }
//     where the key name is already gone by the time we see the string leaf.
//     Requires at least 10 chars after "Bearer " to avoid false positives on
//     the word "Bearer" appearing in prose.
const RE_BEARER_VALUE = /\bBearer\s+\S{10,}/gi;

// 2. Password fields — covers JSON ("password": "..."), single-quoted
//    (password: '...'), unquoted env-var style (password=abc), and the
//    Navidrome-specific key-name variants seen in config dumps and
//    serialized request bodies.
const RE_PASSWORD_FIELD =
  /"?(password|navidromePassword|NAVIDROME_PASSWORD|navidrome_password)"?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi;

// 3. Credentials embedded in URLs: https://user:pass@host/...
const RE_URL_USERINFO = /(https?:\/\/)[^/\s@]*:[^/\s@]*@/gi;

// 4. JWT-shaped tokens — three base64url segments (≥20 chars each).
// Deliberately loose to catch raw tokens not labelled as Authorization.
const RE_JWT =
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

// 5. API key / token / secret in env-var or JSON style:
//    api_key=abc123   api-key: "abc123"   secret: 'xyz'   apiToken=...
//    Also handles JSON-quoted key form: "apiKey":"value".
//    The value capture is bounded — `\S+` was greedy and on serialized JSON
//    like `{"apiKey":"abc","other":"x"}` it would gobble past the comma and
//    redact unrelated context. Stop at quote, comma, semicolon, brace, or
//    whitespace so we redact ONLY the value.
const RE_API_KEY =
  /"?(api[_-]?key|api[_-]?token|apiKey|apiToken|secret)"?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi;

// 6. Subsonic query-param auth on GET URLs — [?&][upst]=value
//    Covers all four Subsonic auth params: u (username), p (plaintext
//    password — legacy), s (salt), t (salted-MD5 token). Salt+token are
//    replay-credential-grade, so missing them was a real leak.
//    (sanitizeFilename handles well-formed URLs; this regex catches fragments
//    that appear inside log strings where the URL isn't parseable in isolation)
const RE_SUBSONIC_PARAMS = /([?&])[upst]=[^&\s]*/gi;

/**
 * Apply all credential-redaction regex passes to a single string.
 * If the string exceeds MAX_REDACT_STRING_BYTES it is truncated and tagged
 * so callers know it was cut (prevents runaway backtracking).
 */
function redactString(s: string): string {
  if (s.length > MAX_REDACT_STRING_BYTES) {
    return `${s.slice(0, MAX_REDACT_STRING_BYTES)} [TRUNCATED_BY_LOGGER]`;
  }

  let out = s;

  // Bearer tokens — serialized header form (e.g. "Authorization: Bearer <token>")
  out = out.replace(RE_BEARER_HEADER, '$1: Bearer <REDACTED>');
  RE_BEARER_HEADER.lastIndex = 0;

  // Bare Bearer values (e.g. object leaf "Bearer nd.token.secretvalue99")
  // Applied AFTER header form so "$1: Bearer <REDACTED>" isn't re-matched
  out = out.replace(RE_BEARER_VALUE, 'Bearer <REDACTED>');
  RE_BEARER_VALUE.lastIndex = 0;

  // Password fields (JSON-quoted key or bare-colon key) — replace only the value
  out = out.replace(RE_PASSWORD_FIELD, (match) => {
    const colonIdx = match.indexOf(':');
    return `${match.slice(0, colonIdx + 1)} "<REDACTED>"`;
  });
  RE_PASSWORD_FIELD.lastIndex = 0;

  // URL userinfo credentials
  out = out.replace(RE_URL_USERINFO, '$1<REDACTED>@');
  RE_URL_USERINFO.lastIndex = 0;

  // JWT-shaped tokens
  out = out.replace(RE_JWT, '<JWT_REDACTED>');
  RE_JWT.lastIndex = 0;

  // API key / secret hints
  out = out.replace(RE_API_KEY, '$1=<REDACTED>');
  RE_API_KEY.lastIndex = 0;

  // Subsonic auth query params in raw strings
  out = out.replace(RE_SUBSONIC_PARAMS, '$1[CREDENTIAL_REDACTED]');
  RE_SUBSONIC_PARAMS.lastIndex = 0;

  // Subsonic auth params in well-formed URLs (strips u/p/s/t params)
  if (out.includes('://')) {
    // sanitizeFilename is a no-op on non-parseable strings
    out = sanitizeFilename(out);
  }

  return out;
}

/**
 * Recursively redact credentials from any value before it is written to
 * stderr. Handles:
 * - strings (regex passes)
 * - Error objects (.message, .stack, .cause)
 * - plain objects (depth-limited key-by-key walk)
 * - arrays (per-element walk)
 * - primitives (returned unchanged)
 */
export function redact(value: unknown, depth: number = 0): unknown {
  // Primitives other than string pass through unchanged
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    return redactString(value);
  }

  // Error objects — redact message + stack + cause
  if (value instanceof Error) {
    const redacted = new Error(redactString(value.message));
    redacted.name = value.name;
    if (typeof value.stack === 'string') {
      Object.defineProperty(redacted, 'stack', {
        value: redactString(value.stack),
        configurable: true,
        writable: true,
      });
    }
    if ('cause' in value && value.cause !== undefined) {
      Object.defineProperty(redacted, 'cause', {
        value: redact(value.cause, depth + 1),
        configurable: true,
        writable: true,
      });
    }
    return redacted;
  }

  // Beyond max depth — return the subtree reference unchanged
  if (depth >= MAX_REDACT_DEPTH) return value;

  // Arrays — recurse per element
  if (Array.isArray(value)) {
    return value.map(item => redact(item, depth + 1));
  }

  // Plain objects — walk keys
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redact(val, depth + 1);
    }
    return result;
  }

  return value;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Optional alternate output. When set, formatted+redacted log records go here
 * instead of `console.error`. Used by the `navidrome-web` process, which (when
 * spawned by MCP) has its stdio ignored and must log to a file rather than the
 * (unavailable) stderr. The args passed are ALREADY redacted.
 */
type LogSink = (level: LogLevel, args: unknown[]) => void;

class Logger {
  private debugMode = false;
  private sink: LogSink | null = null;

  setDebug(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /** Redirect output to a custom sink (or pass null to restore stderr). */
  setSink(sink: LogSink | null): void {
    this.sink = sink;
  }

  private write(level: LogLevel, args: unknown[]): void {
    const redacted = args.map(a => redact(a));
    if (this.sink !== null) {
      this.sink(level, redacted);
      return;
    }
    console.error(`[${level}]`, ...redacted);
  }

  debug(...args: unknown[]): void {
    if (this.debugMode) this.write('DEBUG', args);
  }

  info(...args: unknown[]): void {
    this.write('INFO', args);
  }

  warn(...args: unknown[]): void {
    this.write('WARN', args);
  }

  error(...args: unknown[]): void {
    this.write('ERROR', args);
  }
}

export const logger = new Logger();
