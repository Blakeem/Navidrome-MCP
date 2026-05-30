/**
 * Navidrome MCP Server - subsonic-auth unit tests
 * Copyright (C) 2025
 */

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSubsonicAuthParams } from '../../../src/utils/subsonic-auth.js';

describe('buildSubsonicAuthParams', () => {
  it('emits salted-MD5 credential keys (u, t, s, v, c, f) and never the plaintext password (p)', () => {
    const params = buildSubsonicAuthParams('alice', 'sekret');

    expect(params.has('u')).toBe(true);
    expect(params.has('t')).toBe(true);
    expect(params.has('s')).toBe(true);
    expect(params.has('v')).toBe(true);
    expect(params.has('c')).toBe(true);
    expect(params.has('f')).toBe(true);

    // The plaintext password must never be present.
    expect(params.has('p')).toBe(false);

    expect(params.get('u')).toBe('alice');
  });

  it('generates s as exactly 32 lowercase hex chars (16-byte salt)', () => {
    const params = buildSubsonicAuthParams('alice', 'sekret');
    const salt = params.get('s');

    expect(salt).not.toBeNull();
    expect(/^[0-9a-f]{32}$/.test(salt ?? '')).toBe(true);
  });

  it('computes t as md5(password + salt)', () => {
    const password = 'sekret';
    const params = buildSubsonicAuthParams('alice', password);
    const salt = params.get('s') ?? '';
    const expectedToken = crypto.createHash('md5').update(password + salt).digest('hex');

    expect(params.get('t')).toBe(expectedToken);
  });

  it('merges extraParams without clobbering credential keys', () => {
    const params = buildSubsonicAuthParams('alice', 'sekret', { id: 'abc', format: 'mp3' });

    // Extra params appear in the output.
    expect(params.get('id')).toBe('abc');
    expect(params.get('format')).toBe('mp3');

    // Credential keys are intact.
    expect(params.get('u')).toBe('alice');
    expect(/^[0-9a-f]{32}$/.test(params.get('s') ?? '')).toBe(true);
    expect(params.has('p')).toBe(false);
  });

  it('produces a fresh salt + token on every call (no reuse)', () => {
    const first = buildSubsonicAuthParams('alice', 'sekret');
    const second = buildSubsonicAuthParams('alice', 'sekret');

    expect(first.get('s')).not.toBe(second.get('s'));
    expect(first.get('t')).not.toBe(second.get('t'));
  });
});
