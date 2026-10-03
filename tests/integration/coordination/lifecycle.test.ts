/**
 * Navidrome MCP Server - Player lifecycle coordination tests
 * Copyright (C) 2025
 *
 * The IPC parent↔child link (spec lifecycle §B.1): a web player spawned by the
 * MCP server stops with it by default, or survives when persistAfterMcpExit is
 * on. We mimic the MCP server with a tiny harness (fixtures/ipc-parent.mjs) that
 * spawns navidrome-web over an IPC channel, then kill it to simulate MCP exit.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { isMpvAvailable } from '../../helpers/env-detection.js';
import {
  describeCoordination,
  healthz,
  killAllChildren,
  makeTempStore,
  mpvAlive,
  PLAYER_STARTUP_TIMEOUT_MS,
  randomPort,
  spawnIpcParent,
  spawnWeb,
  waitFor,
  waitForExit,
} from './helpers.js';

const NO_MPV = !isMpvAvailable();
const STOPPED_AFTER_MCP_EXIT = /spawning MCP exited during startup\. Standing down\.|navidrome-web shutting down \(mcp-exit\)/;

describeCoordination('player lifecycle (IPC parent link)', () => {
  afterEach(killAllChildren);

  it('persist OFF (default): the spawned player stops when its MCP exits', async () => {
    const port = randomPort();
    const parent = spawnIpcParent(makeTempStore(port, { persistAfterMcpExit: false }));

    expect(await waitFor(async () => (await healthz(port))?.app === 'navidrome-mcp-web')).toBe(true);

    parent.kill('SIGTERM'); // simulate the MCP server exiting → child `disconnect`
    expect(await waitFor(async () => (await healthz(port)) === null, { timeoutMs: 20000 })).toBe(true);
  });

  // The log line proves the child started and then stopped, which a free port alone cannot. A parent gone
  // before the bind makes the child stand down, and one gone after the bind makes it shut down.
  it('persist OFF: a player whose MCP exited during its startup does not keep running', async () => {
    const port = randomPort();
    const storePath = makeTempStore(port, { persistAfterMcpExit: false });
    const logPath = join(dirname(storePath), 'navidrome-web.log');
    spawnIpcParent(storePath, { exitAfterSpawn: true });

    const stopped = await waitFor(
      () => Promise.resolve(existsSync(logPath) && STOPPED_AFTER_MCP_EXIT.test(readFileSync(logPath, 'utf8'))),
      { timeoutMs: PLAYER_STARTUP_TIMEOUT_MS },
    );
    expect(stopped).toBe(true);
    expect(await waitFor(async () => (await healthz(port)) === null, { timeoutMs: 5000 })).toBe(true);
  });

  it('persist ON: the spawned player survives its MCP exiting', async () => {
    const port = randomPort();
    const parent = spawnIpcParent(makeTempStore(port, { persistAfterMcpExit: true }));

    expect(await waitFor(async () => (await healthz(port)) !== null)).toBe(true);

    parent.kill('SIGTERM');
    // Give the disconnect a moment; the player should ignore it and keep serving.
    expect(await waitFor(async () => (await healthz(port)) === null, { timeoutMs: 4000 })).toBe(false);
    expect((await healthz(port))?.app).toBe('navidrome-mcp-web');

    // Clean up the survivor via its own (loopback) power endpoint.
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
    await waitFor(async () => (await healthz(port)) === null, { timeoutMs: 6000 });
  });

  // A direct SIGTERM to the web owner after playback must quit mpv. The web
  // entry point's shutdown calls quitMpv(), which quits mpv over a one-shot socket.
  it.skipIf(NO_MPV)('a direct SIGTERM to the web owner quits mpv (after playback)', async () => {
    const port = randomPort();
    const owner = spawnWeb(makeTempStore(port));
    expect(await waitFor(async () => (await healthz(port)) !== null)).toBe(true);

    const list = (await (await fetch(`http://127.0.0.1:${port}/api/playlists`)).json()) as {
      playlists?: Array<{ id: string }>;
    };
    const id = list.playlists?.[0]?.id;
    if (id === undefined) {
      owner.kill('SIGKILL'); // empty library — nothing to play, skip the assertion
      return;
    }
    const post = (path: string, body: unknown): Promise<unknown> =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    await post('/api/library/play', { type: 'playlist', id, mode: 'replace' });
    await post('/api/controls/volume', { level: 0 }); // keep the test quiet
    expect(await waitFor(() => mpvAlive(), { timeoutMs: 10000 })).toBe(true);

    owner.kill('SIGTERM');
    // The invariant is that mpv quits on the way out, so the exit code is not asserted.
    await waitForExit(owner);
    expect(await waitFor(async () => !(await mpvAlive()), { timeoutMs: 15000 })).toBe(true);
  });
});
