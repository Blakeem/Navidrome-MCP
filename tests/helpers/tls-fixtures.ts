/**
 * Navidrome MCP Server - TLS fixture paths for tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Self-signed P-256 pairs that expire in 2126, made with the openssl CLI, so no test depends on openssl
// being installed. Pairs A and B name localhost and 127.0.0.1. The public pair names only music.example.com.
const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/tls/', import.meta.url));

export interface TlsFixture {
  certPath: string;
  keyPath: string;
}

export const TLS_PAIR_A: TlsFixture = {
  certPath: join(FIXTURE_DIR, 'a-cert.pem'),
  keyPath: join(FIXTURE_DIR, 'a-key.pem'),
};

export const TLS_PAIR_B: TlsFixture = {
  certPath: join(FIXTURE_DIR, 'b-cert.pem'),
  keyPath: join(FIXTURE_DIR, 'b-key.pem'),
};

export const TLS_PAIR_PUBLIC: TlsFixture = {
  certPath: join(FIXTURE_DIR, 'public-cert.pem'),
  keyPath: join(FIXTURE_DIR, 'public-key.pem'),
};

export function readPair(pair: TlsFixture): { cert: Buffer; key: Buffer } {
  return { cert: readFileSync(pair.certPath), key: readFileSync(pair.keyPath) };
}
