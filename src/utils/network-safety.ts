/**
 * Navidrome MCP Server - Network Safety Helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch, type Dispatcher } from 'undici';

const ALLOWED_VALIDATOR_SCHEMES: readonly string[] = ['http:', 'https:'];

/**
 * The URL parser strips tab, LF and CR, so a string holding them parses clean while callers store
 * and play the raw string with the control characters intact.
 */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * fetch can probe only http and https, though mpv also plays mms, rtsp and rtmp. Callers reject
 * other schemes up front with a clear message instead of an opaque fetch error.
 */
export function isHttpUrlScheme(url: string): boolean {
  if (hasControlChars(url)) return false;
  // The URL parser also trims surrounding spaces, so a padded string would parse but not play.
  if (url !== url.trim()) return false;
  try {
    return ALLOWED_VALIDATOR_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * This guards untrusted stream URLs against SSRF, such as a public URL that redirects to localhost.
 * Unparseable input counts as private, so callers fail closed.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (trimmed === '') return true;

  const lowerTrimmed = trimmed.toLowerCase();
  const v4Address = lowerTrimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4Address !== undefined) {
    return isPrivateOrLocalIpv4(v4Address);
  }

  // A mapped IPv4 in hex-group form, such as ::ffff:7f00:1 for 127.0.0.1, must not pass as public.
  const hexMapped = lowerTrimmed.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped !== null) {
    const hi = parseInt(hexMapped[1] ?? '', 16);
    const lo = parseInt(hexMapped[2] ?? '', 16);
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateOrLocalIpv4(dotted);
  }

  const withoutZone = trimmed.includes('%')
    ? (trimmed.split('%')[0] ?? trimmed)
    : trimmed;

  if (isIP(withoutZone) === 0) return true;
  if (withoutZone.includes(':')) return isPrivateOrLocalIpv6(withoutZone);
  return isPrivateOrLocalIpv4(withoutZone);
}

function isPrivateOrLocalIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return true;

  const a = parseOctet(parts[0]);
  const b = parseOctet(parts[1]);
  const c = parseOctet(parts[2]);
  const d = parseOctet(parts[3]);
  if (a < 0 || b < 0 || c < 0 || d < 0) return true;

  if (a === 0) return true;                                  // 0.0.0.0/8
  if (a === 10) return true;                                 // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true;         // 100.64.0.0/10 CGNAT
  if (a === 127) return true;                                // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;                   // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                   // 192.168.0.0/16
  if (a >= 224 && a <= 239) return true;                     // 224.0.0.0/4 multicast
  if (a >= 240) return true;                                 // 240.0.0.0/4 reserved + bcast

  return false;
}

function parseOctet(s: string | undefined): number {
  if (s === undefined || !/^\d{1,3}$/.test(s)) return -1;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : -1;
}

function isPrivateOrLocalIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === '::' || lower === '::1') return true;
  if (lower === '0:0:0:0:0:0:0:0' || lower === '0:0:0:0:0:0:0:1') return true;

  // fc00::/7 unique local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;

  return false;
}

/**
 * Any private record counts, since the connection may use any of them. A DNS failure throws, and
 * callers treat it as unsafe.
 */
export async function hostResolvesToPrivateIp(host: string): Promise<boolean> {
  if (host === '') return true;

  const cleaned = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;

  if (isLikelyIpLiteral(cleaned)) {
    return isPrivateOrLocalIp(cleaned);
  }

  const records = await dnsLookup(cleaned, { all: true });
  if (records.length === 0) return true;

  return records.some((r) => isPrivateOrLocalIp(r.address));
}

function isLikelyIpLiteral(host: string): boolean {
  if (host.includes(':')) return true;
  return /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * The recommendation engine matches this phrase to tell an SSRF refusal from a network failure, so
 * every refusal message uses this constant.
 */
export const PRIVATE_ADDRESS_REFUSAL = 'private/local address';

const baseConnector = buildConnector({});

/**
 * The check runs on the connected peer, not a separate DNS answer, which closes the DNS-rebinding
 * gap. DNS, Host and SNI keep the original hostname, so vhost and CDN routing still work.
 */
const privateIpBlockingDispatcher = new Agent({
  connect(options, callback): void {
    baseConnector(options, (err, socket) => {
      if (err !== null) {
        callback(err, null);
        return;
      }
      const remote = socket.remoteAddress;
      if (remote === undefined || isPrivateOrLocalIp(remote)) {
        socket.destroy();
        const where = remote !== undefined ? ` (${remote})` : '';
        callback(new Error(`Refusing connection to ${PRIVATE_ADDRESS_REFUSAL}${where}`), null);
        return;
      }
      callback(null, socket);
    });
  },
});

// Guards cause-chain walks against circular chains.
const MAX_CAUSE_DEPTH = 8;

/**
 * The recommendation engine matches this phrase, since a strict-parser rejection is deterministic
 * and a retry never helps.
 */
export const NON_STANDARD_HTTP_RESPONSE = 'server sent a non-standard HTTP/ICY response';

/** HTTPParserError is matched by name, since its `code` varies by parser failure or is unset. */
export function isHttpParserError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    if (current.name === 'HTTPParserError') return true;
    current = current.cause;
  }
  return false;
}

/**
 * undici reports every connection failure, the private-IP refusal included, as "fetch failed" with
 * the reason in a nested `cause`.
 */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error';

  let best = err.message;
  let cause: unknown = err.cause;
  // Deeper causes are more specific.
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && cause instanceof Error; depth++) {
    if (cause.message !== '') {
      best = cause.message;
    } else if (cause instanceof AggregateError) {
      // A multi-address connect failure is an AggregateError with an empty message of its own.
      const first = cause.errors.find((e): e is Error => e instanceof Error && e.message !== '');
      if (first !== undefined) best = first.message;
    }
    cause = cause.cause;
  }

  return best === '' ? 'Unknown error' : best;
}

/**
 * Node's bundled fetch rejects an external undici dispatcher. undici's RequestInit and Response are
 * separate copies of the WHATWG types, so they cast through `unknown`.
 */
export async function fetchWithDispatcher(
  url: string,
  init: RequestInit,
  dispatcher: Dispatcher,
): Promise<Response> {
  type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
  const response = await undiciFetch(url, { ...(init as unknown as UndiciInit), dispatcher });
  return response as unknown as Response;
}

/**
 * Every connection that lands on a private IP is refused, redirect hops included. The proxy is
 * skipped, since behind a proxy the peer check would see the proxy and not the target.
 */
export async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  return fetchWithDispatcher(url, init, privateIpBlockingDispatcher);
}
