/**
 * Navidrome MCP Server - Password hashing and secret comparison
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import * as nodeCrypto from 'node:crypto';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

interface Argon2Parameters {
  message: string | Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}

type Argon2 = (
  algorithm: 'argon2id',
  parameters: Argon2Parameters,
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void;

/** OWASP's Argon2id baseline: 19 MiB of memory, 2 passes, 1 lane. */
const HASH_PARAMETERS = { memory: 19456, passes: 2, parallelism: 1 } as const;
const NONCE_BYTES = 16;
const TAG_BYTES = 32;
const PHC_VERSION = 19;
const PHC_PATTERN = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
/** Bounds what a hand-edited hash can make one login cost. */
const MAX_VERIFY_MEMORY_KIB = 1024 * 1024;
const MAX_VERIFY_PASSES = 16;
const MAX_VERIFY_PARALLELISM = 16;
const ARGON2_UNSUPPORTED_CODE = 'ERR_CRYPTO_ARGON2_NOT_SUPPORTED';

/**
 * Looked up at run time, since `crypto.argon2` is absent before Node 24.7 and the installed
 * `@types/node` does not declare it.
 */
function loadArgon2(): Argon2 | null {
  const candidate: unknown = (nodeCrypto as Record<string, unknown>)['argon2'];
  return typeof candidate === 'function' ? (candidate as Argon2) : null;
}

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
}

/** Node's own message for an unsupported Argon2 does not say which OpenSSL is in use or which one is needed. */
function describeArgon2Error(err: Error): Error {
  if (errorCode(err) !== ARGON2_UNSUPPORTED_CODE) return err;
  return new Error(
    `Argon2 password hashing is unavailable (${ARGON2_UNSUPPORTED_CODE}). It needs OpenSSL 3.2 or later, ` +
    `and this Node.js uses OpenSSL ${process.versions.openssl}.`,
  );
}

function argon2id(parameters: Argon2Parameters): Promise<Buffer> {
  const argon2 = loadArgon2();
  if (argon2 === null) {
    return Promise.reject(new Error(`crypto.argon2 is missing from Node.js ${process.version}. Use Node.js 24.19.0 or later.`));
  }
  return new Promise((resolve, reject) => {
    argon2('argon2id', parameters, (err, derivedKey) => {
      if (err !== null) reject(describeArgon2Error(err));
      else resolve(derivedKey);
    });
  });
}

function toUnpaddedBase64(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(NONCE_BYTES);
  const tag = await argon2id({ message: password, nonce, tagLength: TAG_BYTES, ...HASH_PARAMETERS });
  const { memory, passes, parallelism } = HASH_PARAMETERS;
  return `$argon2id$v=${PHC_VERSION}$m=${memory},t=${passes},p=${parallelism}$${toUnpaddedBase64(nonce)}$${toUnpaddedBase64(tag)}`;
}

interface ParsedHash {
  memory: number;
  passes: number;
  parallelism: number;
  nonce: Buffer;
  tag: Buffer;
}

function parsePhcHash(hash: string): ParsedHash | null {
  const match = PHC_PATTERN.exec(hash);
  if (match === null) return null;
  const [, version = '', memory = '', passes = '', parallelism = '', nonce = '', tag = ''] = match;
  const parsed: ParsedHash = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    nonce: Buffer.from(nonce, 'base64'),
    tag: Buffer.from(tag, 'base64'),
  };
  const inBounds = Number(version) === PHC_VERSION &&
    parsed.memory <= MAX_VERIFY_MEMORY_KIB &&
    parsed.passes >= 1 && parsed.passes <= MAX_VERIFY_PASSES &&
    parsed.parallelism >= 1 && parsed.parallelism <= MAX_VERIFY_PARALLELISM &&
    parsed.memory >= 8 * parsed.parallelism &&
    parsed.nonce.length >= 8 && parsed.tag.length >= 4;
  return inBounds ? parsed : null;
}

export function isPasswordHash(hash: string): boolean {
  return parsePhcHash(hash) !== null;
}

/** The parameters come from the stored string, so a later raise of HASH_PARAMETERS keeps old hashes valid. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parsed = parsePhcHash(hash);
  if (parsed === null) return false;
  const tag = await argon2id({
    message: password,
    nonce: parsed.nonce,
    tagLength: parsed.tag.length,
    memory: parsed.memory,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
  });
  return timingSafeEqual(tag, parsed.tag);
}

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Equal-length digests keep `timingSafeEqual` from throwing on a length mismatch and hide the length. */
export function constantTimeEqual(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Argon2 needs OpenSSL 3.2 or later, which a Node.js built against an older system OpenSSL lacks. */
export async function assertArgon2Available(): Promise<void> {
  await argon2id({ message: 'probe', nonce: Buffer.alloc(8), tagLength: 4, memory: 8, passes: 1, parallelism: 1 });
}
