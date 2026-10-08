/**
 * Navidrome MCP Server - Loopback peer guard
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

import type { IncomingMessage } from 'node:http';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

// Matches all of 127/8 and its ::ffff: mapped form, since a dual-stack host reports a local browser that way.
export function isLoopbackPeer(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return (
    addr === '::1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  );
}

// Port is ignored: a client omits a default port such as 80, and DNS rebinding controls only the hostname.
export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) return false;
  const hostname = hostHeader.toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK_HOSTNAMES.has(hostname);
}

// A page rebound to 127.0.0.1 connects from loopback but sends its own hostname, so peer and Host must both be local.
export function isLocalRequest(req: IncomingMessage): boolean {
  return isLoopbackPeer(req) && isLoopbackHostHeader(req.headers.host);
}
