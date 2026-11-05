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

// These host-internal VM and container adapters (Windows, Linux and macOS names) carry addresses no phone
// on the LAN reaches. Every name is anchored, since a Hyper-V external switch moves the host's LAN address
// onto `vEthernet (<user-chosen switch name>)`, and that name may contain a word such as WSL or Docker.
const VIRTUAL_ADAPTER_PATTERN = new RegExp(
  [
    String.raw`^vEthernet \((Default Switch|WSL|WSL \(Hyper-V firewall\)|DockerNAT|nat)\)$`,
    String.raw`^WSL$`,
    String.raw`^VirtualBox Host-Only Network( #\d+)?$`,
    String.raw`^VMware Network Adapter VMnet\d+$`,
    String.raw`^docker(\d+|_gwbridge)$`,
    String.raw`^(cni-)?podman\d+$`,
    String.raw`^veth[0-9a-f]+$`,
    String.raw`^br-[0-9a-f]{12}$`,
    String.raw`^(vboxnet|vmnet|lxcbr|lxdbr|incusbr)\d+$`,
    String.raw`^virbr\d+(-nic)?$`,
  ].join('|'),
  'i',
);

function webScheme(secure: boolean): string {
  return secure ? 'https' : 'http';
}

// The resolved bind host alone decides reachability, because an explicit host wins over expose.
export function isLanReachable(host: string): boolean {
  return !(host === 'localhost' || host === '::1' || host.startsWith('127.'));
}

/** A wildcard bind still serves loopback, so the player URL never needs the LAN IP. */
export function loopbackUrl(port: number, secure: boolean): string {
  return `${webScheme(secure)}://127.0.0.1:${port}`;
}

// IPv4 only, because phones on a home LAN reach the host over IPv4 and a bracketed IPv6 URL
// confuses users.
export function listLanInterfaces(port: number, secure: boolean): NetworkInterfaceDescriptor[] {
  const out: NetworkInterfaceDescriptor[] = [];
  const all = networkInterfaces();
  for (const [iface, addrs] of Object.entries(all)) {
    if (addrs === undefined || VIRTUAL_ADAPTER_PATTERN.test(iface)) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4') continue;
      if (addr.internal) continue;
      out.push({
        iface,
        address: addr.address,
        url: `${webScheme(secure)}://${addr.address}:${port}`,
      });
    }
  }
  return out;
}
