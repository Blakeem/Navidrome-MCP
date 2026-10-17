/**
 * Navidrome MCP Server - Streamable HTTP transport
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { writeError, readJsonBody } from '../webui/http-helpers.js';
import { isLanReachable } from '../webui/network.js';
import { logger } from '../utils/logger.js';

const MCP_PATH = '/mcp';

/** Unauthenticated, so container and orchestrator health checks need no token. */
const HEALTH_PATH = '/healthz';

/** Above the web UI's 16 KB cap, since a tool call such as add_tracks_to_playlist has many IDs. */
const MCP_MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Only DELETE, shutdown, or this reaper closes a session, so a client that leaves without DELETE
 * would keep its transport and Server forever. A client making periodic calls stays in the window.
 */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** JSON-RPC error codes, matching the SDK's own Streamable HTTP transport. */
const JSONRPC_PARSE_ERROR = -32_700;
const JSONRPC_INTERNAL_ERROR = -32_603;
const JSONRPC_SERVER_ERROR = -32_000;
const JSONRPC_SESSION_NOT_FOUND = -32_001;

export interface HttpTransport {
  url: string;
  close: () => Promise<void>;
}

interface HttpTransportOptions {
  host: string;
  port: number;
  /**
   * Undefined leaves /mcp unauthenticated, which is safe only on loopback or behind a network
   * policy or an authenticating proxy.
   */
  authToken?: string | undefined;
  /** Matched against the literal Host header, port included, such as `mcp.example.com:8080`. */
  allowedHosts?: string[] | undefined;
  /** Unset skips the Origin check, since non-browser MCP clients send no Origin. */
  allowedOrigins?: string[] | undefined;
  /** Called once per `initialize`, since the stateful transport binds one Server per session. */
  createMcpServer: () => Server;
}

/**
 * Lets a long-lived process, such as a container beside Navidrome, serve remote MCP clients with
 * no supergateway or mcp-proxy bridge.
 */
export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransport> {
  const { host, port, authToken, allowedOrigins, createMcpServer } = options;

  // Assigned in the listen continuation, before any request runs, since this initial empty list
  // disables the SDK Host check.
  let allowedHosts: string[] = [];

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const lastActivity = new Map<string, number>();

  const httpServer: HttpServer = createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
      const session = sid !== undefined ? ` [session ${sessionFingerprint(sid)}]` : '';
      const elapsed = Date.now() - startedAt;
      logger.info(`HTTP ${method} ${path} -> ${String(res.statusCode)} (${String(elapsed)}ms)${session}`);
    });

    if (path !== MCP_PATH) {
      writeError(res, 404, `Not found. The MCP endpoint is ${MCP_PATH}.`);
      return;
    }

    // The session id is the only other access control, so a bad token is rejected before any
    // session lookup.
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

    // The body is parsed here to tell `initialize` from session traffic. The SDK takes it
    // pre-parsed, so the stream is read once.
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

  // Unref'd, since the listening server keeps the process alive and this only bounds how long dead
  // sessions linger.
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
    // server.close() waits for in-flight requests, so the remaining connections are dropped.
    httpServer.closeAllConnections();
    await new Promise<void>((resolvePromise) => {
      httpServer.close(() => resolvePromise());
    });
  };

  // A wildcard address is not connectable, so the URL names localhost.
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const url = `http://${displayHost}:${String(boundPort)}${MCP_PATH}`;
  return { url, close };
}

/**
 * An empty list disables the SDK Host check. Only an unauthenticated loopback bind gets a default
 * list, since a token defeats DNS rebinding and an exposed bind cannot know its Host names.
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
 * Equal-length digests keep `timingSafeEqual` from throwing on a length mismatch and hide the token
 * length.
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

/** With no other auth, the session id is the access token, so logs carry only this fingerprint. */
function sessionFingerprint(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** MCP clients parse errors on /mcp as JSON-RPC envelopes. */
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
