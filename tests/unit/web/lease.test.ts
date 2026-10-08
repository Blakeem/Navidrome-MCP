/**
 * Navidrome MCP Server - MCP lease unit tests
 * Copyright (C) 2025
 *
 * The MCP side of the lease: one kept-open POST per player port, reopened after
 * the player drops it, and silent against an older or absent player.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { holdOwnerLease } from '../../../src/web/lease.js';
import { MCP_LEASE_PATH } from '../../../src/webui/routes/player.js';

interface SeenRequest {
  method: string | undefined;
  url: string | undefined;
  contentType: string | undefined;
  res: ServerResponse;
}

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function serve(answer: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, contentType: req.headers['content-type'], res });
    req.resume();
    answer(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, seen };
}

function holdOpen(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.flushHeaders();
}

describe('holdOwnerLease', () => {
  it('posts JSON to the lease route and keeps the connection open', async () => {
    const { port, seen } = await serve(holdOpen);

    await holdOwnerLease(port);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: MCP_LEASE_PATH, contentType: 'application/json' });
    expect(seen[0]?.res.writableEnded).toBe(false);
  });

  it('sends no second request while a lease on the same port is open', async () => {
    const { port, seen } = await serve(holdOpen);

    await holdOwnerLease(port);
    await holdOwnerLease(port);

    expect(seen).toHaveLength(1);
  });

  it('reopens the lease after the player drops it', async () => {
    const { port, seen } = await serve(holdOpen);
    await holdOwnerLease(port);

    seen[0]?.res.destroy();

    await vi.waitFor(async () => {
      await holdOwnerLease(port);
      expect(seen).toHaveLength(2);
    });
  });

  it('resolves against an older player that answers 404, and retries on the next call', async () => {
    const { port, seen } = await serve((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    await holdOwnerLease(port);
    await holdOwnerLease(port);

    expect(seen).toHaveLength(2);
  });

  it('resolves without throwing when no player listens', async () => {
    const { port } = await serve(holdOpen);
    const server = servers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));

    await expect(holdOwnerLease(port)).resolves.toBeUndefined();
  });
});
