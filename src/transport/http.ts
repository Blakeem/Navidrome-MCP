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
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { writeError, readJsonBody } from '../webui/http-helpers.js';
import { isLanReachable } from '../webui/network.js';
import { logger } from '../utils/logger.js';

/** The single HTTP path the MCP Streamable HTTP transport is served on. */
const MCP_PATH = '/mcp';

/** Unauthenticated liveness endpoint for container/orchestrator health checks. */
const HEALTH_PATH = '/healthz';

/**
 * Body cap for the MCP endpoint. Generous compared with the web UI's 16 KB
 * control routes, since a real tool call (e.g. `add_tracks_to_playlist` with
 * many ids) can be sizeable. Still bounded so a client can't make us buffer
 * arbitrary input. Bodies over this are rejected with 400.
 */
const MCP_MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Idle-session reaper tuning. A GET SSE stream that goes silent without a clean
 * TCP close (NAT timeout, client crash, network partition) would otherwise leave
 * its transport + Server resident in the sessions map forever, an unbounded
 * growth vector for a long-lived process serving many remote clients. Sessions
 * with no request activity for {@link SESSION_IDLE_TIMEOUT_MS} are closed on each
 * {@link SESSION_SWEEP_INTERVAL_MS} tick. The window is generous so a client
 * making periodic tool calls is never reaped mid-use.
 */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** JSON-RPC error codes, matching the SDK's own Streamable HTTP transport. */
const JSONRPC_PARSE_ERROR = -32_700;
const JSONRPC_INTERNAL_ERROR = -32_603;
const JSONRPC_SERVER_ERROR = -32_000;
const JSONRPC_SESSION_NOT_FOUND = -32_001;

/** A running HTTP transport: where clients connect, and how to stop it. */
export interface HttpTransport {
  url: string;
  close: () => Promise<void>;
}

interface HttpTransportOptions {
  host: string;
  port: number;
  /**
   * Optional bearer token. When set, every `/mcp` request must carry
   * `Authorization: Bearer <token>` (compared in constant time) or it is
   * rejected with 401 before reaching the transport. Left undefined, the
   * endpoint is unauthenticated, which is only safe on loopback or behind a
   * network policy / authenticating proxy. `/healthz` is never gated.
   */
  authToken?: string | undefined;
  /**
   * `Host` header values to accept, enforced whenever provided (the check
   * matches the literal `Host` header, e.g. `mcp.example.com:8080`).
   * When not provided, {@link resolveAllowedHosts} picks the posture.
   */
  allowedHosts?: string[] | undefined;
  /**
   * Allowed `Origin` header values (browser clients only). When set, requests
   * with a missing or non-listed Origin are rejected. Left unset, Origin is not
   * checked (non-browser MCP clients send none).
   */
  allowedOrigins?: string[] | undefined;
  /**
   * Builds a fresh, fully-configured MCP {@link Server} for a new session. The
   * Streamable HTTP transport is stateful, with one transport (and one Server)
   * per client session, so this is invoked once per `initialize`, sharing the
   * already-authenticated Navidrome client captured in the closure.
   */
  createMcpServer: () => Server;
}

/**
 * Start the MCP server over the Streamable HTTP transport (MCP spec
 * 2025-03-26). Unlike stdio, this binds a TCP socket so a long-lived process
 * (e.g. a container alongside Navidrome in a cluster) can serve remote MCP
 * clients directly, with no `supergateway`/`mcp-proxy` bridge.
 *
 * Stateful session model (the SDK's recommended pattern):
 *   - POST `/mcp` with an `initialize` request and NO session id → a new
 *     transport + Server are created and the response carries an
 *     `Mcp-Session-Id` header the client echoes on every later request.
 *   - POST/GET/DELETE `/mcp` with a known `Mcp-Session-Id` → routed to that
 *     session's transport (GET opens the SSE stream, DELETE terminates it).
 *   - Anything else → a JSON-RPC / HTTP error, leaving no orphaned session.
 *
 * Binding host comes from config (loopback by default, while `expose` or an
 * explicit host opt into network exposure). An optional bearer `authToken`
 * gates every `/mcp` request. Without one, front it with a reverse proxy or
 * network policy.
 */
