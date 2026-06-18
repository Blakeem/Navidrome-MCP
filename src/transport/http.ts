/**
 * Navidrome MCP Server - Streamable HTTP transport
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

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { writeError, readJsonBody } from '../webui/http-helpers.js';
import { logger } from '../utils/logger.js';

/** The single HTTP path the MCP Streamable HTTP transport is served on. */
const MCP_PATH = '/mcp';

/** Unauthenticated liveness endpoint for container/orchestrator health checks. */
const HEALTH_PATH = '/healthz';

/** A running HTTP transport: where clients connect, and how to stop it. */
export interface HttpTransport {
  url: string;
  close: () => Promise<void>;
}

interface HttpTransportOptions {
  host: string;
  port: number;
  /**
   * Builds a fresh, fully-configured MCP {@link Server} for a new session. The
   * Streamable HTTP transport is stateful — one transport (and one Server) per
   * client session — so this is invoked once per `initialize`, sharing the
   * already-authenticated Navidrome client captured in the closure.
   */
  createMcpServer: () => Server;
}

/**
 * Start the MCP server over the Streamable HTTP transport (MCP spec
 * 2025-03-26). Unlike stdio, this binds a TCP socket so a long-lived process
 * (e.g. a container alongside Navidrome in a cluster) can serve remote MCP
 * clients directly — no `supergateway`/`mcp-proxy` bridge required.
 *
 * Stateful session model (the SDK's recommended pattern):
 *   - POST `/mcp` with an `initialize` request and NO session id → a new
 *     transport + Server are created and the response carries an
 *     `Mcp-Session-Id` header the client echoes on every later request.
 *   - POST/GET/DELETE `/mcp` with a known `Mcp-Session-Id` → routed to that
 *     session's transport (GET opens the SSE stream, DELETE terminates it).
 *   - Anything else → a JSON-RPC / HTTP error, leaving no orphaned session.
 *
 * Binding host comes from config (`0.0.0.0` by default for this transport, since
 * choosing HTTP is the opt-in to network exposure). There is no built-in auth —
 * front it with a reverse proxy / network policy.
 */
export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransport> {
  const { host, port, createMcpServer } = options;

  // Active sessions keyed by the SDK-generated session id. A transport removes
  // itself here on close (DELETE, client disconnect, or transport error) so the
  // map never leaks across reconnects.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer: HttpServer = createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // `/mcp` is the protocol endpoint; query strings are ignored. `req.url` is
    // always a path here (origin-form), so a prefix check on the pathname is
    // sufficient.
    const path = (req.url ?? '/').split('?')[0];

    if (path === HEALTH_PATH) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
      } else {
        writeError(res, 405, 'Method Not Allowed');
      }
      return;
    }

    if (path !== MCP_PATH) {
      writeError(res, 404, `Not found. The MCP endpoint is ${MCP_PATH}.`);
      return;
    }

    try {
      if (req.method === 'POST') {
        await handlePost(req, res);
      } else if (req.method === 'GET' || req.method === 'DELETE') {
        await handleSessionRequest(req, res);
      } else {
        writeError(res, 405, 'Method Not Allowed');
      }
    } catch (err) {
      logger.error('HTTP transport request failed:', err);
      if (!res.headersSent) {
        writeError(res, 500, 'Internal server error');
      } else {
        res.end();
      }
    }
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Read the body ourselves so we can route on it (decide new-session vs.
    // existing-session) before handing it to the transport. The SDK accepts a
    // pre-parsed body as the third arg, so it does not re-read the stream.
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      writeError(res, 400, 'Invalid or oversized request body');
      return;
    }

    const sessionId = headerValue(req, 'mcp-session-id');
    const existing = sessionId !== undefined ? transports.get(sessionId) : undefined;

    if (existing !== undefined) {
      await existing.handleRequest(req, res, body);
      return;
    }

    // No live session: only an `initialize` request may open one. Anything else
    // is a stale/unknown session id (or a non-init first message) and is
    // rejected per the spec rather than silently spawning a session.
    if (sessionId !== undefined || !isInitializeRequest(body)) {
      writeJsonRpcError(res, 400, 'Bad Request: no valid session ID provided');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: (): string => randomUUID(),
      onsessioninitialized: (sid): void => {
        transports.set(sid, transport);
        logger.debug(`MCP HTTP session initialized: ${sid}`);
      },
    });
    // Drop the session from the map when the transport closes (DELETE or
    // disconnect), so reconnecting clients don't accumulate dead entries.
    transport.onclose = (): void => {
      const sid = transport.sessionId;
      if (sid !== undefined && transports.delete(sid)) {
        logger.debug(`MCP HTTP session closed: ${sid}`);
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handleSessionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = headerValue(req, 'mcp-session-id');
    const transport = sessionId !== undefined ? transports.get(sessionId) : undefined;
    if (transport === undefined) {
      writeJsonRpcError(res, 400, 'Bad Request: no valid session ID provided');
      return;
    }
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolvePromise, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      resolvePromise();
    });
  });

  const close = (): Promise<void> =>
    new Promise<void>((resolvePromise) => {
      // Close each transport so in-flight SSE streams end and sessions clear,
      // then stop accepting connections. Terminate keep-alive sockets so
      // server.close()'s callback actually fires.
      for (const transport of transports.values()) {
        void transport.close();
      }
      transports.clear();
      httpServer.closeAllConnections();
      httpServer.close(() => resolvePromise());
    });

  // Read the actually-bound port from the socket — it differs from the
  // requested one when `port: 0` asks the OS for an ephemeral port (used by
  // tests). Report a loopback-friendly host when bound to a wildcard address.
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const url = `http://${displayHost}:${String(boundPort)}${MCP_PATH}`;
  return { url, close };
}

/** Read a single header value as a string (collapsing the array form). */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Emit a JSON-RPC error envelope (what MCP clients expect) with an HTTP code. */
function writeJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32_000, message },
      id: null,
    })
  );
}
