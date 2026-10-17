/**
 * Navidrome MCP Server - respawn-on-play tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ensureWebForPlayback probes on every call, so a player powered off mid-session comes back on
// the next play.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeOutcome, WebOwnerProbe } from '../../../src/web/acquire.js';
import { ensureWebForPlayback, type RespawnDeps } from '../../../src/web/spawn.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const playbackEnabled = makeTestConfig({ features: { playback: true } });

function ownerProbe(outcome: ProbeOutcome): WebOwnerProbe {
  return { outcome, playbackAttached: true, scrobbleClaims: true, port: playbackEnabled.webui.port };
}

function makeDeps(probeOutcome: ProbeOutcome): RespawnDeps & {
  probe: ReturnType<typeof vi.fn>;
  spawn: ReturnType<typeof vi.fn>;
  lease: ReturnType<typeof vi.fn>;
} {
  return {
    probe: vi.fn().mockResolvedValue(ownerProbe(probeOutcome)),
    spawn: vi.fn().mockReturnValue('spawned'),
    lease: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ensureWebForPlayback (respawn-on-play)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns the player when the port is refused (player was powered off)', async () => {
    const deps = makeDeps('refused');
    const status = await ensureWebForPlayback(playbackEnabled, deps);

    expect(deps.probe).toHaveBeenCalledWith(playbackEnabled.webui);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(status).toBe('spawned');
  });

  it('does NOT spawn when a player already owns the port', async () => {
    const deps = makeDeps('ours');
    const status = await ensureWebForPlayback(playbackEnabled, deps);

    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.lease).toHaveBeenCalledWith(playbackEnabled.webui.port);
    expect(status).toBe('running');
  });

  it.each(['refused', 'foreign'] as const)('holds no lease when the probe is %s', async (outcome) => {
    const deps = makeDeps(outcome);
    await ensureWebForPlayback(playbackEnabled, deps);

    expect(deps.lease).not.toHaveBeenCalled();
  });

  it('does NOT spawn when the port is held by a foreign process', async () => {
    const deps = makeDeps('foreign');
    const status = await ensureWebForPlayback(playbackEnabled, deps);

    expect(deps.spawn).not.toHaveBeenCalled();
    expect(status).toBe('unavailable');
  });

  it('no-ops (no probe, no spawn) when webui.enabled is false', async () => {
    const deps = makeDeps('refused');
    const config = makeTestConfig({ features: { playback: true }, webui: { ...playbackEnabled.webui, enabled: false } });

    const status = await ensureWebForPlayback(config, deps);

    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(status).toBe('unavailable');
  });

  it('no-ops when playback is not available', async () => {
    const deps = makeDeps('refused');
    const config = makeTestConfig({ features: { playback: false } }); // webui.enabled defaults true

    const status = await ensureWebForPlayback(config, deps);

    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(status).toBe('unavailable');
  });

  it('coalesces concurrent calls into a single probe+spawn', async () => {
    // The probe stays pending until both calls are in flight.
    let resolveProbe!: (o: WebOwnerProbe) => void;
    const deps: RespawnDeps = {
      probe: vi.fn().mockReturnValue(new Promise<WebOwnerProbe>((r) => { resolveProbe = r; })),
      spawn: vi.fn().mockReturnValue('spawned'),
      lease: vi.fn().mockResolvedValue(undefined),
    };

    const p1 = ensureWebForPlayback(playbackEnabled, deps);
    const p2 = ensureWebForPlayback(playbackEnabled, deps);
    resolveProbe(ownerProbe('refused'));
    const [s1, s2] = await Promise.all([p1, p2]);

    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(s1).toBe('spawned');
    expect(s2).toBe('spawned');
  });

  it('clears the in-flight latch when the probe throws (next call can retry)', async () => {
    // A stuck in-flight promise would make every later play await the same rejection.
    const boom: RespawnDeps = {
      probe: vi.fn().mockRejectedValueOnce(new Error('probe boom')).mockResolvedValue(ownerProbe('refused')),
      spawn: vi.fn().mockReturnValue('spawned'),
      lease: vi.fn().mockResolvedValue(undefined),
    };

    await expect(ensureWebForPlayback(playbackEnabled, boom)).rejects.toThrow('probe boom');

    const status = await ensureWebForPlayback(playbackEnabled, boom);
    expect(boom.probe).toHaveBeenCalledTimes(2);
    expect(boom.spawn).toHaveBeenCalledTimes(1);
    expect(status).toBe('spawned');
  });

  it('re-probes on a subsequent call after the first settles (no stale latch)', async () => {
    // The second call stands in for a play after the user powered the player off.
    const upDeps = makeDeps('ours');
    await ensureWebForPlayback(playbackEnabled, upDeps);

    const downDeps = makeDeps('refused');
    const status = await ensureWebForPlayback(playbackEnabled, downDeps);

    expect(downDeps.probe).toHaveBeenCalledTimes(1);
    expect(downDeps.spawn).toHaveBeenCalledTimes(1);
    expect(status).toBe('spawned');
  });
});
