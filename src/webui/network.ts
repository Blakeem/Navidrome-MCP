/**
 * Navidrome MCP Server - Web UI Network Helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

// IPv4 only, because phones on a home LAN reach the host over IPv4 and a bracketed IPv6 URL
// confuses users.
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
