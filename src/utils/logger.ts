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

// Truncation bounds the regex cost on megabyte-scale blobs.
// The passes still run on the kept prefix, since truncation is not redaction.
const MAX_REDACT_STRING_BYTES = 50_000;

// Deeper subtrees are returned as-is, on the assumption they carry no credential leaves.
const MAX_REDACT_DEPTH = 5;

const RE_BEARER_HEADER = /(Authorization|X-ND-Authorization)\s*[:=]\s*Bearer\s+\S+/gi;

// The key name is gone at a string leaf, and 10+ chars skips the word "Bearer" in prose.
const RE_BEARER_VALUE = /\bBearer\s+\S{10,}/gi;

const RE_PASSWORD_FIELD =
  /"?(password|navidromePassword|NAVIDROME_PASSWORD|navidrome_password)"?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi;

const RE_URL_USERINFO = /(https?:\/\/)[^/\s@]*:[^/\s@]*@/gi;

// The lookbehind anchors each match at a run start, so long dot-free blobs stay linear.
const RE_JWT =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

// The key match is a suffix (unanchored), so authToken and apiToken match through `token`.
const RE_API_KEY =
  /"?(api[_-]?key|token|secret)"?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi;

// Redacts the Subsonic auth params u, p, s and t anywhere in log text. Salt and token are
// replay-grade, and this regex is the logger's only Subsonic guard.
const RE_SUBSONIC_PARAMS = /([?&])[upst]=[^&\s]*/gi;

// A string leaf carries no key for redactString to match, so the walker redacts every key ending in one of these names.
const RE_SENSITIVE_KEY =
  /(password|passwd|pwd|token|secret|api[_-]?key|authorization|credentials?)$/i;

/**
 * Apply all credential-redaction regex passes to a single string.
 * Strings exceeding MAX_REDACT_STRING_BYTES are truncated first, so the
 * retained prefix is still redacted. The [TRUNCATED_BY_LOGGER] tag is
 * appended after redaction so callers still know the string was cut.
 */
function redactString(s: string): string {
  const truncated = s.length > MAX_REDACT_STRING_BYTES;
  let out = truncated ? s.slice(0, MAX_REDACT_STRING_BYTES) : s;

  out = out.replace(RE_BEARER_HEADER, '$1: Bearer <REDACTED>');

  // Runs after the header pass so its output is not re-matched.
  out = out.replace(RE_BEARER_VALUE, 'Bearer <REDACTED>');

  // Keep the key and its ':' or '=' separator so the log line keeps its context.
  out = out.replace(RE_PASSWORD_FIELD, (match) => {
    const sepIdx = match.search(/[:=]/);
    return `${match.slice(0, sepIdx + 1)} "<REDACTED>"`;
  });

  out = out.replace(RE_URL_USERINFO, '$1<REDACTED>@');

  out = out.replace(RE_JWT, '<JWT_REDACTED>');

  out = out.replace(RE_API_KEY, (match) => {
    const sepIdx = match.search(/[:=]/);
    return `${match.slice(0, sepIdx + 1)}<REDACTED>`;
  });

  out = out.replace(RE_SUBSONIC_PARAMS, '$1[CREDENTIAL_REDACTED]');

  return truncated ? `${out} [TRUNCATED_BY_LOGGER]` : out;
}

export function redact(value: unknown, depth: number = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    return redactString(value);
  }

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
      // Bound the cause-chain recursion: the Error branch sits above the
      // MAX_REDACT_DEPTH guard below, so without this an unbounded or circular
      // `.cause` chain would recurse until the V8 stack overflows.
      Object.defineProperty(redacted, 'cause', {
        value: depth + 1 < MAX_REDACT_DEPTH ? redact(value.cause, depth + 1) : value.cause,
        configurable: true,
        writable: true,
      });
    }
    return redacted;
  }

  if (depth >= MAX_REDACT_DEPTH) return value;

  if (Array.isArray(value)) {
    return value.map(item => redact(item, depth + 1));
  }

  // The generic walk below turns Date and RegExp into `{}` and binary views into
  // one key per byte, so each renders as a compact scalar instead.
  if (value instanceof Date) {
    // toISOString() throws RangeError on invalid dates.
    // The logger must never throw, least of all from inside a catch block logging an error.
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (ArrayBuffer.isView(value)) {
    return `<binary ${value.byteLength} bytes>`;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (RE_SENSITIVE_KEY.test(key)) {
        result[key] = '<REDACTED>';
      } else {
        result[key] = redact(val, depth + 1);
      }
    }
    return result;
  }

  return value;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// The spawned navidrome-web process has its stdio ignored, so it logs to a file through this
// sink. Records reach the sink already redacted.
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
