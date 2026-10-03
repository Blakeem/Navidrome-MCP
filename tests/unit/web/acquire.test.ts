/**
 * Navidrome MCP Server - Port-as-lock acquire/attach unit tests
 * Copyright (C) 2025
 *
 * Covers the acquire decision flow with injected probe + bind (the
 * multi-process coordination suite binds the real port under test:playback).
 * The probe verdict tests bind one ephemeral loopback server.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AcquireDeps,
  type AcquireResult,
  type ProbeOutcome,
  acquireOrAttach,
  probeHealthz,
  webOwnerPresent,
  webOwnerScrobbling,
} from '../../../src/web/acquire.js';
import { HEALTH_APP_ID } from '../../../src/webui/routes/health.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const config = makeTestConfig();

/** A throwaway object standing in for an http.Server — the injected `bind`
 * never touches it, so its identity is all that matters. */
function fakeServer(): Server {
  return { tag: 'fake-server' } as unknown as Server;
}

function deps(
  probeOutcomes: ProbeOutcome[],
  bindResult: 'ok' | 'eaddrinuse',
): AcquireDeps & { probeCalls: number; bindCalls: number } {
  let probeCalls = 0;
  let bindCalls = 0;
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async AcquireDeps.probe interface
    probe: async () => {
      const outcome = probeOutcomes[Math.min(probeCalls, probeOutcomes.length - 1)];
      probeCalls += 1;
      return outcome as ProbeOutcome;
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async AcquireDeps.bind interface
    bind: async () => {
      bindCalls += 1;
      return bindResult;
    },
    get probeCalls() {
      return probeCalls;
    },
    get bindCalls() {
      return bindCalls;
    },
  };
}

describe('acquireOrAttach', () => {
  it('attaches when a navidrome-web already owns the port (ours)', async () => {
    const d = deps(['ours'], 'ok');
    const make = vi.fn(fakeServer);
    const result: AcquireResult = await acquireOrAttach(config, make, d);

    expect(result.mode).toBe('attached');
    expect(result.url).toBe('http://127.0.0.1:8808');
    expect(make).not.toHaveBeenCalled(); // never builds a throwaway server
    expect(d.bindCalls).toBe(0);
  });

  it('becomes owner when the port is free (refused → bind ok)', async () => {
    const d = deps(['refused'], 'ok');
    const server = fakeServer();
    const result = await acquireOrAttach(config, () => server, d);

    expect(result.mode).toBe('owner');
    if (result.mode === 'owner') expect(result.server).toBe(server); // narrow the union
    expect(d.bindCalls).toBe(1);
  });

  it('throws a clear conflict when the port is foreign', async () => {
    const d = deps(['foreign'], 'ok');
    await expect(acquireOrAttach(config, fakeServer, d)).rejects.toThrow(/in use by another application/);
    expect(d.bindCalls).toBe(0);
  });

  it('attaches when it loses a bind race to one of ours (refused → EADDRINUSE → ours)', async () => {
    const d = deps(['refused', 'ours'], 'eaddrinuse');
    const result = await acquireOrAttach(config, fakeServer, d);

    expect(result.mode).toBe('attached');
    expect(d.bindCalls).toBe(1);
    expect(d.probeCalls).toBe(2); // re-probed after the race
  });

  it('throws when it loses a bind race to a foreign process', async () => {
    const d = deps(['refused', 'foreign'], 'eaddrinuse');
    await expect(acquireOrAttach(config, fakeServer, d)).rejects.toThrow(/in use by another application/);
  });

  it('probes at the configured bind host', async () => {
    const lanConfig = makeTestConfig({ webui: { ...config.webui, host: '192.168.1.10' } });
    const probe = vi.fn().mockResolvedValue('ours');
    await acquireOrAttach(lanConfig, fakeServer, { probe, bind: vi.fn() });

    expect(probe).toHaveBeenCalledWith(8808, '192.168.1.10');
  });
});

describe('/healthz probe verdicts', () => {
  let healthServer: Server | null = null;

  afterEach(async () => {
    const closing = healthServer;
    healthServer = null;
    if (closing === null) return;
    closing.closeAllConnections();
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  });

  async function serveHealthz(body: unknown): Promise<number> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    healthServer = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  it('reports a scrobbling owner when its engine is attached', async () => {
    const port = await serveHealthz({ app: HEALTH_APP_ID, playbackAttached: true });

    expect(await webOwnerScrobbling(port, '127.0.0.1')).toBe(true);
  });

  it('reports a present but non-scrobbling owner when its engine is not attached', async () => {
    const port = await serveHealthz({ app: HEALTH_APP_ID, playbackAttached: false });

    expect(await webOwnerScrobbling(port, '127.0.0.1')).toBe(false);
    expect(await webOwnerPresent(port, '127.0.0.1')).toBe(true);
  });

  it('reports an owner without the playbackAttached field as scrobbling', async () => {
    const port = await serveHealthz({ app: HEALTH_APP_ID });

    expect(await webOwnerScrobbling(port, '127.0.0.1')).toBe(true);
  });

  it('never reports a foreign signature as scrobbling', async () => {
    const port = await serveHealthz({ app: 'something-else', playbackAttached: true });

    expect(await webOwnerScrobbling(port, '127.0.0.1')).toBe(false);
  });

  it.each(['0.0.0.0', '::'])('probes a wildcard bind host %s at loopback', async (bindHost) => {
    const port = await serveHealthz({ app: HEALTH_APP_ID, playbackAttached: false });

    expect(await probeHealthz(port, bindHost)).toBe('ours');
  });
});
