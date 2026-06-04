/**
 * Navidrome MCP Server - Player lifecycle coordination tests
 * Copyright (C) 2025
 *
 * The IPC parent↔child link (spec lifecycle §B.1): a web player spawned by the
 * MCP server stops with it by default, or survives when persistAfterMcpExit is
 * on. We mimic the MCP server with a tiny harness (fixtures/ipc-parent.mjs) that
 * spawns navidrome-web over an IPC channel, then kill it to simulate MCP exit.
 */

import { afterEach, expect, it } from 'vitest';

import { detectMpvBinary } from '../../../src/services/playback/mpv-process.js';
import {
  describeCoordination,
  healthz,
  killAllChildren,
  makeTempStore,
  mpvAlive,
  randomPort,
  spawnIpcParent,
  spawnWeb,
  waitFor,
  waitForExit,
} from './helpers.js';

const NO_MPV = detectMpvBinary() === null;

describeCoordination('player lifecycle (IPC parent link)', () => {
  afterEach(killAllChildren);

  it('persist OFF (default): the spawned player stops when its MCP exits', async () => {
    const port = randomPort();
    const parent = spawnIpcParent(makeTempStore(port, { persistAfterMcpExit: false }));

    expect(await waitFor(async () => (await healthz(port))?.app === 'navidrome-mcp-web')).toBe(true);

    parent.kill('SIGTERM'); // simulate the MCP server exiting → child `disconnect`
    expect(await waitFor(async () => (await healthz(port)) === null, { timeoutMs: 20000 })).toBe(true);
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
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST' }).catch(() => undefined);
    await waitFor(async () => (await healthz(port)) === null, { timeoutMs: 6000 });
  });

  // Regression for the shutdown race: the engine installs its OWN
  // release-on-signal handler on first play (which closes its IPC without
  // killing mpv). A direct SIGTERM to the web owner must still quit mpv — the
  // owner-quits-mpv invariant — which `quitMpv`'s one-shot socket guarantees.
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
    await post('/api/playlists/play', { playlistId: id, mode: 'replace' });
    await post('/api/controls/volume', { level: 0 }); // keep the test quiet
    expect(await waitFor(() => mpvAlive(), { timeoutMs: 10000 })).toBe(true);

    owner.kill('SIGTERM');
    // Exit code is incidental (0 via process.exit, 143/null when signal-terminated
    // after playback registered the engine's own handler). The invariant we assert
    // is that mpv was quit on the way out.
    await waitForExit(owner);
    expect(await waitFor(async () => !(await mpvAlive()), { timeoutMs: 15000 })).toBe(true);
  });
});
