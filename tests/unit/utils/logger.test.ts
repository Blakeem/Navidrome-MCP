/**
 * Navidrome MCP Server - logger redaction unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { redact } from '../../../src/utils/logger.js';

describe('redact()', () => {
  describe('Bearer token redaction', () => {
    it('redacts Authorization: Bearer in a string', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def request failed';
      const result = redact(input);
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(result).toContain('Authorization: Bearer <REDACTED>');
    });

    it('redacts X-ND-Authorization: Bearer in a string', () => {
      const input = 'X-ND-Authorization: Bearer someLongToken12345 was rejected';
      const result = redact(input);
      expect(result).not.toContain('someLongToken12345');
      expect(result).toContain('X-ND-Authorization: Bearer <REDACTED>');
    });

    it('handles case-insensitive header names', () => {
      const result = redact('authorization: Bearer MYSECRETTOKEN12345 failed');
      expect(result).not.toContain('MYSECRETTOKEN12345');
      expect(result).toContain('Bearer <REDACTED>');
    });
  });

  describe('Bearer token in an object', () => {
    it('redacts Authorization Bearer header value in object strings', () => {
      const input = {
        headers: {
          'Authorization': 'Bearer super.secret.tokenvalue12345',
        },
      };
      const result = redact(input) as { headers: { Authorization: string } };
      expect(result.headers['Authorization']).not.toContain('super.secret.tokenvalue12345');
      expect(result.headers['Authorization']).toContain('<REDACTED>');
    });

    it('redacts nested X-ND-Authorization header', () => {
      const input = {
        request: {
          headers: {
            'X-ND-Authorization': 'Bearer nd.token.secretvalue99',
          },
        },
      };
      const result = redact(input) as {
        request: { headers: { 'X-ND-Authorization': string } };
      };
      expect(result.request.headers['X-ND-Authorization']).not.toContain('secretvalue99');
    });
  });

  describe('password JSON field redaction', () => {
    it('redacts "password" JSON key', () => {
      const input = 'Config dump: {"username":"bob","password":"s3cr3t!","host":"localhost"}';
      const result = redact(input) as string;
      expect(result).not.toContain('s3cr3t!');
      expect(result).toContain('"password": "<REDACTED>"');
    });

    it('redacts "navidromePassword" JSON key', () => {
      const input = '{"navidromePassword":"mypass123","navidromeUrl":"http://localhost"}';
      const result = redact(input) as string;
      expect(result).not.toContain('mypass123');
      expect(result).toContain('"navidromePassword": "<REDACTED>"');
    });

    it('redacts "NAVIDROME_PASSWORD" JSON key', () => {
      const input = '{"NAVIDROME_PASSWORD":"envpass456"}';
      const result = redact(input) as string;
      expect(result).not.toContain('envpass456');
      expect(result).toContain('"NAVIDROME_PASSWORD": "<REDACTED>"');
    });

    it('redacts single-quoted password values (util.format style)', () => {
      // Node's util.format prints object strings in single quotes.
      const input = "Config: { username: 'alice', password: 's3cr3t!', host: 'localhost' }";
      const result = redact(input) as string;
      expect(result).not.toContain('s3cr3t!');
      expect(result).toContain('alice');
      expect(result).toContain('localhost');
    });

    it('redacts unquoted password=value env-var style', () => {
      const input = 'env dump: NAVIDROME_PASSWORD=envvarsecret123 LOG_LEVEL=debug';
      const result = redact(input) as string;
      expect(result).not.toContain('envvarsecret123');
      expect(result).toContain('LOG_LEVEL=debug');
    });

    it('does not over-redact past the value boundary in JSON-flat strings', () => {
      const input = '{"username":"bob","password":"s3cr3t!","host":"localhost"}';
      const result = redact(input) as string;
      expect(result).not.toContain('s3cr3t!');
      expect(result).toContain('"host":"localhost"');
    });

    it('redacts string-leaf values under sensitive keys in nested objects', () => {
      // A string leaf carries no key for the regex passes, so only the key-name check catches it.
      const input = { config: { password: 'myplaintextpwd' } };
      const result = redact(input) as { config: { password: string } };
      expect(result.config.password).toBe('<REDACTED>');
    });

    it('redacts keys that end in a sensitive name, such as the runtime Config secrets', () => {
      const input = { navidromePassword: 'a', authToken: 'b', lastFmApiKey: 'c' };
      expect(redact(input)).toEqual({
        navidromePassword: '<REDACTED>',
        authToken: '<REDACTED>',
        lastFmApiKey: '<REDACTED>',
      });
    });

    it('passes through non-sensitive object keys unchanged', () => {
      const input = { title: 'my password song' };
      const result = redact(input) as { title: string };
      expect(result.title).toBe('my password song');
    });

    it('redacts "password" field when embedded in a serialized object string', () => {
      const serialized = JSON.stringify({ username: 'alice', password: 'secret123' });
      const result = redact(`Config: ${serialized}`) as string;
      expect(result).not.toContain('secret123');
    });
  });

  describe('Subsonic auth param redaction', () => {
    it('strips u= and p= params from URL-like strings', () => {
      const input = 'Streaming URL: http://host:4533/rest/stream?id=abc&u=admin&p=pass123&v=1.16.1';
      const result = redact(input) as string;
      expect(result).not.toContain('p=pass123');
      expect(result).not.toContain('u=admin');
      expect(result).toContain('id=abc');
    });

    it('strips s=/t= salt+token params from raw (non-URL) strings', () => {
      // stripSubsonicAuthParams handles only a parseable URL, so a query fragment in other text
      // relies on this regex. The salt and token pair is enough to replay a request.
      const input = 'mpv stderr: requesting ?id=abc&u=user&t=hashtoken99&s=randomsalt&v=1.16.1 fragment';
      const result = redact(input) as string;
      expect(result).not.toContain('t=hashtoken99');
      expect(result).not.toContain('s=randomsalt');
      expect(result).not.toContain('u=user');
      expect(result).toContain('v=1.16.1');
      expect(result).toContain('id=abc');
    });

    it('strips s=/t= Subsonic params from well-formed URL strings', () => {
      const input = 'http://host:4533/rest/stream?id=abc&u=user&t=hashtoken&s=salt&v=1.16.1';
      const result = redact(input) as string;
      expect(result).not.toContain('t=hashtoken');
      expect(result).not.toContain('s=salt');
      expect(result).toContain('v=1.16.1');
    });
  });

  describe('URL userinfo credentials', () => {
    it('redacts https://user:pass@host URLs', () => {
      const input = 'fetch failed for https://admin:mypassword@navidrome.local/api/album';
      const result = redact(input) as string;
      expect(result).not.toContain('admin:mypassword');
      expect(result).toContain('https://<REDACTED>@navidrome.local');
    });

    it('redacts http://user:pass@host URLs', () => {
      const input = 'Error: connect ECONNREFUSED http://bob:s3cr3t@192.168.1.10:4533/';
      const result = redact(input) as string;
      expect(result).not.toContain('bob:s3cr3t');
      expect(result).toContain('http://<REDACTED>@');
    });

    it('leaves URLs without credentials unchanged', () => {
      const input = 'http://navidrome.local:4533/api/album?_start=0&_end=10';
      const result = redact(input) as string;
      expect(result).toBe(input);
    });
  });

  describe('JWT-shaped token redaction', () => {
    it('redacts a raw JWT string in a log message', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiaWF0IjoxNjE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const input = `Token received: ${jwt}`;
      const result = redact(input) as string;
      expect(result).not.toContain(jwt);
      expect(result).toContain('<JWT_REDACTED>');
    });

    it('redacts JWT embedded in an object string value', () => {
      const input = {
        raw: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWxpY2UifQ.SomeSignature12345678901234567890',
      };
      const result = redact(input) as { raw: string };
      expect(result.raw).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(result.raw).toContain('<JWT_REDACTED>');
    });
  });

  describe('API key / secret redaction', () => {
    it('redacts api_key=value style', () => {
      const input = 'Request params: api_key=abc123deadbeef method=getSimilarArtists';
      const result = redact(input) as string;
      expect(result).not.toContain('abc123deadbeef');
      expect(result).toContain('api_key=<REDACTED>');
    });

    it('redacts apiKey: "value" JSON style', () => {
      const input = 'Config: {"apiKey":"lastfmkey12345","method":"track.getSimilar"}';
      const result = redact(input) as string;
      expect(result).not.toContain('lastfmkey12345');
    });

    it('redacts secret: value style', () => {
      const input = 'secret=mysupersecretvalue123 was used';
      const result = redact(input) as string;
      expect(result).not.toContain('mysupersecretvalue123');
    });

    it('redacts api-token: value style', () => {
      const input = 'api-token: sk-abcdefghijklmnop failed to authenticate';
      const result = redact(input) as string;
      expect(result).not.toContain('sk-abcdefghijklmnop');
    });

    it('redacts an authToken JSON value', () => {
      const result = redact('{"authToken":"abc"}') as string;
      expect(result).not.toContain('abc');
    });

    it('does NOT over-redact past the value boundary in JSON-flat strings', () => {
      const input = '{"apiKey":"lastfmkey12345","other":"x","method":"track.getSimilar"}';
      const result = redact(input) as string;
      expect(result).not.toContain('lastfmkey12345');
      expect(result).toContain('"other":"x"');
      expect(result).toContain('"method":"track.getSimilar"');
    });
  });

  describe('Error object redaction', () => {
    it('redacts credentials in Error.message', () => {
      const err = new Error('fetch failed for https://user:password123@host:4533/api/album');
      const result = redact(err) as Error;
      expect(result).toBeInstanceOf(Error);
      expect(result.message).not.toContain('password123');
      expect(result.message).toContain('https://<REDACTED>@host:4533');
    });

    it('redacts credentials in Error.stack', () => {
      const err = new Error('Authorization: Bearer secrettoken12345 rejected');
      const result = redact(err) as Error;
      expect(result.stack).not.toContain('secrettoken12345');
    });

    it('redacts credentials in nested Error.cause', () => {
      const cause = new Error('password: "causepwd456" in cause');
      const err = new Error('outer error') as Error & { cause: Error };
      Object.defineProperty(err, 'cause', { value: cause, configurable: true });
      const result = redact(err) as Error & { cause: Error };
      expect(result.cause.message).not.toContain('causepwd456');
    });

    it('preserves Error.name', () => {
      const err = new TypeError('bad type');
      const result = redact(err) as Error;
      expect(result.name).toBe('TypeError');
    });
  });

  describe('nested object redaction', () => {
    it('redacts password strings 3 levels deep', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              msg: '"password": "deeppassword789"',
            },
          },
        },
      };
      const result = redact(input) as typeof input;
      expect(result.level1.level2.level3.msg).not.toContain('deeppassword789');
    });

    it('stops walking at depth 5 (returns subtree unchanged beyond limit)', () => {
      // The credential sits deeper than the depth limit, so its survival proves the walk stopped.
      const deep = {
        a: { b: { c: { d: { e: { f: { token: 'Bearer abcdefghijklmnop' } } } } } },
      };
      const result = redact(deep) as typeof deep;
      expect(result.a.b.c.d.e.f.token).toBe('Bearer abcdefghijklmnop');
    });

    it('handles circular references without stack-overflow', () => {
      // The depth limit is the only cycle guard, since the walker keeps no visited set.
      const circular: Record<string, unknown> = { name: 'site' };
      circular['self'] = circular;
      expect(() => redact(circular)).not.toThrow();
      const result = redact(circular) as Record<string, unknown>;
      expect(result['name']).toBe('site');
    });
  });

  describe('array redaction', () => {
    it('redacts credentials in each array element', () => {
      const input = [
        { url: 'https://user:pass@host/api', name: 'site1' },
        { token: 'Authorization: Bearer mytoken12345', name: 'site2' },
        { plain: 'no credentials here', name: 'site3' },
      ];
      const result = redact(input) as typeof input;
      expect(result[0].url).not.toContain('user:pass');
      expect(result[1].token).not.toContain('mytoken12345');
      expect(result[2].plain).toBe('no credentials here');
    });

    it('handles nested arrays', () => {
      const input = [
        ['Authorization: Bearer abc123def456ghi789 token', 'safe string'],
      ];
      const result = redact(input) as string[][];
      expect(result[0][0]).not.toContain('abc123def456ghi789');
      expect(result[0][1]).toBe('safe string');
    });
  });

  describe('oversized string redaction (truncate-then-redact)', () => {
    it('redacts a password embedded near the front of a >50KB string', () => {
      const input = `password: "hugedumpsecret42" ${'x'.repeat(60_000)}`;
      const result = redact(input) as string;
      expect(result).not.toContain('hugedumpsecret42');
      expect(result).toContain('<REDACTED>');
      expect(result.endsWith(' [TRUNCATED_BY_LOGGER]')).toBe(true);
    });

    it('redacts a Bearer token near the front of a >50KB string', () => {
      const input = `Authorization: Bearer bigblobtoken12345 ${'y'.repeat(60_000)}`;
      const result = redact(input) as string;
      expect(result).not.toContain('bigblobtoken12345');
      expect(result).toContain('Bearer <REDACTED>');
      expect(result.endsWith(' [TRUNCATED_BY_LOGGER]')).toBe(true);
    });

    it('does not tag strings at or under the size limit', () => {
      const input = 'z'.repeat(50_000);
      expect(redact(input)).toBe(input);
    });

    it('completes quickly on a large dot-free base64url blob (JWT-pass ReDoS guard)', () => {
      // An unanchored JWT pattern takes about 5s on a 50KB dot-free run, so a 1s bound still
      // catches it.
      const blob = 'A'.repeat(60_000);
      const start = performance.now();
      const result = redact(blob) as string;
      const elapsed = performance.now() - start;
      expect(result.endsWith(' [TRUNCATED_BY_LOGGER]')).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });

    it('still redacts a JWT mid-string after the lookbehind anchoring', () => {
      const jwt = `${'a'.repeat(25)}.${'b'.repeat(25)}.${'c'.repeat(25)}`;
      const result = redact(`token value ${jwt} was rejected`) as string;
      expect(result).not.toContain(jwt);
      expect(result).toContain('<JWT_REDACTED>');
    });
  });

  describe('built-in object rendering', () => {
    it('renders a valid Date as its ISO string instead of {}', () => {
      expect(redact(new Date('2026-07-08T12:00:00.000Z'))).toBe('2026-07-08T12:00:00.000Z');
    });

    it('renders an invalid Date as "Invalid Date" without throwing', () => {
      // toISOString() throws RangeError on an invalid Date, and the logger must never throw.
      expect(() => redact(new Date('not-a-date'))).not.toThrow();
      expect(redact(new Date('not-a-date'))).toBe('Invalid Date');
    });

    it('renders nested and array-held invalid Dates without throwing', () => {
      expect(() => redact({ nested: { when: new Date('garbage') } })).not.toThrow();
      expect(() => redact([1, 2, new Date('also garbage')])).not.toThrow();
      const result = redact({ nested: { when: new Date('garbage') } }) as {
        nested: { when: string };
      };
      expect(result.nested.when).toBe('Invalid Date');
    });

    it('renders a RegExp as its source string instead of {}', () => {
      const result = redact({ pattern: /abc+/gi }) as { pattern: string };
      expect(result.pattern).toBe('/abc+/gi');
    });

    it('renders typed arrays compactly instead of per-byte keys', () => {
      const result = redact({ buf: new Uint8Array(1024) }) as { buf: string };
      expect(result.buf).toBe('<binary 1024 bytes>');
    });

    it('renders Node Buffers compactly', () => {
      expect(redact(Buffer.from('hello'))).toBe('<binary 5 bytes>');
    });
  });

  describe('negative cases (normal data unchanged)', () => {
    it('leaves a plain log message with no credentials unchanged', () => {
      const input = 'FilterCacheManager loaded 42 filter options across 6 types';
      expect(redact(input)).toBe(input);
    });

    it('leaves an object with innocuous fields unchanged', () => {
      const input = { name: 'Rock', count: 42, enabled: true };
      const result = redact(input) as typeof input;
      expect(result.name).toBe('Rock');
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
    });

    it('leaves a URL without credentials unchanged', () => {
      const input = 'http://navidrome.local:4533/api/song?_start=0&_end=20';
      expect(redact(input)).toBe(input);
    });

    it('passes through null and undefined', () => {
      expect(redact(null)).toBeNull();
      expect(redact(undefined)).toBeUndefined();
    });

    it('passes through numbers and booleans', () => {
      expect(redact(42)).toBe(42);
      expect(redact(true)).toBe(true);
    });
  });
});

// stdout carries the MCP stdio protocol, so every log line must go to stderr.
describe('logger output channel', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes info to stderr (console.error), never stdout', async () => {
    const { logger } = await import('../../../src/utils/logger.js');
    logger.info('test info message');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[INFO]', 'test info message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('writes warn to stderr', async () => {
    const { logger } = await import('../../../src/utils/logger.js');
    logger.warn('test warn message');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN]', 'test warn message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('writes error to stderr', async () => {
    const { logger } = await import('../../../src/utils/logger.js');
    logger.error('test error message');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', 'test error message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('redacts credentials before writing to stderr', async () => {
    const { logger } = await import('../../../src/utils/logger.js');
    logger.error('fetch failed for https://admin:mypassword@host:4533/api');
    expect(consoleErrorSpy).toHaveBeenCalled();
    const written = consoleErrorSpy.mock.calls[0].join(' ');
    expect(written).not.toContain('mypassword');
    expect(written).toContain('<REDACTED>');
  });
});
