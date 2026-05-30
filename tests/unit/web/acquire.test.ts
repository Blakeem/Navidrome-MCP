/**
 * Navidrome MCP Server - Port-as-lock acquire/attach unit tests
 * Copyright (C) 2025
 *
 * Covers the acquire decision flow (standalone-web spec §5.2) with injected
 * probe + bind, so no real sockets are bound (that's the multi-process
 * coordination suite's job under test:playback).
 */

import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import {
  type AcquireDeps,
  type AcquireResult,
  type ProbeOutcome,
  acquireOrAttach,
} from '../../../src/web/acquire.js';
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
    probe: async () => {
      const outcome = probeOutcomes[Math.min(probeCalls, probeOutcomes.length - 1)];
      probeCalls += 1;
      return outcome as ProbeOutcome;
    },
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
});
