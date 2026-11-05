import { afterEach, describe, expect, it, vi } from 'vitest';
import * as nodeCrypto from 'node:crypto';

// A test swaps in a failing argon2, since an ESM namespace export cannot be spied on.
const argon2Override = vi.hoisted(() => ({ current: null as null | ((...args: unknown[]) => void) }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    argon2: (...args: unknown[]): void => {
      if (argon2Override.current !== null) argon2Override.current(...args);
      else (actual as unknown as { argon2: (...a: unknown[]) => void }).argon2(...args);
    },
  };
});
import {
  assertArgon2Available,
  constantTimeEqual,
  hashPassword,
  isPasswordHash,
  randomToken,
  sha256Hex,
  verifyPassword,
} from '../../../src/utils/secrets.js';

const PHC_SHAPE = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

afterEach(() => {
  argon2Override.current = null;
});

describe('hashPassword and verifyPassword', () => {
  it('stores an unpadded PHC string with the fixed parameters, a 16-byte nonce and a 32-byte tag', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(hash).toMatch(PHC_SHAPE);
    expect(isPasswordHash(hash)).toBe(true);
  });

  it('salts every hash, so one password never hashes the same twice', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });

  it('accepts the hashed password and refuses any other', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('verifies with the parameters the stored string names, so raised parameters keep old hashes valid', async () => {
    const nonce = Buffer.alloc(16, 7);
    // The installed @types/node predates crypto.argon2Sync.
    const { argon2Sync } = nodeCrypto as unknown as { argon2Sync: (algorithm: string, parameters: object) => Buffer };
    const tag = argon2Sync('argon2id', { message: 'older password', nonce, parallelism: 1, tagLength: 32, memory: 8192, passes: 1 });
    const unpadded = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');
    const olderHash = `$argon2id$v=19$m=8192,t=1,p=1$${unpadded(nonce)}$${unpadded(tag)}`;

    expect(await verifyPassword('older password', olderHash)).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['another algorithm', '$argon2i$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['another version', '$argon2id$v=16$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['a memory cost past the bound', '$argon2id$v=19$m=99999999,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['zero passes', '$argon2id$v=19$m=19456,t=0,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['a short nonce', '$argon2id$v=19$m=19456,t=2,p=1$AAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
  ])('refuses %s without hashing', async (_label, hash) => {
    expect(isPasswordHash(hash)).toBe(false);
    expect(await verifyPassword('anything at all', hash)).toBe(false);
  });
});

describe('token helpers', () => {
  it('randomToken returns base64url of the requested byte count', () => {
    const token = randomToken(32);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(32)).not.toBe(token);
  });

  it('sha256Hex returns the hex digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('constantTimeEqual compares strings of any length', () => {
    expect(constantTimeEqual('token-value', 'token-value')).toBe(true);
    expect(constantTimeEqual('token-value', 'token-valuf')).toBe(false);
    expect(constantTimeEqual('short', 'a much longer value')).toBe(false);
  });
});

describe('assertArgon2Available', () => {
  it('resolves on a Node.js with Argon2', async () => {
    await expect(assertArgon2Available()).resolves.toBeUndefined();
  });

  it.each([
    ['the probe', (): Promise<unknown> => assertArgon2Available()],
    ['a password hash', (): Promise<unknown> => hashPassword('correct horse battery')],
  ])('names the error code and the OpenSSL version when Argon2 is unsupported, for %s', async (_label, run) => {
    const unsupported = Object.assign(new Error('not supported'), { code: 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED' });
    argon2Override.current = (...args: unknown[]): void => {
      (args[2] as (err: Error) => void)(unsupported);
    };

    await expect(run()).rejects.toThrow(
      new RegExp(`ERR_CRYPTO_ARGON2_NOT_SUPPORTED.*OpenSSL ${process.versions.openssl.replace(/\./g, '\\.')}`),
    );
  });

  it('passes any other Argon2 failure through unchanged', async () => {
    const failure = Object.assign(new Error('out of memory'), { code: 'ERR_OTHER' });
    argon2Override.current = (...args: unknown[]): void => {
      (args[2] as (err: Error) => void)(failure);
    };

    await expect(assertArgon2Available()).rejects.toBe(failure);
  });
});
