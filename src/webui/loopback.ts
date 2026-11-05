/**
 * Navidrome MCP Server - Loopback peer guard
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { hostname as osHostname } from 'node:os';
import { classifySource } from './source-address.js';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

// A same-host reverse proxy or tunnel connects from loopback, and these headers are its only trace.
const PROXY_FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'];

export function isLoopbackPeer(req: IncomingMessage): boolean {
  return classifySource(req.socket.remoteAddress) === 'loopback';
}

// The port is ignored, since a client omits a default port such as 80 and DNS rebinding controls
// only the hostname.
export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) return false;
  const hostname = hostHeader.toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK_HOSTNAMES.has(hostname);
}

function stripHostPort(host: string): string {
  const lower = host.trim().toLowerCase();
  if (lower.startsWith('[')) {
    const close = lower.indexOf(']');
    return close === -1 ? lower : lower.slice(1, close);
  }
  return lower.replace(/:\d+$/, '');
}

/**
 * A rebinding page sends its own DNS name as Host, so a LAN bind accepts only names an attacker
 * cannot point at this machine: IP literals, localhost, this machine's own names and extraHosts.
 */
export function isRebindSafeHostHeader(hostHeader: string | undefined, extraHosts: readonly string[]): boolean {
  if (hostHeader === undefined) return false;
  const hostname = stripHostPort(hostHeader);
  if (isIP(hostname) !== 0) return true;
  const machine = osHostname().toLowerCase();
  const allowed = new Set(['localhost', machine, `${machine}.local`, ...extraHosts.map(stripHostPort)]);
  return allowed.has(hostname);
}

export function hasProxyForwardingHeader(req: IncomingMessage): boolean {
  return PROXY_FORWARDING_HEADERS.some((name) => req.headers[name] !== undefined);
}

// A page rebound to 127.0.0.1 connects from loopback but sends its own hostname, so the peer and
// the Host header must both be local.
export function isLocalRequest(req: IncomingMessage): boolean {
  return isLoopbackPeer(req) && isLoopbackHostHeader(req.headers.host) && !hasProxyForwardingHeader(req);
}
