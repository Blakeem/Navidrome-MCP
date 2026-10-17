/**
 * Navidrome MCP Server - MCP lease on the web player
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { request, type ClientRequest } from 'node:http';

import { logger } from '../utils/logger.js';
import { MCP_LEASE_PATH } from '../webui/routes/player.js';

/** Bounds how long a play waits for the player to count the lease before its mpv commands run. */
const LEASE_REGISTER_TIMEOUT_MS = 500;

let held: { port: number; req: ClientRequest } | null = null;

function release(req: ClientRequest): void {
  if (held?.req === req) held = null;
}

/**
 * A kept-open POST makes the player count this MCP, so it keeps playing after its spawner exits.
 * node:http, since undici's 300s body timeout would drop an idle lease made with fetch.
 */
export function holdOwnerLease(port: number): Promise<void> {
  if (held?.port === port) return Promise.resolve();
  held?.req.destroy();
  held = null;

  return new Promise<void>((resolve) => {
    // Ref'd so the bounded wait holds the event loop while the socket itself never does.
    const timer = setTimeout(resolve, LEASE_REGISTER_TIMEOUT_MS);
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };

    // webui binds only loopback or a wildcard, and both accept a loopback connection.
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: MCP_LEASE_PATH,
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': 2 },
      },
      (res) => {
        if (res.statusCode !== 200) {
          // A player older than the lease route answers 404 and keeps its old lifetime rule.
          logger.debug(`web player refused the MCP lease with HTTP ${String(res.statusCode)}`);
          release(req);
          res.resume();
        }
        res.on('error', () => release(req));
        res.on('close', () => release(req));
        settle();
      },
    );
    held = { port, req };
    req.on('socket', (socket) => socket.unref());
    req.on('error', (err) => {
      logger.debug(`web player lease failed: ${err.message}`);
      release(req);
      settle();
    });
    req.end('{}');
  });
}
