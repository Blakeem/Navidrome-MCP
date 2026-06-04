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

/**
 * Loopback guard (defense-in-depth on top of any bind address). Accepts the
 * IPv4-mapped form `::ffff:127.0.0.1` too, which is what a dual-stack Linux host
 * presents for a local connection — a naive exact match would reject the user's
 * own browser. Used to keep sensitive surfaces (settings, shutdown, /healthz
 * when exposed) local even when the player is bound on the LAN.
 */
export function isLoopbackPeer(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  // The whole 127.0.0.0/8 range is loopback (and its IPv4-mapped IPv6 form),
  // plus IPv6 ::1. Matching the range (not just .0.0.1) avoids rejecting a
  // local user on an exotic loopback alias.
  return (
    addr === '::1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  );
}
