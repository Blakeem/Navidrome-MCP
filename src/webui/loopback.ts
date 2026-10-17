/**
 * Navidrome MCP Server - Loopback peer guard
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage } from 'node:http';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Matches all of 127/8 and its ::ffff: mapped form, since a dual-stack bind reports a local
// browser that way.
export function isLoopbackPeer(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return (
    addr === '::1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  );
}

// The port is ignored, since a client omits a default port such as 80 and DNS rebinding controls
// only the hostname.
export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) return false;
  const hostname = hostHeader.toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK_HOSTNAMES.has(hostname);
}

// A page rebound to 127.0.0.1 connects from loopback but sends its own hostname, so the peer and
// the Host header must both be local.
export function isLocalRequest(req: IncomingMessage): boolean {
  return isLoopbackPeer(req) && isLoopbackHostHeader(req.headers.host);
}
