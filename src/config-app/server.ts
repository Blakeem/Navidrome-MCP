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
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSettingsRoute } from './routes.js';
import { writeError } from '../webui/http-helpers.js';
import { logger } from '../utils/logger.js';

const HOST = '127.0.0.1';

/** A running settings server: where to point a browser, and how to stop it. */
interface ConfigServer {
  url: string;
  close: () => Promise<void>;
}

/** Per-host options. Kept local (not exported) — callers pass an object literal. */
interface ConfigServerOptions {
  /**
   * If set, the server self-reaps after this many milliseconds with no HTTP
   * activity. The idle clock is armed once it begins listening and resets on
   * every request (page load, Test connection, Save), so it fires only after the
   * user has genuinely stopped interacting — never mid-configuration, which is
   * always punctuated by requests. Setup-mode hosts (the standalone web player
   * launched before configuration) use this: they have no terminal to Ctrl-C and
   * no player UI/power button, so without it they'd linger forever if the user
   * walked away. The MCP server (config server is in-process, dies with its
   * client) and standalone `navidrome-config` (foreground, Ctrl-C) omit it.
   */
  idleTimeoutMs?: number;
  /** Invoked after the idle timeout fires and the server has been closed. */
  onIdleTimeout?: () => void;
}

/**
 * Start the settings server on a loopback ephemeral port (127.0.0.1:0). The OS
 * assigns a free port so it never collides with the player web UI or anything
 * else. Settings are never exposed beyond loopback (a hard requirement — they
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
      // callback actually fires — otherwise an open request at Ctrl-C would
      // keep the server alive and hang the close promise forever.
      server.closeAllConnections();
      server.close(() => resolvePromise());
    });

  // Arm (or reset) the inactivity reaper. No-op for hosts that didn't opt in.
  // Unref'd so the timer never keeps the process alive on its own — the listening
  // server does that; this only bounds how long an abandoned setup page lingers.
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
  if (!isLoopback(req)) {
    writeError(res, 403, 'Settings are local-only');
    return;
  }

  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  try {
    if (await handleSettingsRoute(req, res, method, path)) return;

    if (method === 'GET') {
      await serveStatic(res, path);
      return;
    }
    writeError(res, 404, 'Not found');
  } catch (err) {
    logger.error('config-app request failed:', err);
    if (!res.headersSent) writeError(res, 500, 'Internal error');
  }
}

/**
 * Loopback guard (defense-in-depth on top of the 127.0.0.1 bind). Accepts the
 * IPv4-mapped form `::ffff:127.0.0.1` too, which is what a dual-stack Linux host
 * presents for a local connection — a naive exact match would reject the user's
 * own browser.
 */
function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// ----- static assets (config-app/public) -----

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function resolvePublicDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = resolve(here, 'public');
  if (existsSync(sibling)) return sibling;
  return resolve(here, '..', 'public');
}

const PUBLIC_DIR: string = resolvePublicDir();

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const stripped = pathname.replace(/^\/+/, '');
  const rel = stripped === '' ? 'index.html' : normalize(stripped);
  const abs = join(PUBLIC_DIR, rel);
  // Containment inside PUBLIC_DIR is the authoritative traversal defense
  // (any `..` that escapes fails this); additionally refuse dotfiles.
  const contained = abs === PUBLIC_DIR || abs.startsWith(PUBLIC_DIR + sep);
  if (!contained || basename(abs).startsWith('.')) {
    writeError(res, 400, 'Invalid path');
    return;
  }

  try {
    const body = await readFile(abs);
    const dot = abs.lastIndexOf('.');
    const ext = dot === -1 ? '' : abs.slice(dot).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': body.byteLength.toString(),
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.end(body);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      writeError(res, 404, 'Not found');
      return;
    }
    throw err;
  }
}
