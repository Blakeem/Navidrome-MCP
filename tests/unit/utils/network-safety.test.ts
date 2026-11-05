/**
 * Navidrome MCP Server - network-safety unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Only hostResolvesToPrivateIp resolves through this mock. safeFetch tests target an IP literal.
const mockDnsLookup = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

import {
  isHttpUrlScheme,
  isPrivateOrLocalIp,
  hostResolvesToPrivateIp,
  safeFetch,
  describeFetchError,
} from '../../../src/utils/network-safety.js';

describe('network-safety', () => {
  beforeEach(() => {
    mockDnsLookup.mockReset();
  });

  describe('isHttpUrlScheme', () => {
    it('accepts http and https', () => {
      expect(isHttpUrlScheme('http://example.com')).toBe(true);
      expect(isHttpUrlScheme('https://example.com/path?q=1')).toBe(true);
      expect(isHttpUrlScheme('HTTPS://EXAMPLE.COM')).toBe(true);
    });

    it('rejects non-HTTP schemes that radio stations might use', () => {
      expect(isHttpUrlScheme('mms://example.com/stream')).toBe(false);
      expect(isHttpUrlScheme('rtsp://example.com/live')).toBe(false);
      expect(isHttpUrlScheme('rtmp://example.com/app')).toBe(false);
    });

    it('rejects dangerous schemes', () => {
      expect(isHttpUrlScheme('file:///etc/passwd')).toBe(false);
      expect(isHttpUrlScheme('gopher://example.com')).toBe(false);
      expect(isHttpUrlScheme('javascript:alert(1)')).toBe(false);
    });

    it('rejects malformed URLs', () => {
      expect(isHttpUrlScheme('not-a-url')).toBe(false);
      expect(isHttpUrlScheme('')).toBe(false);
    });

    // The WHATWG URL parser strips tab, LF and CR, so these parse as clean http: URLs. Callers
    // store and play the original string, so a value that parses is not proven safe.
    it('rejects control characters the URL parser would silently strip', () => {
      expect(isHttpUrlScheme('http://example.com/live\nHost: internal.local')).toBe(false);
      expect(isHttpUrlScheme('http://example.com/live\r\nX-Injected: 1')).toBe(false);
      expect(isHttpUrlScheme('http://example.com/\tlive')).toBe(false);
      expect(isHttpUrlScheme('http://example.com/live\n')).toBe(false);
      expect(isHttpUrlScheme(`http://example.com/live${String.fromCharCode(0)}`)).toBe(false);
      expect(isHttpUrlScheme(`http://example.com/live${String.fromCharCode(127)}`)).toBe(false);
    });

    it('rejects surrounding spaces the URL parser would silently trim', () => {
      expect(isHttpUrlScheme(' http://example.com/live')).toBe(false);
      expect(isHttpUrlScheme('http://example.com/live ')).toBe(false);
      expect(new URL(' http://example.com/live ').href).toBe('http://example.com/live');
    });

    it('confirms the parser really does normalize those away', () => {
      // If the parser stops stripping these characters, the control-character guard is unneeded.
      const raw = 'http://example.com/live\nHost: internal.local';
      expect(new URL(raw).protocol).toBe('http:');
      expect(new URL(raw).href).not.toContain('\n');
    });
  });

  describe('isPrivateOrLocalIp — IPv4', () => {
    it('flags loopback (127.0.0.0/8)', () => {
      expect(isPrivateOrLocalIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrLocalIp('127.255.255.254')).toBe(true);
    });

    it('flags RFC1918 ranges', () => {
      expect(isPrivateOrLocalIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrLocalIp('10.255.255.255')).toBe(true);
      expect(isPrivateOrLocalIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrLocalIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrLocalIp('192.168.1.1')).toBe(true);
    });

    it('does NOT flag 172.x just outside RFC1918', () => {
      expect(isPrivateOrLocalIp('172.15.0.1')).toBe(false);
      expect(isPrivateOrLocalIp('172.32.0.1')).toBe(false);
    });

    it('flags link-local (169.254/16) including cloud metadata IP', () => {
      expect(isPrivateOrLocalIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrLocalIp('169.254.0.1')).toBe(true);
    });

    it('flags CGNAT (100.64.0.0/10)', () => {
      expect(isPrivateOrLocalIp('100.64.0.1')).toBe(true);
      expect(isPrivateOrLocalIp('100.127.255.255')).toBe(true);
      expect(isPrivateOrLocalIp('100.63.0.1')).toBe(false);
      expect(isPrivateOrLocalIp('100.128.0.1')).toBe(false);
    });

    it('flags 0/8, multicast, and reserved', () => {
      expect(isPrivateOrLocalIp('0.0.0.0')).toBe(true);
      expect(isPrivateOrLocalIp('224.0.0.1')).toBe(true);
      expect(isPrivateOrLocalIp('239.255.255.255')).toBe(true);
      expect(isPrivateOrLocalIp('255.255.255.255')).toBe(true);
    });

    it('passes legitimate public addresses', () => {
      expect(isPrivateOrLocalIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrLocalIp('93.184.216.34')).toBe(false);
      expect(isPrivateOrLocalIp('1.1.1.1')).toBe(false);
    });

    it('fails closed for malformed input', () => {
      expect(isPrivateOrLocalIp('')).toBe(true);
      expect(isPrivateOrLocalIp('not.an.ip.address')).toBe(true);
      expect(isPrivateOrLocalIp('999.999.999.999')).toBe(true);
      expect(isPrivateOrLocalIp('10.0.0')).toBe(true);
      expect(isPrivateOrLocalIp('10.0.0.0.0')).toBe(true);
      expect(isPrivateOrLocalIp('not:an:ip')).toBe(true);
    });
  });

  describe('isPrivateOrLocalIp — IPv6', () => {
    it('flags ::1 loopback', () => {
      expect(isPrivateOrLocalIp('::1')).toBe(true);
      expect(isPrivateOrLocalIp('0:0:0:0:0:0:0:1')).toBe(true);
    });

    it('flags ::/128 unspecified', () => {
      expect(isPrivateOrLocalIp('::')).toBe(true);
      expect(isPrivateOrLocalIp('0:0:0:0:0:0:0:0')).toBe(true);
    });

    it('flags fc00::/7 unique local', () => {
      expect(isPrivateOrLocalIp('fc00::1')).toBe(true);
      expect(isPrivateOrLocalIp('fd12:3456:789a::1')).toBe(true);
    });

    it('flags fe80::/10 link-local including with zone id', () => {
      expect(isPrivateOrLocalIp('fe80::1')).toBe(true);
      expect(isPrivateOrLocalIp('fe80::1%eth0')).toBe(true);
    });

    it('flags IPv4-mapped IPv6 if the IPv4 is private', () => {
      expect(isPrivateOrLocalIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrLocalIp('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateOrLocalIp('::ffff:169.254.169.254')).toBe(true);
    });

    it('does NOT flag IPv4-mapped public addresses', () => {
      expect(isPrivateOrLocalIp('::ffff:8.8.8.8')).toBe(false);
    });

    it('does NOT flag global unicast IPv6', () => {
      expect(isPrivateOrLocalIp('2606:4700:4700::1111')).toBe(false);
      expect(isPrivateOrLocalIp('2001:db8::1')).toBe(false);
    });
  });

  describe('hostResolvesToPrivateIp', () => {
    it('passes IPv4 literals through without DNS', async () => {
      await expect(hostResolvesToPrivateIp('127.0.0.1')).resolves.toBe(true);
      await expect(hostResolvesToPrivateIp('8.8.8.8')).resolves.toBe(false);
      expect(mockDnsLookup).not.toHaveBeenCalled();
    });

    it('strips brackets from IPv6 literals', async () => {
      await expect(hostResolvesToPrivateIp('[::1]')).resolves.toBe(true);
      await expect(hostResolvesToPrivateIp('[2606:4700::1111]')).resolves.toBe(false);
      expect(mockDnsLookup).not.toHaveBeenCalled();
    });

    it('resolves hostnames via DNS and flags private results', async () => {
      mockDnsLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
      await expect(hostResolvesToPrivateIp('localhost')).resolves.toBe(true);
      expect(mockDnsLookup).toHaveBeenCalledWith('localhost', { all: true });
    });

    it('flags hostname if ANY resolved IP is private', async () => {
      mockDnsLookup.mockResolvedValueOnce([
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]);
      await expect(hostResolvesToPrivateIp('mixed.example.com')).resolves.toBe(true);
    });

    it('returns false for hostnames that resolve to all public addresses', async () => {
      mockDnsLookup.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::1', family: 6 },
      ]);
      await expect(hostResolvesToPrivateIp('example.com')).resolves.toBe(false);
    });

    it('treats empty resolution as private (fail closed)', async () => {
      mockDnsLookup.mockResolvedValueOnce([]);
      await expect(hostResolvesToPrivateIp('weird.example.com')).resolves.toBe(true);
    });

    it('treats empty hostname as private', async () => {
      await expect(hostResolvesToPrivateIp('')).resolves.toBe(true);
    });

    it('propagates DNS errors so caller can fail closed', async () => {
      mockDnsLookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
      await expect(hostResolvesToPrivateIp('nonexistent.example.com')).rejects.toThrow('ENOTFOUND');
    });
  });

  describe('describeFetchError', () => {
    it('returns the message as-is when there is no cause', () => {
      expect(describeFetchError(new Error('Network error'))).toBe('Network error');
    });

    it("unwraps undici's generic 'fetch failed' to the cause message", () => {
      const err = new TypeError('fetch failed', {
        cause: new Error('Refusing connection to private/local address (127.0.0.1)'),
      });
      expect(describeFetchError(err)).toBe('Refusing connection to private/local address (127.0.0.1)');
    });

    it('walks nested causes to the deepest non-empty message', () => {
      const err = new TypeError('fetch failed', {
        cause: new Error('connect error', { cause: new Error('getaddrinfo ENOTFOUND stream.example.com') }),
      });
      expect(describeFetchError(err)).toBe('getaddrinfo ENOTFOUND stream.example.com');
    });

    it('digs into an empty-message AggregateError (multi-address connect failure)', () => {
      const aggregate = new AggregateError([
        new Error('connect ECONNREFUSED 93.184.216.34:80'),
        new Error('connect ECONNREFUSED 2606:2800:220:1::1:80'),
      ], '');
      const err = new TypeError('fetch failed', { cause: aggregate });
      expect(describeFetchError(err)).toBe('connect ECONNREFUSED 93.184.216.34:80');
    });

    it('prefers an AggregateError own non-empty message over digging into .errors', () => {
      const aggregate = new AggregateError([new Error('inner detail')], 'aggregate context');
      const err = new TypeError('fetch failed', { cause: aggregate });
      expect(describeFetchError(err)).toBe('aggregate context');
    });

    it('keeps the outer message when the cause chain has nothing better', () => {
      const err = new TypeError('fetch failed', { cause: new Error('') });
      expect(describeFetchError(err)).toBe('fetch failed');
    });

    it('falls back to Unknown error for non-Error input and empty messages', () => {
      expect(describeFetchError('boom')).toBe('Unknown error');
      expect(describeFetchError(undefined)).toBe('Unknown error');
      expect(describeFetchError(new Error(''))).toBe('Unknown error');
    });

    it('terminates on circular cause chains', () => {
      const a = new Error('outer');
      const b = new Error('inner');
      (a as { cause?: unknown }).cause = b;
      (b as { cause?: unknown }).cause = a;
      // Either message may win on a cycle. The test checks only that the depth cap ends the walk.
      expect(['outer', 'inner']).toContain(describeFetchError(a));
    });
  });
});

describe('safeFetch — peer-IP gating (real dispatcher, no mock)', () => {
  let server: Server;
  let requestHandled = false;
  let port = 0;

  beforeEach(async () => {
    requestHandled = false;
    server = createServer((_req, res) => {
      requestHandled = true;
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end('audio');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses a connection whose actual peer is a loopback address', async () => {
    // The dispatcher checks the connected socket's peer address, so the address it validates is
    // the address it reached. A DNS-rebinding answer cannot slip past it.
    await expect(safeFetch(`http://127.0.0.1:${port}/`, {})).rejects.toThrow();
    expect(requestHandled).toBe(false);
  });

  it('surfaces the private-address refusal as the rejection cause', async () => {
    const err = await safeFetch(`http://127.0.0.1:${port}/`, {}).catch((e: unknown) => e);
    // fetch wraps a connector error in a "fetch failed" TypeError and keeps it in `cause`.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
    expect(cause).toMatch(/private\/local address/i);
  });

  it('describeFetchError recovers the refusal reason from the real wrapped rejection', async () => {
    // This runs undici's real error wrapping, so a change in where undici puts the connector
    // error fails here.
    const err = await safeFetch(`http://127.0.0.1:${port}/`, {}).catch((e: unknown) => e);
    expect(describeFetchError(err)).toMatch(/Refusing connection to private\/local address/);
  });
});
