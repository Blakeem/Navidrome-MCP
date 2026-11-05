/**
 * Navidrome MCP Server - Port-as-lock coordination tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Exactly one navidrome-web owns the configured port, and every other instance stands down.
 */

import { createServer as createHttpServer } from 'node:http';
import { afterEach, expect } from 'vitest';

import {
  describeCoordination,
  healthz,
  killAllChildren,
  makeTempStore,
  randomPort,
  spawnWeb,
  waitFor,
  waitForExit,
} from './helpers.js';

describeCoordination('port-as-lock', () => {
  afterEach(killAllChildren);

  it('a single navidrome-web becomes the port owner and serves /healthz', async () => {
    const port = randomPort();
    spawnWeb(makeTempStore(port));

    const up = await waitFor(async () => (await healthz(port))?.app === 'navidrome-mcp-web');
    expect(up).toBe(true);
  });

  it('a second instance attaches (stands down) and exits 0 without double-binding', async () => {
    const port = randomPort();
    const store = makeTempStore(port);

    const owner = spawnWeb(store);
    expect(await waitFor(async () => (await healthz(port)) !== null)).toBe(true);

    const second = spawnWeb(store);
    const code = await waitForExit(second);

    expect(code).toBe(0);
    expect((await healthz(port))?.app).toBe('navidrome-mcp-web');
    expect(owner.exitCode).toBeNull();
  });

  it('refuses to bind when the port is held by a foreign process', async () => {
    const port = randomPort();
    const store = makeTempStore(port);

    const squatter = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"app":"something-else"}');
    });
    await new Promise<void>((resolve) => squatter.listen(port, '127.0.0.1', resolve));

    try {
      const child = spawnWeb(store);
      const code = await waitForExit(child);
      expect(code).toBe(1); // A foreign owner makes startup throw, and main() exits 1 on that.

      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(((await res.json()) as { app?: string }).app).toBe('something-else');
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });

  it('the port owner shuts down on SIGTERM when idle, releasing the port', async () => {
    const port = randomPort();
    const owner = spawnWeb(makeTempStore(port));
    expect(await waitFor(async () => (await healthz(port)) !== null)).toBe(true);

    owner.kill('SIGTERM');
    // The invariant is the released port. The exit code is 0 or a signal, so it is not asserted.
    await waitForExit(owner);
    expect(await waitFor(async () => (await healthz(port)) === null, { timeoutMs: 15000 })).toBe(true);
  });
});
