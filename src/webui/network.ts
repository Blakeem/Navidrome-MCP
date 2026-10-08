/**
 * Navidrome MCP Server - Web UI Network Helpers
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

import { networkInterfaces } from 'node:os';

interface NetworkInterfaceDescriptor {
  iface: string;
  address: string;
  url: string;
}

// The resolved bind host alone decides reachability, because an explicit host wins over expose.
export function isLanReachable(host: string): boolean {
  return !(host === 'localhost' || host === '::1' || host.startsWith('127.'));
}

// IPv4 only, because phones on a home LAN reach the host over IPv4 and a bracketed IPv6 URL confuses users.
export function listLanInterfaces(port: number): NetworkInterfaceDescriptor[] {
  const out: NetworkInterfaceDescriptor[] = [];
  const all = networkInterfaces();
  for (const [iface, addrs] of Object.entries(all)) {
    if (addrs === undefined) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4') continue;
      if (addr.internal) continue;
      out.push({
        iface,
        address: addr.address,
        url: `http://${addr.address}:${port}`,
      });
    }
  }
  return out;
}
