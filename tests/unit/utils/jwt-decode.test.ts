/**
 * Navidrome MCP Server - JWT Decoder unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Every malformed token must return null, so library scoping degrades instead of failing startup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwtPayload } from '../../../src/utils/jwt-decode.js';

/** decodeJwtPayload reads only the payload segment, so header and signature are placeholders. */
function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'sig';
  return `${header}.${body}.${sig}`;
}

function makeJwtRaw(payloadSegment: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  return `${header}.${payloadSegment}.sig`;
}

describe('decodeJwtPayload', () => {
  // logger.error writes through console.error, which would clutter the expected-failure output.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('happy path', () => {
    it('decodes a Navidrome-shaped JWT into typed claims', () => {
      // The claim set matches a live Navidrome /auth/login token.
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
      // atob throws on the base64url characters `-` and `_`, so the payload must encode to both.
      const payload = {
        uid: 'with-base64url-chars-_-_-_-id',
        sub: 'user',
        // Runs of `?` and `>` encode to `_` and `-` in base64url.
        note: '????>>>>~~~~====<<<<????>>>>',
      };
      const token = makeJwt(payload);

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
      expect(decodeJwtPayload(undefined as unknown as string)).toBeNull();
      expect(decodeJwtPayload(null as unknown as string)).toBeNull();
      expect(decodeJwtPayload(123 as unknown as string)).toBeNull();
    });
  });

  describe('payload-content failures (return null, log error)', () => {
    it('returns null when the payload is not valid JSON', () => {
      const garbage = Buffer.from('this is not json at all').toString('base64url');
      const token = makeJwtRaw(garbage);
      expect(decodeJwtPayload(token)).toBeNull();
    });

    it('returns null when the payload is truncated mid-JSON', () => {
      const truncated = Buffer.from('{"uid": "abc", "sub": "us').toString('base64url');
      const token = makeJwtRaw(truncated);
      expect(decodeJwtPayload(token)).toBeNull();
    });

    it('returns null when the decoded payload is a JSON array (not an object)', () => {
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
      const token = makeJwt({
        uid: 'valid-uid',
        sub: 12345,
        iss: ['ND'],
        adm: 'yes',
        exp: '1778624205',
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
