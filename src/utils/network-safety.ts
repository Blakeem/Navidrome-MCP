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

const ALLOWED_VALIDATOR_SCHEMES: readonly string[] = ['http:', 'https:'];

/**
 * True iff the URL parses and uses http:// or https:// — the only schemes
 * Node's fetch can probe. Other valid radio stream protocols (mms://,
 * rtsp://, rtmp://) are perfectly playable by mpv but cannot be validated
 * by the radio-stream validator; this helper exists so callers can fail
 * such inputs upfront with a useful message instead of letting fetch
 * throw an opaque error deep in the stack.
 */
export function isHttpUrlScheme(url: string): boolean {
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
