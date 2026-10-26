/**
 * Navidrome MCP Server - Web UI source address classifier
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readFileSync } from 'node:fs';
import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { logger } from '../utils/logger.js';

type SourceClass = 'loopback' | 'lan' | 'public';

type Family = 'ipv4' | 'ipv6';

type ParsedAddress =
  | { family: 'ipv4'; address: string }
  | { family: 'ipv6'; address: string; words: number[] };

const IPV6_WORD_COUNT = 8;
const IPV6_PREFIX_64_WORDS = 4;
const MAPPED_IPV4_MARKER = 0xffff;
const MAPPED_IPV4_MARKER_INDEX = 5;
const UNKNOWN_NETWORK_KEY = 'unknown';
const LOCAL_SUBNETS_TTL_MS = 10_000;

const LOOPBACK_RANGES: BlockList = buildBlockList([
  ['127.0.0.0', 8, 'ipv4'],
  ['::1', 128, 'ipv6'],
]);

// 100.64.0.0/10 is carrier-grade NAT space, which VPN overlays such as Tailscale also use.
const LAN_RANGES: BlockList = buildBlockList([
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
]);

function buildBlockList(subnets: ReadonlyArray<readonly [string, number, Family]>): BlockList {
  const list = new BlockList();
  for (const [network, prefix, family] of subnets) list.addSubnet(network, prefix, family);
  return list;
}

function ipv4WordsToString(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/** Expects an address `isIPv6` accepted, so it only parses and never validates. */
function expandIpv6(address: string): number[] {
  let hexForm = address;
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (isIPv4(tail)) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    hexForm = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [headPart = '', tailPart] = hexForm.split('::');
  const head = headPart === '' ? [] : headPart.split(':');
  const rest = tailPart === undefined || tailPart === '' ? [] : tailPart.split(':');
  const zeros = tailPart === undefined ? [] : new Array<string>(IPV6_WORD_COUNT - head.length - rest.length).fill('0');
  return [...head, ...zeros, ...rest].map((word) => Number.parseInt(word, 16));
}

function isMappedIpv4(words: readonly number[]): boolean {
  return words.slice(0, MAPPED_IPV4_MARKER_INDEX).every((word) => word === 0) &&
    words[MAPPED_IPV4_MARKER_INDEX] === MAPPED_IPV4_MARKER;
}

// A link-local peer may carry a zone suffix such as `%eth0`, which names the interface, not the peer.
function parseAddress(remoteAddress: string | undefined): ParsedAddress | null {
  if (remoteAddress === undefined) return null;
  const address = remoteAddress.trim().toLowerCase().split('%', 1)[0] ?? '';

  if (isIPv4(address)) return { family: 'ipv4', address };
  if (!isIPv6(address)) return null;

  const words = expandIpv6(address);
  if (isMappedIpv4(words)) {
    return { family: 'ipv4', address: ipv4WordsToString(words[6] ?? 0, words[7] ?? 0) };
  }
  return { family: 'ipv6', address, words };
}

/** A /0 entry is skipped, because it would make every address local. */
function readLocalSubnets(): BlockList {
  const list = new BlockList();
  let interfaces: ReturnType<typeof networkInterfaces> = {};
  try {
    interfaces = networkInterfaces();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`webui: cannot list network interfaces, so only the fixed LAN ranges count as local: ${reason}`);
  }
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.cidr === null) continue;
      const prefix = Number(entry.cidr.slice(entry.cidr.lastIndexOf('/') + 1));
      if (!Number.isInteger(prefix) || prefix <= 0) continue;
      list.addSubnet(entry.address, prefix, entry.family === 'IPv4' ? 'ipv4' : 'ipv6');
    }
  }
  return list;
}

let cachedLocalSubnets: { list: BlockList; readAt: number } | null = null;

/**
 * `networkInterfaces()` is synchronous and takes milliseconds, so a request flood would block the
 * event loop. The TTL still picks up a DHCP or VPN subnet change, and the monotonic clock ignores a
 * wall-clock jump.
 */
function localSubnets(): BlockList {
  const now = performance.now();
  if (cachedLocalSubnets === null || now - cachedLocalSubnets.readAt >= LOCAL_SUBNETS_TTL_MS) {
    cachedLocalSubnets = { list: readLocalSubnets(), readAt: now };
  }
  return cachedLocalSubnets.list;
}

/**
 * A private source is a hint, never proof. A NAT, a container proxy or a port forward can make an
 * internet client look local, so this check is no reason to expose the port.
 */
export function classifySource(remoteAddress: string | undefined): SourceClass {
  const parsed = parseAddress(remoteAddress);
  if (parsed === null) return 'public';
  if (LOOPBACK_RANGES.check(parsed.address, parsed.family)) return 'loopback';
  if (LAN_RANGES.check(parsed.address, parsed.family)) return 'lan';
  if (localSubnets().check(parsed.address, parsed.family)) return 'lan';
  return 'public';
}

/**
 * Groups internet peers, since one home or ISP customer usually holds a whole IPv6 /64. Every
 * device on one LAN shares a /64, so the key never tells LAN devices apart.
 */
export function networkKey(remoteAddress: string | undefined): string {
  const parsed = parseAddress(remoteAddress);
  if (parsed === null) return UNKNOWN_NETWORK_KEY;
  if (parsed.family === 'ipv4') return parsed.address;
  const prefix = parsed.words.slice(0, IPV6_PREFIX_64_WORDS).map((word) => word.toString(16)).join(':');
  return `${prefix}::/64`;
}

/** The peer as the user would type it, so a mapped `::ffff:` IPv4 peer reads as plain IPv4. */
export function sourceAddress(remoteAddress: string | undefined): string {
  return parseAddress(remoteAddress)?.address ?? UNKNOWN_NETWORK_KEY;
}

// Docker writes `/.dockerenv` and Podman writes `/run/.containerenv`.
const CONTAINER_MARKER_FILES: readonly string[] = ['/.dockerenv', '/run/.containerenv'];

/**
 * Docker, Podman and WSL forward ports through a proxy, so a remote peer can arrive with a local
 * address. Every WSL kernel matches, since a custom WSL2 kernel may lack the `microsoft-standard` tag.
 */
export function isAddressRewritingHost(): boolean {
  if (CONTAINER_MARKER_FILES.some((path) => existsSync(path))) return true;
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}
