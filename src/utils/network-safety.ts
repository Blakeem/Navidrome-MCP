/**
 * Navidrome MCP Server - Network Safety Helpers
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

import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

const ALLOWED_VALIDATOR_SCHEMES: readonly string[] = ['http:', 'https:'];

/**
 * C0 controls and DEL. The WHATWG URL parser silently strips tab, LF and CR
 * before parsing, so `http://host/a\nHost: evil` yields a clean http: URL while
 * callers go on to store and play the ORIGINAL string, newlines intact.
 * Rejecting them here keeps "this parsed" and "this is what we hand onward"
 * the same claim.
 */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * True iff the URL parses and uses http:// or https:// — the only schemes
 * Node's fetch can probe. Other valid radio stream protocols (mms://,
 * rtsp://, rtmp://) are perfectly playable by mpv but cannot be validated
 * by the radio-stream validator; this helper exists so callers can fail
 * such inputs upfront with a useful message instead of letting fetch
 * throw an opaque error deep in the stack.
 */
export function isHttpUrlScheme(url: string): boolean {
  if (hasControlChars(url)) return false;
  try {
    return ALLOWED_VALIDATOR_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Categorize a single literal IP address as private/local. Used to gate
 * redirect-following in the radio-stream validator: a public-looking URL
 * that 302s to localhost is the surprise SSRF vector we want to block.
 *
 * Coverage:
 *  - IPv4 0/8 (this-network), 10/8 (RFC1918), 100.64/10 (CGNAT),
 *    127/8 (loopback), 169.254/16 (link-local; includes the cloud
 *    metadata IP 169.254.169.254), 172.16/12 (RFC1918), 192.168/16
 *    (RFC1918), 224/4 (multicast), 240/4 (reserved + 255.255.255.255).
 *  - IPv6 ::1 / ::, fc00::/7 (unique local), fe80::/10 (link-local).
 *  - IPv4-mapped IPv6 (::ffff:a.b.c.d) is unwrapped and re-evaluated.
 *
 * Returns true (i.e. "treat as unsafe") for unparseable input — callers
 * use this to fail closed.
 */
export function isPrivateOrLocalIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (trimmed === '') return true;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d): pull out the IPv4 and re-check.
  const lowerTrimmed = trimmed.toLowerCase();
  const v4Address = lowerTrimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4Address !== undefined) {
    return isPrivateOrLocalIpv4(v4Address);
  }

  // IPv4-mapped IPv6 in hex-group form (::ffff:7f00:1 == 127.0.0.1,
  // ::ffff:a9fe:a9fe == 169.254.169.254): reassemble the embedded 32 bits into
  // a dotted-quad and re-check, so these don't slip past as "public" (SSRF gap).
  const hexMapped = lowerTrimmed.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped !== null) {
    const hi = parseInt(hexMapped[1] ?? '', 16);
    const lo = parseInt(hexMapped[2] ?? '', 16);
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateOrLocalIpv4(dotted);
  }

  // Strip IPv6 zone id (fe80::1%eth0) before classification.
  const withoutZone = trimmed.includes('%')
    ? (trimmed.split('%')[0] ?? trimmed)
    : trimmed;

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

  // fc00::/7 unique local (fc00–fdff)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // fe80::/10 link-local (fe80–febf)
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;

  return false;
}

/**
 * Resolve a hostname (or pass-through an IP literal) and return true if
 * any resolved address is in a private/local range. Throws on DNS
 * failure — callers should treat that as "unsafe to follow."
 *
 * Bracketed IPv6 hosts (`[::1]`) and IPv4 literals bypass DNS.
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
 * Marker phrase shared by every private/local refusal message (the dispatcher
 * below and the validator's redirect gate). The recommendation engine matches
 * on it to distinguish a deliberate SSRF refusal from a network hiccup — keep
 * all producers and consumers on this constant so a reword can't silently
 * break that detection.
 */
export const PRIVATE_ADDRESS_REFUSAL = 'private/local address';

// The plain connector with no address check, wrapped by privateIpBlockingDispatcher.
const baseConnector = buildConnector({});

/**
 * Dispatcher that connects normally (so DNS resolution, the Host header, and
 * TLS SNI all use the original hostname, with no IP pinning, so vhost/CDN
 * routing is unaffected) and then inspects the ACTUAL peer the socket
 * connected to. If that address is private/local the socket is destroyed
 * before any request bytes are written.
 *
 * This closes the DNS-rebinding TOCTOU that a pre-fetch `hostResolvesToPrivateIp`
 * check cannot: the pre-check and `fetch()` resolve DNS independently, so a
 * short-TTL domain can answer "public" for the check and "private" for the
 * connection. Here the address we validate IS the address we're connected to,
 * so there is no window between the two.
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
 * Marker phrase for a response undici's strict parser rejected. The recommendation engine
 * matches on it, since that failure is deterministic and a retry never helps.
 */
export const NON_STANDARD_HTTP_RESPONSE = 'server sent a non-standard HTTP/ICY response';

/** True when the cause chain holds undici's HTTPParserError, which carries no `code` to match on. */
export function isHttpParserError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current instanceof Error; depth++) {
    if (current.name === 'HTTPParserError') return true;
    current = current.cause;
  }
  return false;
}

/**
 * Best human-readable message for a failed fetch. undici wraps every
 * connection-level failure — including the private-IP refusal from the
 * dispatcher above — in a generic `TypeError: fetch failed` whose real reason
 * lives in `.cause` (sometimes nested; multi-address connect failures arrive
 * as an AggregateError with an empty message of its own). Callers surfacing
 * fetch errors to users should report this instead of `err.message`, so
 * "Refusing connection to private/local address (127.0.0.1)" or
 * "getaddrinfo ENOTFOUND host" isn't flattened to "fetch failed".
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
      const first = cause.errors.find((e): e is Error => e instanceof Error && e.message !== '');
      if (first !== undefined) best = first.message;
    }
    cause = cause.cause;
  }

  return best === '' ? 'Unknown error' : best;
}

/**
 * `fetch` for UNTRUSTED outbound URLs (radio-stream validation/discovery).
 * Identical to global fetch except every connection — the initial request AND
 * every redirect hop — is refused if it lands on a private/local IP, defeating
 * SSRF via redirects or DNS rebinding. Callers still get a standard `Response`,
 * so no downstream code changes.
 *
 * Deliberately stays off the HTTP_PROXY path that `fetchWithTimeout`'s
 * `respectProxy` option takes. Behind a proxy the socket peer is the proxy, so
 * the connector below would validate the proxy's address instead of the target's
 * and the SSRF guard would pass everything. Untrusted URLs are unreachable on a
 * proxy-only host as a result, which is the safe side of that trade.
 */
export async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  // Use undici's OWN fetch: Node's bundled fetch rejects an externally-installed
  // undici dispatcher (version-skewed internals). undici's RequestInit/Response
  // and the global (undici-types) ones are the same WHATWG shape but nominally
  // distinct copies, so the boundary is bridged through `unknown`; the only
  // fields we pass (method/headers/signal/redirect) are identical in both. A
  // rebinding/redirect refusal surfaces as a rejected fetch whose `.cause` is
  // the connector Error above.
  type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
  const response = await undiciFetch(url, {
    ...(init as unknown as UndiciInit),
    dispatcher: privateIpBlockingDispatcher,
  });
  return response as unknown as Response;
}
