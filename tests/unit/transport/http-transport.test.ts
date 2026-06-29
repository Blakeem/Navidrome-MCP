/**
 * Tests for the Streamable HTTP transport.
 *
 * Spins up the real `startHttpTransport` server on an ephemeral loopback port,
 * then drives it with the official MCP SDK client over Streamable HTTP so we
 * exercise the genuine session handshake, tool invocation, routing, and
 * teardown — not a mock of any of them. No mpv or Navidrome needed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { request as httpRequest } from 'node:http';
import { startHttpTransport, type HttpTransport } from '../../../src/transport/http.js';

/**
 * Build a tiny MCP server exposing a single `ping` tool, fresh per session.
 * Uses the low-level `Server` + manual JSON-schema handlers exactly like the
 * real app's `registerTools` does — deliberately avoiding the high-level
 * `McpServer` zod integration, which is incompatible with this project's Zod 4.
 */
function makeServer(): Server {
  const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'ping',
        description: 'returns pong',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const name = String((request.params.arguments as { name?: unknown }).name);
    return { content: [{ type: 'text', text: `pong:${name}` }] };
  });
  return server;
}

/** Parse `http://host:port/mcp` back into a URL for the client transport. */
function endpoint(handle: HttpTransport): URL {
  return new URL(handle.url);
}

/**
 * POST an MCP `initialize` to `/mcp` with an explicit `Host` header — `fetch`
 * forbids overriding Host, so we go through the low-level http client to exercise
 * DNS-rebinding protection. Resolves with the response status.
 */
function postInitWithHost(handle: HttpTransport, hostHeader: string): Promise<number> {
  const url = endpoint(handle);
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
  });
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: '/mcp',
        method: 'POST',
        headers: {
          Host: hostHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('Streamable HTTP transport', () => {
  let handle: HttpTransport;

  beforeEach(async () => {
    handle = await startHttpTransport({
      host: '127.0.0.1',
      // Port 0 → OS assigns a free ephemeral port, avoiding collisions.
      port: 0,
      createMcpServer: () => makeServer(),
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it('reports a loopback URL on the /mcp path', () => {
    const url = endpoint(handle);
    expect(url.pathname).toBe('/mcp');
    expect(url.hostname).toBe('127.0.0.1');
    expect(Number(url.port)).toBeGreaterThan(0);
  });

  it('completes the initialize handshake and lists tools', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(endpoint(handle)));
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('ping');
    } finally {
      await client.close();
    }
  });

  it('routes a tool call through the established session', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(endpoint(handle)));
    try {
      const result = await client.callTool({ name: 'ping', arguments: { name: 'world' } });
      expect(result.content).toEqual([{ type: 'text', text: 'pong:world' }]);
    } finally {
      await client.close();
    }
  });

  it('isolates concurrent clients into separate sessions', async () => {
    const a = new Client({ name: 'a', version: '0.0.0' });
    const b = new Client({ name: 'b', version: '0.0.0' });
    await a.connect(new StreamableHTTPClientTransport(endpoint(handle)));
    await b.connect(new StreamableHTTPClientTransport(endpoint(handle)));
    try {
      const [ra, rb] = await Promise.all([
        a.callTool({ name: 'ping', arguments: { name: 'a' } }),
        b.callTool({ name: 'ping', arguments: { name: 'b' } }),
      ]);
      expect(ra.content).toEqual([{ type: 'text', text: 'pong:a' }]);
      expect(rb.content).toEqual([{ type: 'text', text: 'pong:b' }]);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('rejects a POST with an unknown session id', async () => {
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': 'does-not-exist',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/session/i);
  });

  it('404s on a non-MCP path', async () => {
    const base = endpoint(handle);
    const res = await fetch(`http://${base.host}/nope`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('serves a 200 health check at /healthz', async () => {
    const base = endpoint(handle);
    const res = await fetch(`http://${base.host}/healthz`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rejects a non-GET method on /healthz', async () => {
    const base = endpoint(handle);
    const res = await fetch(`http://${base.host}/healthz`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('Streamable HTTP transport — DNS-rebinding protection', () => {
  it('rejects a request with a foreign Host header (403)', async () => {
    const handle = await startHttpTransport({
      host: '127.0.0.1',
      port: 0,
      createMcpServer: () => makeServer(),
    });
    try {
      expect(await postInitWithHost(handle, 'evil.example.com:1234')).toBe(403);
    } finally {
      await handle.close();
    }
  });

  it('accepts the bound loopback host automatically', async () => {
    const handle = await startHttpTransport({
      host: '127.0.0.1',
      port: 0,
      createMcpServer: () => makeServer(),
    });
    try {
      const port = endpoint(handle).port;
      expect(await postInitWithHost(handle, `127.0.0.1:${port}`)).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('accepts an operator-configured external host', async () => {
    const handle = await startHttpTransport({
      host: '127.0.0.1',
      port: 0,
      allowedHosts: ['mcp.example.com:8080'],
      createMcpServer: () => makeServer(),
    });
    try {
      expect(await postInitWithHost(handle, 'mcp.example.com:8080')).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

describe('Streamable HTTP transport — bearer auth', () => {
  const TOKEN = 'super-secret-token';
  let handle: HttpTransport;

  beforeEach(async () => {
    handle = await startHttpTransport({
      host: '127.0.0.1',
      port: 0,
      authToken: TOKEN,
      createMcpServer: () => makeServer(),
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  const initBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'c', version: '0' } },
  });
  const headers = (auth?: string): Record<string, string> => ({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(auth !== undefined ? { Authorization: auth } : {}),
  });

  it('rejects a request with no Authorization header (401)', async () => {
    const res = await fetch(handle.url, { method: 'POST', headers: headers(), body: initBody });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/bearer/i);
  });

  it('rejects a wrong bearer token (401)', async () => {
    const res = await fetch(handle.url, {
      method: 'POST',
      headers: headers('Bearer not-the-token'),
      body: initBody,
    });
    expect(res.status).toBe(401);
  });

  it('accepts the correct bearer token and completes the handshake', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(endpoint(handle), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('ping');
    } finally {
      await client.close();
    }
  });

  it('never gates /healthz behind the token', async () => {
    const base = endpoint(handle);
    const res = await fetch(`http://${base.host}/healthz`, { method: 'GET' });
    expect(res.status).toBe(200);
  });
});
