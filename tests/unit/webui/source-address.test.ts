// The source class gates internet peers, and the network key groups one network's addresses, so
// each range and the interface-subnet rule are pinned here.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, networkInterfaces: vi.fn(() => ({})) };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => false), readFileSync: vi.fn() };
});

import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { classifySource, isAddressRewritingHost, networkKey } from '../../../src/webui/source-address.js';
import { logger } from '../../../src/utils/logger.js';

// The interface subnets stay cached for 10 s, so each test starts past that lifetime.
const SUBNET_CACHE_TTL_MS = 10_000;

function iface(address: string, cidr: string | null, family: 'IPv4' | 'IPv6'): NetworkInterfaceInfo {
  return { address, cidr, family, netmask: '', mac: '00:00:00:00:00:00', internal: false, scopeid: 0 } as NetworkInterfaceInfo;
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['performance'] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(SUBNET_CACHE_TTL_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(networkInterfaces).mockReset();
  vi.mocked(networkInterfaces).mockReturnValue({});
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockReset();
});

describe('classifySource', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['10.1.2.3', 'lan'],
    ['172.16.0.1', 'lan'],
    ['172.31.255.254', 'lan'],
    ['192.168.1.50', 'lan'],
    ['169.254.10.20', 'lan'],
    ['100.64.0.1', 'lan'],
    ['100.127.255.254', 'lan'],
    ['fd12:3456::1', 'lan'],
    ['fc00::1', 'lan'],
    ['fe80::1', 'lan'],
    ['fe80::1%eth0', 'lan'],
    ['FE80::ABCD', 'lan'],
    ['::ffff:192.168.1.50', 'lan'],
    ['::ffff:c0a8:132', 'lan'],
    ['203.0.113.5', 'public'],
    ['172.32.0.1', 'public'],
    ['100.128.0.1', 'public'],
    ['8.8.8.8', 'public'],
    ['::ffff:8.8.8.8', 'public'],
    ['2001:db8::1', 'public'],
    ['', 'public'],
    ['not-an-address', 'public'],
  ])('classifies %j as %s', (address, expected) => {
    expect(classifySource(address)).toBe(expected);
  });

  it('classifies a missing address as public', () => {
    expect(classifySource(undefined)).toBe('public');
  });

  it('classifies an address inside a local interface subnet as lan, a global IPv6 /64 included', () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [iface('2001:db8:1:2::abcd', '2001:db8:1:2::abcd/64', 'IPv6'), iface('198.51.100.7', '198.51.100.7/24', 'IPv4')],
    });

    expect(classifySource('2001:db8:1:2:ffff::9')).toBe('lan');
    expect(classifySource('198.51.100.200')).toBe('lan');
    expect(classifySource('::ffff:198.51.100.200')).toBe('lan');
    expect(classifySource('2001:db8:1:3::9')).toBe('public');
    expect(classifySource('198.51.101.1')).toBe('public');
  });

  it('ignores a /0 interface subnet and an entry without a cidr', () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      tun0: [iface('198.51.100.7', '0.0.0.0/0', 'IPv4'), iface('2001:db8::1', null, 'IPv6')],
    });

    expect(classifySource('8.8.8.8')).toBe('public');
    expect(classifySource('2001:db8::2')).toBe('public');
  });

  it('reads the interfaces once per cache lifetime and rereads them after it ends', () => {
    vi.mocked(networkInterfaces).mockReturnValue({});
    expect(classifySource('198.51.100.200')).toBe('public');
    expect(classifySource('203.0.113.5')).toBe('public');
    expect(networkInterfaces).toHaveBeenCalledTimes(1);

    vi.mocked(networkInterfaces).mockReturnValue({ eth0: [iface('198.51.100.7', '198.51.100.7/24', 'IPv4')] });
    vi.advanceTimersByTime(SUBNET_CACHE_TTL_MS - 1);
    expect(classifySource('198.51.100.200')).toBe('public');

    vi.advanceTimersByTime(1);
    expect(classifySource('198.51.100.200')).toBe('lan');
    expect(networkInterfaces).toHaveBeenCalledTimes(2);
  });

  it('does not read the interfaces for a loopback or fixed-range LAN address', () => {
    classifySource('127.0.0.1');
    classifySource('192.168.1.50');
    expect(networkInterfaces).not.toHaveBeenCalled();
  });

  it('falls back to the fixed ranges and warns when the interfaces cannot be listed', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.mocked(networkInterfaces).mockImplementation(() => {
      throw new Error('uv_interface_addresses failed');
    });

    expect(classifySource('198.51.100.200')).toBe('public');
    expect(classifySource('192.168.1.50')).toBe('lan');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('uv_interface_addresses failed'));
  });
});

describe('networkKey', () => {
  it.each([
    ['203.0.113.5', '203.0.113.5'],
    ['::ffff:203.0.113.5', '203.0.113.5'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002::9', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::192.0.2.33', '64:ff9b:0:0::/64'],
  ])('keys %j as %j', (address, expected) => {
    expect(networkKey(address)).toBe(expected);
  });

  it('groups two addresses of one IPv6 /64 under one key', () => {
    expect(networkKey('2001:db8:1:2::1')).toBe(networkKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
  });

  it.each([undefined, '', 'garbage'])('keys a missing or invalid address %j as unknown', (address) => {
    expect(networkKey(address)).toBe('unknown');
  });
});

describe('isAddressRewritingHost', () => {
  it.each(['/.dockerenv', '/run/.containerenv'])('detects a container by its %s marker', (marker) => {
    vi.mocked(existsSync).mockImplementation((path) => path === marker);
    expect(isAddressRewritingHost()).toBe(true);
  });

  it.each([
    'Linux version 5.15.153.1-microsoft-standard-WSL2',
    'Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com)',
  ])('detects WSL by a microsoft kernel in /proc/version %j', (version) => {
    vi.mocked(readFileSync).mockReturnValue(version);
    expect(isAddressRewritingHost()).toBe(true);
  });

  it('reports false for a plain Linux kernel', () => {
    vi.mocked(readFileSync).mockReturnValue('Linux version 6.8.0-45-generic');
    expect(isAddressRewritingHost()).toBe(false);
  });

  it('reports false when /proc/version cannot be read, such as on Windows', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(isAddressRewritingHost()).toBe(false);
  });
});
