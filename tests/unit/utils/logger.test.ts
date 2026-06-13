/**
 * Navidrome MCP Server - logger redaction unit tests
 * Copyright (C) 2025
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { redact } from '../../../src/utils/logger.js';

// ---------------------------------------------------------------------------
// redact() — unit tests for each redaction pattern
// ---------------------------------------------------------------------------

describe('redact()', () => {
  // -------------------------------------------------------------------------
  // 1. Bearer token in a plain string
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 2. Authorization header in an object (e.g. serialized request headers)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 3. Password JSON field in a string
  // -------------------------------------------------------------------------
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
      // Bug-fix lock-in: pre-fix the regex required `"[^"]*"` (double-quoted
      // only), but Node's util.format serializes objects with single quotes —
      // `{ password: 'secret' }` stringifies to `{ password: 'secret' }`.
      // After the fix the regex accepts both quote styles AND unquoted.
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
      // Unrelated env vars survive
      expect(result).toContain('LOG_LEVEL=debug');
    });

    it('does not over-redact past the value boundary in JSON-flat strings', () => {
      const input = '{"username":"bob","password":"s3cr3t!","host":"localhost"}';
      const result = redact(input) as string;
      expect(result).not.toContain('s3cr3t!');
      // Following fields must survive intact.
      expect(result).toContain('"host":"localhost"');
    });

    it('redacts string-leaf values under sensitive keys in nested objects', () => {
      // Key-aware walker: a string leaf carries no key context for the regex
      // passes, so the walker redacts by key name. A `password` key with leaf
      // value `'myplaintextpwd'` is replaced with <REDACTED> regardless of type.
      const input = { config: { password: 'myplaintextpwd' } };
      const result = redact(input) as { config: { password: string } };
      expect(result.config.password).toBe('<REDACTED>');
    });

    it('passes through non-sensitive object keys unchanged', () => {
      // Only keys matching the sensitive-name set are redacted; ordinary keys
      // (even ones whose value happens to contain the word "password") survive.
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

  // -------------------------------------------------------------------------
  // 4. Subsonic auth params in a URL string
  // -------------------------------------------------------------------------
  describe('Subsonic auth param redaction', () => {
    it('strips u= and p= params from URL-like strings', () => {
      const input = 'Streaming URL: http://host:4533/rest/stream?id=abc&u=admin&p=pass123&v=1.16.1';
      const result = redact(input) as string;
      expect(result).not.toContain('p=pass123');
      expect(result).not.toContain('u=admin');
      expect(result).toContain('id=abc');
    });

    it('strips s=/t= salt+token params from raw (non-URL) strings', () => {
      // Bug-fix lock-in: pre-fix the regex was `[up]=` only, missing salt
      // (s=) and salted-MD5 token (t=) — the actual replay-credential pair
      // we send. Now `[upst]=` covers all four. This case feeds a string
      // fragment NOT parseable as a URL (e.g., embedded in JSON or stderr
      // mpv forwarding), so sanitizeFilename can't help — only the regex.
      const input = 'mpv stderr: requesting ?id=abc&u=user&t=hashtoken99&s=randomsalt&v=1.16.1 fragment';
      const result = redact(input) as string;
      expect(result).not.toContain('t=hashtoken99');
      expect(result).not.toContain('s=randomsalt');
      expect(result).not.toContain('u=user');
      // non-auth params survive
      expect(result).toContain('v=1.16.1');
      expect(result).toContain('id=abc');
    });

    it('sanitizeFilename strips s=/t= Subsonic params from well-formed URL strings', () => {
      const input = 'http://host:4533/rest/stream?id=abc&u=user&t=hashtoken&s=salt&v=1.16.1';
      const result = redact(input) as string;
      expect(result).not.toContain('t=hashtoken');
      expect(result).not.toContain('s=salt');
      // non-auth params survive
      expect(result).toContain('v=1.16.1');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Credentials embedded in URL (user:pass@host)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 6. JWT-shaped raw token
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 7. API key in env-var / JSON style
  // -------------------------------------------------------------------------
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

    it('does NOT over-redact past the value boundary in JSON-flat strings', () => {
      // Bug-fix lock-in: pre-fix the api-key regex used `\S+` which on a
      // JSON-flat string would gobble past the comma and redact unrelated
      // context. Post-fix uses bounded captures stopping at quote/comma/etc.
      const input = '{"apiKey":"lastfmkey12345","other":"x","method":"track.getSimilar"}';
      const result = redact(input) as string;
      expect(result).not.toContain('lastfmkey12345');
      // The unrelated fields after the apiKey value MUST survive.
      expect(result).toContain('"other":"x"');
      expect(result).toContain('"method":"track.getSimilar"');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Error object with credential in .message
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 9. Nested object (3 levels deep) with password field
  // -------------------------------------------------------------------------
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
      // Build a 6-level deep object. The leaf "shouldNotBeRedacted" string
      // is a non-credential value; the test claim is that beyond depth 5
      // the walker hands the subtree back by reference (un-redacted).
      // If we accidentally walk past 5, the leaf is still a plain string
      // that doesn't match any pattern, so we additionally embed an apparent
      // credential at depth 6 to prove the walker actually stopped.
      const deep = {
        a: { b: { c: { d: { e: { f: { token: 'Bearer abcdefghijklmnop' } } } } } },
      };
      const result = redact(deep) as typeof deep;
      // Depth-5 limit means the f.token at depth-6 IS NOT walked into and
      // therefore IS NOT redacted. If the walker were unbounded, this
      // assertion would flip (token would be 'Bearer <REDACTED>').
      expect(result.a.b.c.d.e.f.token).toBe('Bearer abcdefghijklmnop');
    });

    it('handles circular references without stack-overflow', () => {
      // Adversarial input: object referring to itself. The depth limit IS
      // the cycle guard — there's no WeakSet — so depth-5 stops the walk
      // before recursion blows the stack.
      const circular: Record<string, unknown> = { name: 'site' };
      circular['self'] = circular;
      // The fact that this returns rather than throwing/blowing the stack
      // is the test. The structure preservation is incidental.
      expect(() => redact(circular)).not.toThrow();
      const result = redact(circular) as Record<string, unknown>;
      expect(result['name']).toBe('site');
    });
  });

  // -------------------------------------------------------------------------
  // 10. Array of mixed records
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Negative cases — normal data must NOT be altered
  // -------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// logger output goes to stderr (not stdout) — MCP stdio safety
// ---------------------------------------------------------------------------

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