export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransport> {
  const { host, port, authToken, allowedOrigins, createMcpServer } = options;

  // Assign synchronously with the listen resolution, since an empty list disables the SDK Host check.
  let allowedHosts: string[] = [];

  // Active sessions keyed by the SDK-generated session id. A transport removes
  // itself here on close (DELETE, client disconnect, or transport error) so the
  // map never leaks across reconnects.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Last-activity timestamp (ms epoch) per session, updated on every routed
  // request. The idle reaper below evicts sessions that fall silent so an
  // abandoned SSE stream can't pin its transport in memory indefinitely.
  const lastActivity = new Map<string, number>();

  const httpServer: HttpServer = createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The query string is stripped, and the path must equal /mcp exactly.
    const method = req.method ?? 'GET';
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

    const startedAt = Date.now();
    res.once('finish', () => {
      const sid = headerValue(req, 'mcp-session-id');
      // With no other auth the session id is the access token, so only a fingerprint is logged.
      const session = sid !== undefined ? ` [session ${sessionFingerprint(sid)}]` : '';
      const elapsed = Date.now() - startedAt;
      logger.info(`HTTP ${method} ${path} -> ${String(res.statusCode)} (${String(elapsed)}ms)${session}`);
    });

    if (path !== MCP_PATH) {
      writeError(res, 404, `Not found. The MCP endpoint is ${MCP_PATH}.`);
      return;
    }

    // The session id is the only other access control, so a bad token is rejected before any session lookup.
    if (authToken !== undefined && !isAuthorized(req, authToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      if (req.method === 'POST') {
        await handlePost(req, res);
      } else if (req.method === 'GET' || req.method === 'DELETE') {
        await handleSessionRequest(req, res);
      } else {
        writeJsonRpcError(res, 405, 'Method not allowed.', JSONRPC_SERVER_ERROR, { Allow: 'GET, POST, DELETE' });
      }
    } catch (err) {
      logger.error('HTTP transport request failed:', err);
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, 'Internal server error', JSONRPC_INTERNAL_ERROR);
      } else {
        res.end();
      }
    }
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A non-JSON essence lets a browser send this request without a CORS preflight.
    const contentType = headerValue(req, 'content-type') ?? '';
    const mediaType = (contentType.split(';')[0] ?? '').trim().toLowerCase();
    if (mediaType !== 'application/json') {
      writeJsonRpcError(res, 415, 'Unsupported Media Type: Content-Type must be application/json');
      return;
    }

    // Read the body ourselves so we can route on it (decide new-session vs.
    // existing-session) before handing it to the transport. The SDK accepts a
    // pre-parsed body as the third arg, so it does not re-read the stream.
    let body: unknown;
    try {
      body = await readJsonBody(req, MCP_MAX_BODY_BYTES);
    } catch {
      writeJsonRpcError(res, 400, 'Parse error: invalid or oversized request body', JSONRPC_PARSE_ERROR);
      return;
    }

    const sessionId = headerValue(req, 'mcp-session-id');
    if (sessionId !== undefined) {
      const existing = transports.get(sessionId);
      if (existing === undefined) {
        // A 404 tells the client the session ended, so it re-initializes.
        writeJsonRpcError(res, 404, 'Session not found', JSONRPC_SESSION_NOT_FOUND);
        return;
      }
      lastActivity.set(sessionId, Date.now());
      await existing.handleRequest(req, res, body);
      return;
    }

    // Only an `initialize` request may open a session.
    if (!isInitializeRequest(body)) {
      writeJsonRpcError(res, 400, 'Bad Request: no valid session ID provided');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: (): string => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts,
      ...(allowedOrigins !== undefined ? { allowedOrigins } : {}),
      onsessioninitialized: (sid): void => {
        transports.set(sid, transport);
        lastActivity.set(sid, Date.now());
        logger.debug(`MCP HTTP session initialized: ${sessionFingerprint(sid)}`);
      },
    });
    // Drop the session from the map when the transport closes (DELETE or
    // disconnect), so reconnecting clients don't accumulate dead entries.
    transport.onclose = (): void => {
      const sid = transport.sessionId;
      if (sid !== undefined) {
        lastActivity.delete(sid);
        if (transports.delete(sid)) {
          logger.debug(`MCP HTTP session closed: ${sessionFingerprint(sid)}`);
        }
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handleSessionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = headerValue(req, 'mcp-session-id');
    if (sessionId === undefined) {
      writeJsonRpcError(res, 400, 'Bad Request: no valid session ID provided');
      return;
    }
    const transport = transports.get(sessionId);
    if (transport === undefined) {
      writeJsonRpcError(res, 404, 'Session not found', JSONRPC_SESSION_NOT_FOUND);
      return;
    }
    lastActivity.set(sessionId, Date.now());
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolvePromise, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      resolvePromise();
    });
  });

  // The bound port differs from the requested one when `port: 0` asks the OS for an ephemeral port.
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  allowedHosts = resolveAllowedHosts(host, boundPort, authToken, options.allowedHosts ?? []);
  logger.debug(
    allowedHosts.length > 0
      ? `MCP HTTP Host filtering active: ${allowedHosts.join(', ')}`
      : 'MCP HTTP Host filtering off (bearer token set or non-loopback bind without allowedHosts)'
  );

  // Unref'd, since the listening server keeps the process alive and this only bounds how long dead sessions linger.
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [sid, ts] of lastActivity) {
      if (now - ts <= SESSION_IDLE_TIMEOUT_MS) continue;
      lastActivity.delete(sid);
      const transport = transports.get(sid);
      if (transport !== undefined) {
        logger.debug(`Reaping idle MCP HTTP session: ${sessionFingerprint(sid)}`);
        void transport.close(); // onclose removes it from `transports`
      } else {
        transports.delete(sid);
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  reaper.unref();

  const close = async (): Promise<void> => {
    // Stop the reaper first so it can't fire mid-teardown.
    clearInterval(reaper);
    // Close each transport before destroying sockets, or closeAllConnections()
    // drops in-flight responses. One bad session must not abort shutdown.
    await Promise.all(
      [...transports.values()].map((transport) =>
        transport.close().catch((err: unknown) => {
          logger.debug('Error closing MCP transport during shutdown:', err);
        }),
      ),
    );
    transports.clear();
    lastActivity.clear();
    // Terminate any remaining keep-alive sockets so server.close()'s callback
    // actually fires (an idle keep-alive socket would otherwise hold it open).
    httpServer.closeAllConnections();
    await new Promise<void>((resolvePromise) => {
      httpServer.close(() => resolvePromise());
    });
  };

  // A wildcard bind reports a loopback-friendly host.
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const url = `http://${displayHost}:${String(boundPort)}${MCP_PATH}`;
  return { url, close };
}

/**
 * Host-filtering posture for DNS-rebinding protection. An empty list disables the SDK Host check.
 * Operator hosts are enforced plus the local aliases. Without them, only an
 * unauthenticated loopback bind gets the loopback list, since a bearer token
 * already defeats rebinding and an exposed deployment cannot enumerate the
 * external names its clients send.
 */
export function resolveAllowedHosts(
  host: string,
  boundPort: number,
  authToken: string | undefined,
  operatorHosts: string[],
): string[] {
  const portStr = String(boundPort);
  const autoAllowList = [host, '127.0.0.1', 'localhost', '[::1]'].map((h) => `${h}:${portStr}`);
  const loopbackBind = !isLanReachable(host);

  if (operatorHosts.length > 0) {
    return [...new Set([...autoAllowList, ...operatorHosts])];
  }
  if (authToken === undefined && loopbackBind) {
    return [...new Set(autoAllowList)];
  }
  return [];
}

/**
 * Constant-time bearer check. Hashes both sides to a fixed-width digest first so
 * `timingSafeEqual` (which throws on length mismatch) is safe and the comparison
 * leaks neither the token length nor where it first differs.
 */
function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = headerValue(req, 'authorization');
  if (header === undefined) return false;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  const presented = match?.[1];
  if (presented === undefined) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

/**
 * A short, non-reversible fingerprint of a session id for logs, the first 8 hex
 * of its sha256. Enough to correlate a session's requests without writing the
 * (auth-equivalent) id itself to the log stream.
 */
function sessionFingerprint(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

/** Read a single header value as a string (collapsing the array form). */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Emit a JSON-RPC error envelope (what MCP clients expect) with an HTTP code. */
function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  message: string,
  code: number = JSONRPC_SERVER_ERROR,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, { ...extraHeaders, 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    })
  );
}
