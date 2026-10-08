/**
 * Navidrome MCP Server - sanitize-url unit tests
 * Copyright (C) 2025
 */

import { describe, expect, it } from 'vitest';
import { stripSubsonicAuthParams } from '../../../src/utils/sanitize-url.js';

describe('stripSubsonicAuthParams', () => {
  it('strips Subsonic auth params (u, p, s, t) from a URL', () => {
    const raw = 'http://nav:4533/rest/stream?id=abc&u=user&p=plain&s=salt&t=token&v=1.16.1&c=client&f=json';
    const out = stripSubsonicAuthParams(raw);
    expect(out).not.toContain('u=user');
    expect(out).not.toContain('p=plain');
    expect(out).not.toContain('s=salt');
    expect(out).not.toContain('t=token');
    // Non-auth params survive
    expect(out).toContain('id=abc');
    expect(out).toContain('v=1.16.1');
    expect(out).toContain('c=client');
    expect(out).toContain('f=json');
  });

  it('returns URLs without auth params verbatim (no allocation)', () => {
    const raw = 'http://nav:4533/rest/stream?id=abc&format=mp3';
    expect(stripSubsonicAuthParams(raw)).toBe(raw);
  });

  it('returns non-URL strings unchanged', () => {
    expect(stripSubsonicAuthParams('/local/path/file.mp3')).toBe('/local/path/file.mp3');
    expect(stripSubsonicAuthParams('not a url at all')).toBe('not a url at all');
    expect(stripSubsonicAuthParams('')).toBe('');
  });

  it('strips ALL leaked auth shapes (plaintext + salted) from same URL', () => {
    // Defense-in-depth: even if a future code path mixes both, both get gone.
    const raw = 'http://nav:4533/rest/stream?id=abc&u=user&p=plain&s=salt&t=token';
    const out = stripSubsonicAuthParams(raw);
    expect(out).toBe('http://nav:4533/rest/stream?id=abc');
  });
});
