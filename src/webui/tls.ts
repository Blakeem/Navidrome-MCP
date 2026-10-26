/**
 * Navidrome MCP Server - Web UI TLS certificate loading
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import type { Server as HttpsServer } from 'node:https';
import { createSecureContext, type SecureContextOptions } from 'node:tls';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';

interface TlsPaths {
  certPath: string;
  keyPath: string;
}

interface TlsPair {
  cert: Buffer;
  key: Buffer;
}

export const TLS_MIN_VERSION = 'TLSv1.2';

// A renewal tool such as win-acme or certbot replaces the files, and an fs.watch handle can lose a
// replaced file, so the pair is polled.
const TLS_RELOAD_POLL_MS = 60_000;

export function isTlsEnabled(tls: Config['webui']['tls']): tls is TlsPaths {
  return tls.certPath !== null && tls.keyPath !== null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readPem(path: string, label: string): Buffer {
  try {
    return readFileSync(path);
  } catch (err) {
    throw new Error(`Web UI TLS ${label} ${path} is unreadable: ${errorMessage(err)}`);
  }
}

function checkContext(options: SecureContextOptions, failure: string): void {
  try {
    createSecureContext(options);
  } catch (err) {
    throw new Error(`${failure}: ${errorMessage(err)}`);
  }
}

/** Each file is checked alone first, so the error names the file at fault. */
export function loadTlsPair(paths: TlsPaths): TlsPair {
  const cert = readPem(paths.certPath, 'certificate');
  const key = readPem(paths.keyPath, 'key');
  checkContext({ cert }, `Web UI TLS certificate ${paths.certPath} is invalid`);
  checkContext({ key }, `Web UI TLS key ${paths.keyPath} is invalid`);
  checkContext({ cert, key }, `Web UI TLS key ${paths.keyPath} does not match certificate ${paths.certPath}`);
  return { cert, key };
}

/**
 * A renewal tool writes the two files one after the other, so a reload can see a mismatched pair.
 * That reload keeps the old context, and the change to the second file reloads again.
 */
export function watchTlsPair(server: HttpsServer, paths: TlsPaths, intervalMs: number = TLS_RELOAD_POLL_MS): () => void {
  const reload = (): void => {
    try {
      const pair = loadTlsPair(paths);
      server.setSecureContext({ minVersion: TLS_MIN_VERSION, ...pair });
      logger.info(`webui: loaded the renewed TLS certificate ${paths.certPath}`);
    } catch (err) {
      logger.warn(`webui: kept the current TLS certificate. ${errorMessage(err)}`);
    }
  };
  const options = { interval: intervalMs, persistent: false };
  watchFile(paths.certPath, options, reload);
  watchFile(paths.keyPath, options, reload);
  return () => {
    unwatchFile(paths.certPath, reload);
    unwatchFile(paths.keyPath, reload);
  };
}
