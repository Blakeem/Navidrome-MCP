/**
 * Navidrome MCP Server - Settings app HTTP server (loopback-only, on-demand)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSettingsRoute } from './routes.js';
import { isCrossOriginPost, isJsonContentType, setSecurityHeaders, writeError } from '../webui/http-helpers.js';
import { hasProxyForwardingHeader, isLoopbackHostHeader, isLoopbackPeer } from '../webui/loopback.js';
import { handleStatic } from '../webui/routes/static-files.js';
import { logger } from '../utils/logger.js';
import { assertArgon2Available } from '../utils/secrets.js';

const HOST = '127.0.0.1';

const PUBLIC_DIR: string = resolve(dirname(fileURLToPath(import.meta.url)), 'public');

interface ConfigServer {
  url: string;
  close: () => Promise<void>;
}

interface ConfigServerOptions {
  /**
   * The web player's setup mode sets this, since it may run without a terminal and has no power
   * button to stop an abandoned settings page.
   */
  idleTimeoutMs?: number;
  onIdleTimeout?: () => void;
}

/**
 * Settings carry credentials, so the server binds loopback and also checks each peer. An ephemeral
 * port never collides with the web player.
 */
export async function startConfigServer(options: ConfigServerOptions = {}): Promise<ConfigServer> {
  // A missing Argon2 blocks only a new admin password, so the page still opens and the save reports it.
  void assertArgon2Available().catch((err: unknown) => {
    logger.warn('settings Argon2 probe failed, so a new admin password cannot be saved:', err);
  });
  let idleTimer: NodeJS.Timeout | undefined;
  const server: Server = createServer((req, res) => {
    setSecurityHeaders(res);
    void handleRequest(req, res);
  });

  const close = (): Promise<void> =>
    new Promise<void>((resolvePromise) => {
      if (idleTimer) clearTimeout(idleTimer);
      // server.close() waits for in-flight requests, so an open request at Ctrl-C would hang
      // the close promise.
      server.closeAllConnections();
      server.close(() => resolvePromise());
    });

  // Unref'd, since the listening server keeps the process alive and this timer only bounds how
  // long an abandoned setup page lingers.
  const bumpIdle = (): void => {
    const ms = options.idleTimeoutMs;
    if (ms === undefined) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void close().then(() => options.onIdleTimeout?.());
    }, ms);
    idleTimer.unref();
  };

  server.on('request', bumpIdle);

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      server.removeListener('error', reject);
      resolvePromise();
    });
  });

  bumpIdle();

  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  const url = `http://${HOST}:${port}/`;

  return { url, close };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  if (!isLoopbackPeer(req) || hasProxyForwardingHeader(req)) {
    writeError(res, 403, 'Settings are local-only');
    return;
  }

  // A DNS-rebound attacker hostname still connects from loopback, so the Host header is checked.
  if (!isLoopbackHostHeader(req.headers.host)) {
    writeError(res, 403, 'Forbidden host');
    return;
  }

  if (method === 'POST' && isCrossOriginPost(req)) {
    writeError(res, 403, 'Cross-origin request refused');
    return;
  }

  // A cross-site page cannot send this header without a CORS preflight, which this server never
  // approves.
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
