/**
 * Navidrome MCP Server - Settings app HTTP server (loopback-only, on-demand)
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

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSettingsRoute } from './routes.js';
import { isJsonContentType, writeError } from '../webui/http-helpers.js';
import { isLoopbackHostHeader, isLoopbackPeer } from '../webui/loopback.js';
import { handleStatic } from '../webui/routes/static-files.js';
import { logger } from '../utils/logger.js';

const HOST = '127.0.0.1';

const PUBLIC_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), 'public');

/** A running settings server: where to point a browser, and how to stop it. */
interface ConfigServer {
  url: string;
  close: () => Promise<void>;
}

/** Per-host options. Kept local (not exported), since callers pass an object literal. */
interface ConfigServerOptions {
  /**
   * Self-reap after this many ms without a request. Setup-mode hosts set it because
   * they have no terminal or player power button to stop an abandoned settings page.
   */
  idleTimeoutMs?: number;
  /** Invoked after the idle timeout fires and the server has been closed. */
  onIdleTimeout?: () => void;
}

/**
 * Start the settings server on a loopback ephemeral port (127.0.0.1:0). The OS
 * assigns a free port so it never collides with the player web UI or anything
 * else. Settings are never exposed beyond loopback (a hard requirement, since they
 * carry credentials), enforced both by the bind host and a peer guard.
 */
export async function startConfigServer(options: ConfigServerOptions = {}): Promise<ConfigServer> {
  let idleTimer: NodeJS.Timeout | undefined;
  const server: Server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  const close = (): Promise<void> =>
    new Promise<void>((resolvePromise) => {
      if (idleTimer) clearTimeout(idleTimer);
      // Terminate in-flight connections (Node 18.2+) so server.close()'s
      // callback actually fires. Otherwise an open request at Ctrl-C would
      // keep the server alive and hang the close promise forever.
      server.closeAllConnections();
      server.close(() => resolvePromise());
    });

  // Arm (or reset) the inactivity reaper. No-op for hosts that didn't opt in.
  // Unref'd so the timer never keeps the process alive on its own. The listening
  // server does that, and this only bounds how long an abandoned setup page lingers.
  const bumpIdle = (): void => {
    const ms = options.idleTimeoutMs;
    if (ms === undefined) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void close().then(() => options.onIdleTimeout?.());
    }, ms);
    idleTimer.unref();
  };

  // A dedicated 'request' listener resets the clock on every request, alongside
  // (not entangled with) the main handler above.
  server.on('request', bumpIdle);

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      server.removeListener('error', reject);
      resolvePromise();
    });
  });

  bumpIdle(); // start the inactivity clock now that we're listening

  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  const url = `http://${HOST}:${port}/`;

  return { url, close };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  if (!isLoopbackPeer(req)) {
    writeError(res, 403, 'Settings are local-only');
    return;
  }

  // DNS-rebinding guard: a rebound attacker hostname still connects from loopback.
  if (!isLoopbackHostHeader(req.headers.host)) {
    writeError(res, 403, 'Forbidden host');
    return;
  }

  // A cross-site page cannot send this header without a CORS preflight, which this server never approves.
  if (method === 'POST' && !isJsonContentType(req.headers['content-type'])) {
    writeError(res, 415, 'Content-Type must be application/json');
    return;
  }

  try {
    if (await handleSettingsRoute(req, res, method, path)) return;

    if (method === 'GET') {
      await handleStatic(res, path, PUBLIC_DIR);
      return;
    }
    writeError(res, 404, 'Not found');
  } catch (err) {
    logger.error('config-app request failed:', err);
    if (!res.headersSent) writeError(res, 500, 'Internal error');
  }
}
