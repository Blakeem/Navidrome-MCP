/**
 * Navidrome MCP Server - JWT Decoder unit tests
 * Copyright (C) 2025
 *
 * Locks in the safer-decode behavior introduced as the fix for the
 * `library-manager.ts:107-122` finding in `03-core-infra-deep-review.md`:
 *   - Buffer base64url (NOT atob) so `_`/`-` characters decode correctly.
 *   - Guarded JSON.parse so a malformed payload doesn't crash startup.
 *   - Shape validation (`uid` must be a non-empty string) so callers get a
 *     single null contract instead of `undefined`-everywhere bugs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwtPayload } from '../../../src/utils/jwt-decode.js';

/**
 * Build a JWT-shaped string with the given payload object. The header and
 * signature segments are dummy bytes — `decodeJwtPayload` only reads the
 * middle segment, so signature validity is irrelevant.
 */
function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'sig'; // not validated
  return `${header}.${body}.${sig}`;
}

/** Build a JWT with a raw (already-base64url-encoded) payload segment. */
function makeJwtRaw(payloadSegment: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  return `${header}.${payloadSegment}.sig`;
}

describe('decodeJwtPayload', () => {
  // Suppress logger.error noise during expected-failure tests; the redaction
  // path writes to stderr which clutters test output.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('happy path', () => {
    it('decodes a Navidrome-shaped JWT into typed claims', () => {
      // Mirrors the live shape captured from /auth/login:
      //   { adm, exp, iat, iss, sub, uid }
      const payload = {
        adm: true,
        exp: 1778624205,
        iat: 1778451405,
        iss: 'ND',
        sub: 'claude',
        uid: 'GBpo4XJPKjE0i3Qak6i74x',
      };
      const token = makeJwt(payload);

      const result = decodeJwtPayload(token);

      expect(result).not.toBeNull();
      expect(result?.uid).toBe('GBpo4XJPKjE0i3Qak6i74x');
      expect(result?.sub).toBe('claude');
      expect(result?.iss).toBe('ND');
      expect(result?.adm).toBe(true);
      expect(result?.exp).toBe(1778624205);
      expect(result?.iat).toBe(1778451405);
    });

    it('decodes a payload that contains base64url-distinguishing chars (`_` and `-`)', () => {
      // Regression for the original `atob` bug: classic base64 alphabet uses
      // `+/`, base64url uses `-_`. Feeding base64url into atob mishandles
      // `_` (atob sees it as an invalid char and throws OR the result is
      // garbage depending on the runtime). We need to prove our decoder
      // tolerates it.
      //
      // Crafted so the encoded payload provably contains both `-` and `_`
      // — JSON keys + a long padding string trip the alphabet difference.
      const payload = {
        uid: 'with-base64url-chars-_-_-_-id',
        sub: 'user',
        // Pad the JSON so the base64url output is long enough to hit
        // alphabet distinctions; the exact bytes don't matter.
        note: '????>>>>~~~~====<<<<????>>>>',
      };
      const token = makeJwt(payload);

      // Sanity: confirm the encoded segment actually contains `_` or `-`
      // (otherwise the test isn't testing what it claims).
      const middle = token.split('.')[1]!;
      expect(/[_-]/.test(middle)).toBe(true);

      const result = decodeJwtPayload(token);
      expect(result).not.toBeNull();
      expect(result?.uid).toBe('with-base64url-chars-_-_-_-id');
    });
  });

  describe('structural failures (return null, log error)', () => {
    it('returns null for an empty token', () => {
      expect(decodeJwtPayload('')).toBeNull();
    });

    it('returns null for a token with the wrong number of segments', () => {
      expect(decodeJwtPayload('only.two')).toBeNull();
      expect(decodeJwtPayload('one')).toBeNull();
      expect(decodeJwtPayload('a.b.c.d')).toBeNull();
    });

    it('returns null when the payload segment is empty', () => {
      expect(decodeJwtPayload('header..sig')).toBeNull();
    });

    it('returns null for a non-string token (defensive type check)', () => {
      // Real callers pass strings, but the decoder must not crash if a
      // future caller passes through unknown data.
      expect(decodeJwtPayload(undefined as unknown as string)).toBeNull();
      expect(decodeJwtPayload(null as unknown as string)).toBeNull();
      expect(decodeJwtPayload(123 as unknown as string)).toBeNull();
    });
  });

  describe('payload-content failures (return null, log error)', () => {
    it('returns null when the payload is not valid JSON', () => {
      // base64url-encode some non-JSON bytes
      const garbage = Buffer.from('this is not json at all').toString('base64url');
      const token = makeJwtRaw(garbage);
      expect(decodeJwtPayload(token)).toBeNull();
    });

    it('returns null when the payload is truncated mid-JSON', () => {
      // Encode a truncated JSON string — JSON.parse throws SyntaxError.
      const truncated = Buffer.from('{"uid": "abc", "sub": "us').toString('base64url');
      const token = makeJwtRaw(truncated);
      expect(decodeJwtPayload(token)).toBeNull();
    });

    it('returns null when the decoded payload is a JSON array (not an object)', () => {
      // `JSON.parse('[1,2,3]')` succeeds but the shape check rejects it.
      const arrayPayload = Buffer.from('[1,2,3]').toString('base64url');
      const token = makeJwtRaw(arrayPayload);
      expect(decodeJwtPayload(token)).toBeNull();
    });

    it('returns null when the decoded payload is JSON null', () => {
      const nullPayload = Buffer.from('null').toString('base64url');
      const token = makeJwtRaw(nullPayload);
      expect(decodeJwtPayload(token)).toBeNull();
    });
  });

  describe('claim-shape failures (return null, log error)', () => {
    it('returns null when `uid` is missing entirely', () => {
      const token = makeJwt({ sub: 'user', exp: 123 });
      expect(decodeJwtPayload(token)).toBeNull();
    });

    it('returns null when `uid` is a non-string type', () => {
      expect(decodeJwtPayload(makeJwt({ uid: 12345 }))).toBeNull();
      expect(decodeJwtPayload(makeJwt({ uid: null }))).toBeNull();
      expect(decodeJwtPayload(makeJwt({ uid: { nested: 'x' } }))).toBeNull();
    });

    it('returns null when `uid` is an empty string', () => {
      expect(decodeJwtPayload(makeJwt({ uid: '' }))).toBeNull();
    });
  });

  describe('optional-claim narrowing', () => {
    it('omits `sub`/`iss`/etc. from the result when they are wrong type', () => {
      // Wrong types for optional claims should not throw and should not
      // poison the typed result — they're simply absent.
      const token = makeJwt({
        uid: 'valid-uid',
        sub: 12345, // wrong type
        iss: ['ND'], // wrong type
        adm: 'yes', // wrong type
        exp: '1778624205', // wrong type (string, not number)
      });
      const result = decodeJwtPayload(token);
      expect(result?.uid).toBe('valid-uid');
      expect(result?.sub).toBeUndefined();
      expect(result?.iss).toBeUndefined();
      expect(result?.adm).toBeUndefined();
      expect(result?.exp).toBeUndefined();
    });

    it('returns just `uid` when no other claims are present', () => {
      const result = decodeJwtPayload(makeJwt({ uid: 'minimal' }));
      expect(result).toEqual({ uid: 'minimal' });
    });
  });
});
