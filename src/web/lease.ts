/**
 * Navidrome MCP Server - MCP lease on the web player
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
 * Holds one kept-open POST to the web player, so the player counts this MCP among its users and
 * keeps playing when the MCP that spawned it exits. The OS closes the socket when this process dies.
 * It uses node:http, since undici's 300s body timeout would drop an idle lease made with fetch.
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
