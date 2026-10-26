/**
 * Navidrome MCP Server - Web UI TLS loading and reload tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { X509Certificate } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../src/utils/logger.js';
import { isTlsEnabled, loadTlsPair, watchTlsPair } from '../../../src/webui/tls.js';
import { readPair, TLS_PAIR_A, TLS_PAIR_B, type TlsFixture } from '../../helpers/tls-fixtures.js';

function fingerprint(certPath: string): string {
  return new X509Certificate(readFileSync(certPath)).fingerprint256;
}

function servedFingerprint(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
      const served = socket.getPeerCertificate().fingerprint256;
      socket.end();
      resolve(served);
    });
    socket.on('error', reject);
  });
}

describe('isTlsEnabled', () => {
  it.each([
    [{ certPath: '/c.pem', keyPath: '/k.pem' }, true],
    [{ certPath: '/c.pem', keyPath: null }, false],
    [{ certPath: null, keyPath: null }, false],
  ])('reads %j as %s', (tls, expected) => {
    expect(isTlsEnabled(tls)).toBe(expected);
  });
});

describe('loadTlsPair', () => {
  it('returns the PEM contents of a matching pair', () => {
    expect(loadTlsPair(TLS_PAIR_A)).toEqual(readPair(TLS_PAIR_A));
  });

  it('names a missing certificate path and the read error', () => {
    const certPath = join(tmpdir(), 'nd-missing-cert.pem');
    expect(() => loadTlsPair({ certPath, keyPath: TLS_PAIR_A.keyPath })).toThrow(
      `Web UI TLS certificate ${certPath} is unreadable: ENOENT`,
    );
  });

  it('names a missing key path and the read error', () => {
    const keyPath = join(tmpdir(), 'nd-missing-key.pem');
    expect(() => loadTlsPair({ certPath: TLS_PAIR_A.certPath, keyPath })).toThrow(
      `Web UI TLS key ${keyPath} is unreadable: ENOENT`,
    );
  });

  it('names a certificate file that holds no certificate', () => {
    expect(() => loadTlsPair({ certPath: TLS_PAIR_A.keyPath, keyPath: TLS_PAIR_A.keyPath })).toThrow(
      `Web UI TLS certificate ${TLS_PAIR_A.keyPath} is invalid`,
    );
  });

  it('names a key file that holds no key', () => {
    expect(() => loadTlsPair({ certPath: TLS_PAIR_A.certPath, keyPath: TLS_PAIR_A.certPath })).toThrow(
      `Web UI TLS key ${TLS_PAIR_A.certPath} is invalid`,
    );
  });

  it('names both paths when the key does not match the certificate', () => {
    expect(() => loadTlsPair({ certPath: TLS_PAIR_A.certPath, keyPath: TLS_PAIR_B.keyPath })).toThrow(
      `Web UI TLS key ${TLS_PAIR_B.keyPath} does not match certificate ${TLS_PAIR_A.certPath}`,
    );
  });
});

describe('watchTlsPair', () => {
  let dir: string;
  let live: TlsFixture;
  let server: Server;
  let stopWatching: (() => void) | null = null;

  const install = (source: TlsFixture): void => {
    copyFileSync(source.certPath, live.certPath);
    copyFileSync(source.keyPath, live.keyPath);
  };

  // fs.watchFile takes its baseline stat on the threadpool, so a write that lands before that stat
  // is never reported. Each poll rewrites with a fresh mtime until one write follows the baseline.
  const rewrite = (sourcePath: string, livePath: string): void => {
    writeFileSync(livePath, readFileSync(sourcePath));
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nd-tls-'));
    live = { certPath: join(dir, 'cert.pem'), keyPath: join(dir, 'key.pem') };
    install(TLS_PAIR_A);
    server = createServer(readPair(live));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    stopWatching?.();
    stopWatching = null;
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves a renewed pair on new connections once both files change', async () => {
    const { port } = server.address() as AddressInfo;
    stopWatching = watchTlsPair(server, live, 20);

    await vi.waitFor(async () => {
      rewrite(TLS_PAIR_B.certPath, live.certPath);
      rewrite(TLS_PAIR_B.keyPath, live.keyPath);
      expect(await servedFingerprint(port)).toBe(fingerprint(TLS_PAIR_B.certPath));
    }, { timeout: 5000, interval: 50 });
  });

  it('keeps the current pair and warns when the files do not form a pair', async () => {
    const { port } = server.address() as AddressInfo;
    const warn = vi.spyOn(logger, 'warn');
    stopWatching = watchTlsPair(server, live, 20);

    await vi.waitFor(() => {
      rewrite(TLS_PAIR_B.keyPath, live.keyPath);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`does not match certificate ${live.certPath}`));
    }, { timeout: 5000, interval: 50 });
    expect(await servedFingerprint(port)).toBe(fingerprint(TLS_PAIR_A.certPath));
  });
});
