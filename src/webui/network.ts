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
  /** OS-supplied interface name (e.g. "eth0", "wlan0", "en0"). */
  iface: string;
  /** IPv4 address bound to that interface (non-internal only). */
  address: string;
  /** Fully-formed URL the user can paste into a browser on that interface. */
  url: string;
}

/**
 * Enumerate non-internal IPv4 addresses reachable on the host, paired with
 * a ready-to-paste URL for the running web UI. Skips loopback (the user
 * already knows about `localhost`/`127.0.0.1`) and IPv6 (most LAN setups
 * don't expose phones on IPv6, and the URL form `http://[::1]:8808` is more
 * confusing than useful in the network-info panel).
 *
 * Returns an empty array when the only interfaces present are internal —
 * the caller renders that as "no LAN interfaces detected" and points the
 * user at the localhost URL as the only option.
 */
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
