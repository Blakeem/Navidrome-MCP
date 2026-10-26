/**
 * Navidrome MCP Server - Loopback guard tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { isLocalRequest, isLoopbackPeer, isRebindSafeHostHeader } from '../../../src/webui/loopback.js';

function fakeReq(remoteAddress: string | undefined, headers: Record<string, string> = {}): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage;
}

describe('isLoopbackPeer', () => {
  it.each(['127.0.0.1', '127.5.6.7', '::1', '::ffff:127.0.0.1'])('accepts %s', (address) => {
    expect(isLoopbackPeer(fakeReq(address))).toBe(true);
  });

  it.each(['192.168.1.50', '::ffff:192.168.1.50', '203.0.113.5', 'fe80::1', undefined])('rejects %s', (address) => {
    expect(isLoopbackPeer(fakeReq(address))).toBe(false);
  });
});

describe('isRebindSafeHostHeader', () => {
  it.each([
    '192.168.1.20:8808',
    '192.168.1.20',
    '[fe80::1]:8808',
    '[::1]',
    'localhost:8808',
    'LOCALHOST',
  ])('accepts %s', (host) => {
    expect(isRebindSafeHostHeader(host, [])).toBe(true);
  });

  it("accepts this machine's name and its .local form, ignoring case", () => {
    const machine = hostname();
    expect(isRebindSafeHostHeader(`${machine.toUpperCase()}:8808`, [])).toBe(true);
    expect(isRebindSafeHostHeader(`${machine.toLowerCase()}.local:8808`, [])).toBe(true);
  });

  it.each(['evil.example:8808', 'evil.example', '192.168.1.20.nip.io:8808', ''])('rejects %j', (host) => {
    expect(isRebindSafeHostHeader(host, [])).toBe(false);
  });

  it('rejects a missing Host header', () => {
    expect(isRebindSafeHostHeader(undefined, [])).toBe(false);
  });

  it('accepts an extra host, ignoring case and port on both sides', () => {
    expect(isRebindSafeHostHeader('Music.Home.Lan:8808', ['music.home.lan:9000'])).toBe(true);
    expect(isRebindSafeHostHeader('other.home.lan:8808', ['music.home.lan'])).toBe(false);
  });
});

describe('isLocalRequest', () => {
  it('is true for a loopback peer with a loopback Host and no forwarding header', () => {
    expect(isLocalRequest(fakeReq('127.0.0.1', { host: '127.0.0.1:8808' }))).toBe(true);
  });

  it.each(['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'])(
    'is false for a loopback peer with a loopback Host plus %s',
    (header) => {
      expect(isLocalRequest(fakeReq('127.0.0.1', { host: '127.0.0.1:8808', [header]: '203.0.113.5' }))).toBe(false);
    },
  );
});
