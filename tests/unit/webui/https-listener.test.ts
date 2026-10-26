/**
 * Navidrome MCP Server - Web UI HTTPS listener tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Server } from 'node:http';
import { request as httpsRequest, Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real watchers run, so the spies only record when the listener starts and stops them.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, watchFile: vi.fn(actual.watchFile), unwatchFile: vi.fn(actual.unwatchFile) };
});

import { unwatchFile, watchFile } from 'node:fs';
import type { Config } from '../../../src/config.js';
import { HEALTH_APP_ID } from '../../../src/webui/routes/health.js';
import { AuthService } from '../../../src/webui/auth/auth-service.js';
import { GuestQueue } from '../../../src/webui/jukebox/guest-queue.js';
import { createServer } from '../../../src/webui/server.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { TLS_PAIR_A } from '../../helpers/tls-fixtures.js';

interface Reply {
  status: number;
  body: string;
}

function tlsConfig(tls: Config['webui']['tls']): Config {
  const base = makeTestConfig();
  return makeTestConfig({ webui: { ...base.webui, tls } });
}

function makeServer(config: Config): Server {
  return createServer({
    config,
    client: {} as never,
    broadcaster: {} as never,
    visualizer: { addClient: vi.fn() },
    shutdown: () => undefined,
    leases: { open: () => undefined, close: () => undefined },
    auth: new AuthService(config),
    guests: new GuestQueue(),
  });
}

function send(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      { host: '127.0.0.1', port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers }, rejectUnauthorized: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

describe('web remote over HTTPS', () => {
  let server: Server | null = null;

  beforeEach(() => {
    vi.mocked(watchFile).mockClear();
    vi.mocked(unwatchFile).mockClear();
  });

  afterEach(async () => {
    const closing = server;
    server = null;
    if (closing?.listening !== true) return;
    closing.closeAllConnections();
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  });

  async function listen(config: Config): Promise<number> {
    server = makeServer(config);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  it('serves plain HTTP when no TLS pair is configured', () => {
    server = makeServer(makeTestConfig());

    expect(server).not.toBeInstanceOf(HttpsServer);
  });

  it('answers /healthz over HTTPS with the configured pair', async () => {
    const port = await listen(tlsConfig(TLS_PAIR_A));

    const reply = await send(port, 'GET', '/healthz');

    expect(server).toBeInstanceOf(HttpsServer);
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ app: HEALTH_APP_ID });
  });

  it('lists https URLs in network-info', async () => {
    const port = await listen(tlsConfig(TLS_PAIR_A));

    const reply = await send(port, 'GET', '/api/network-info');

    expect(JSON.parse(reply.body)).toMatchObject({ localhostUrl: 'https://127.0.0.1:8808/admin' });
  });

  it('accepts a POST whose Origin is its own https origin', async () => {
    const port = await listen(tlsConfig(TLS_PAIR_A));

    const reply = await send(port, 'POST', '/api/does-not-exist', {
      'Content-Type': 'application/json',
      Origin: `https://127.0.0.1:${port}`,
    });

    expect(reply.status).toBe(404);
  });

  it('refuses a POST whose Origin is the http origin of the same host and port', async () => {
    const port = await listen(tlsConfig(TLS_PAIR_A));

    const reply = await send(port, 'POST', '/api/does-not-exist', {
      'Content-Type': 'application/json',
      Origin: `http://127.0.0.1:${port}`,
    });

    expect(reply.status).toBe(403);
  });

  it('watches the pair only while bound', async () => {
    server = makeServer(tlsConfig(TLS_PAIR_A));
    expect(watchFile).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    expect(vi.mocked(watchFile).mock.calls.map((call) => call[0])).toEqual([TLS_PAIR_A.certPath, TLS_PAIR_A.keyPath]);

    const closing = server;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
    expect(vi.mocked(unwatchFile).mock.calls.map((call) => call[0])).toEqual([TLS_PAIR_A.certPath, TLS_PAIR_A.keyPath]);
  });

  it('fails to start, naming the path, when the certificate is missing', () => {
    const certPath = join(tmpdir(), 'nd-no-such-cert.pem');

    expect(() => makeServer(tlsConfig({ certPath, keyPath: TLS_PAIR_A.keyPath }))).toThrow(
      `Web UI TLS certificate ${certPath} is unreadable`,
    );
  });
});
