/**
 * Navidrome MCP Server - Port-as-lock acquire/attach unit tests
 * Copyright (C) 2025
 *
 * Covers the acquire decision flow with injected probe + bind (the
 * multi-process coordination suite binds the real port under test:playback).
 * The probe verdict tests bind one ephemeral loopback server.
 */

import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AcquireDeps,
  type AcquireResult,
  type ProbeOutcome,
  type WebEndpoint,
  acquireOrAttach,
  probeHealthz,
  legacyOwnerScrobbles,
  probeWebOwner,
  webOwnerPresent,
} from '../../../src/web/acquire.js';
import { HEALTH_APP_ID } from '../../../src/webui/routes/health.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const config = makeTestConfig();

const noSavedEndpoint = (): WebEndpoint | null => null;

function loopback(port: number): WebEndpoint {
  return { port, host: '127.0.0.1' };
}

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

  async function serve(handler: RequestListener): Promise<number> {
    const server = createServer(handler);
    healthServer = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  function serveHealthz(body: unknown): Promise<number> {
    return serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  }

  async function legacyScrobbles(body: unknown): Promise<boolean> {
    const port = await serveHealthz(body);
    return legacyOwnerScrobbles(await probeWebOwner(loopback(port), noSavedEndpoint));
  }

  it('does not defer to an attached owner that claims scrobbles', async () => {
    expect(await legacyScrobbles({ app: HEALTH_APP_ID, playbackAttached: true, scrobbleClaims: true })).toBe(false);
  });

  it('defers to an attached owner older than scrobble claims', async () => {
    expect(await legacyScrobbles({ app: HEALTH_APP_ID, playbackAttached: true })).toBe(true);
  });

  it('defers to an owner older than the playbackAttached field', async () => {
    expect(await legacyScrobbles({ app: HEALTH_APP_ID })).toBe(true);
  });

  it('does not defer to an older owner whose engine is not attached', async () => {
    const port = await serveHealthz({ app: HEALTH_APP_ID, playbackAttached: false });

    expect(legacyOwnerScrobbles(await probeWebOwner(loopback(port), noSavedEndpoint))).toBe(false);
    expect(await webOwnerPresent(loopback(port), noSavedEndpoint)).toBe(true);
  });

  it('never defers to a foreign signature', async () => {
    expect(await legacyScrobbles({ app: 'something-else', playbackAttached: true })).toBe(false);
  });

  it.each(['0.0.0.0', '::'])('probes a wildcard bind host %s at loopback', async (bindHost) => {
    const port = await serveHealthz({ app: HEALTH_APP_ID, playbackAttached: false });

    expect(await probeHealthz(port, bindHost)).toBe('ours');
  });

  it('settles foreign for a listener that never answers', async () => {
    const port = await serve(() => {
      // Never responds, so only the probe timeout can settle.
    });

    expect(await probeHealthz(port, '127.0.0.1')).toBe('foreign');
  });

  // The stream never ends and never idles, so only the body size cap can settle it.
  it('settles foreign for a /healthz body that grows past the size cap', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const chunk = 'x'.repeat(1024);
      const timer = setInterval(() => { res.write(chunk); }, 20);
      res.on('close', () => { clearInterval(timer); });
    });

    expect(await probeHealthz(port, '127.0.0.1')).toBe('foreign');
  });
});

describe('startup and saved endpoint owner probe', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    const closing = servers.splice(0);
    await Promise.all(closing.map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    }));
  });

  async function serveHealthz(body: unknown): Promise<number> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  // A port that just closed refuses connections, which stands in for a powered-off player.
  async function refusedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  it('finds the owner on the saved endpoint when the startup endpoint refuses', async () => {
    const startupPort = await refusedPort();
    const savedPort = await serveHealthz({ app: HEALTH_APP_ID, playbackAttached: false });
    const readSaved = (): WebEndpoint => loopback(savedPort);

    expect(await probeWebOwner(loopback(startupPort), readSaved)).toEqual({
      outcome: 'ours',
      playbackAttached: false,
      scrobbleClaims: false,
      port: savedPort,
    });
    expect(await webOwnerPresent(loopback(startupPort), readSaved)).toBe(true);
  });

  it('does not read the saved endpoint when the startup endpoint answers as ours', async () => {
    const startupPort = await serveHealthz({ app: HEALTH_APP_ID, playbackAttached: true });
    const readSaved = vi.fn((): WebEndpoint | null => null);

    expect((await probeWebOwner(loopback(startupPort), readSaved)).outcome).toBe('ours');
    expect(readSaved).not.toHaveBeenCalled();
  });

  it('reports refused only when both endpoints refuse', async () => {
    const startupPort = await refusedPort();
    const savedPort = await refusedPort();

    const probe = await probeWebOwner(loopback(startupPort), () => loopback(savedPort));
    expect(probe.outcome).toBe('refused');
  });

  it('keeps the startup outcome when the saved endpoint is unreadable', async () => {
    const startupPort = await refusedPort();

    expect(await probeWebOwner(loopback(startupPort), noSavedEndpoint)).toEqual({
      outcome: 'refused',
      playbackAttached: false,
      scrobbleClaims: false,
      port: startupPort,
    });
  });

  it('keeps a foreign startup answer when the saved endpoint refuses', async () => {
    const startupPort = await serveHealthz({ app: 'something-else' });
    const savedPort = await refusedPort();

    const probe = await probeWebOwner(loopback(startupPort), () => loopback(savedPort));
    expect(probe).toMatchObject({ outcome: 'foreign', port: startupPort });
  });

  it('reports the saved endpoint as foreign when the startup endpoint refuses', async () => {
    const startupPort = await refusedPort();
    const savedPort = await serveHealthz({ app: 'something-else' });

    const probe = await probeWebOwner(loopback(startupPort), () => loopback(savedPort));
    expect(probe).toMatchObject({ outcome: 'foreign', port: savedPort });
  });
});
