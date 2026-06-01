/**
 * Navidrome MCP Server - respawn-on-play tests
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Covers `ensureWebForPlayback` — the respawn-on-play path. The whole point of
 * this function (vs. the startup `ensureWebServerRunning`) is that it must probe
 * `/healthz` FRESH every call and ignore the stale module-level `spawned` latch,
 * so a player powered off mid-session is brought back on the next play. Tests
 * drive the probe/spawn decision through the injected `RespawnDeps` seam, so no
 * real sockets or child processes are touched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProbeOutcome } from '../../../src/web/acquire.js';
import { ensureWebForPlayback, type RespawnDeps } from '../../../src/web/spawn.js';
import { makeTestConfig } from '../../helpers/test-config.js';

function makeDeps(probeOutcome: ProbeOutcome): RespawnDeps & {
  probe: ReturnType<typeof vi.fn>;
  spawn: ReturnType<typeof vi.fn>;
} {
  return {
    probe: vi.fn().mockResolvedValue(probeOutcome),
    spawn: vi.fn().mockReturnValue('spawned'),
  };
}

const playbackEnabled = makeTestConfig({ features: { playback: true } });

describe('ensureWebForPlayback (respawn-on-play)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns the player when the port is refused (player was powered off)', async () => {
    const deps = makeDeps('refused');
    const status = await ensureWebForPlayback(playbackEnabled, deps);

    expect(deps.probe).toHaveBeenCalledWith(playbackEnabled.webui.port);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(status).toBe('spawned');
  });

  it('does NOT spawn when a player already owns the port', async () => {
    const deps = makeDeps('ours');
    const status = await ensureWebForPlayback(playbackEnabled, deps);

    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(status).toBe('running');
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
    // A slow probe so both calls overlap on the same in-flight promise.
    let resolveProbe!: (o: ProbeOutcome) => void;
    const deps: RespawnDeps = {
      probe: vi.fn().mockReturnValue(new Promise<ProbeOutcome>((r) => { resolveProbe = r; })),
      spawn: vi.fn().mockReturnValue('spawned'),
    };

    const p1 = ensureWebForPlayback(playbackEnabled, deps);
    const p2 = ensureWebForPlayback(playbackEnabled, deps);
    resolveProbe('refused');
    const [s1, s2] = await Promise.all([p1, p2]);

    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(s1).toBe('spawned');
    expect(s2).toBe('spawned');
  });

  it('clears the in-flight latch when the probe throws (next call can retry)', async () => {
    // A throwing probe must not leave a stuck in-flight promise — otherwise
    // every later play would await a rejected promise. Verify the rejection
    // propagates once, then a fresh call probes again and succeeds.
    const boom: RespawnDeps = {
      probe: vi.fn().mockRejectedValueOnce(new Error('probe boom')).mockResolvedValue('refused'),
      spawn: vi.fn().mockReturnValue('spawned'),
    };

    await expect(ensureWebForPlayback(playbackEnabled, boom)).rejects.toThrow('probe boom');

    // Latch cleared → this call re-probes (now 'refused') and spawns.
    const status = await ensureWebForPlayback(playbackEnabled, boom);
    expect(boom.probe).toHaveBeenCalledTimes(2);
    expect(boom.spawn).toHaveBeenCalledTimes(1);
    expect(status).toBe('spawned');
  });

  it('re-probes on a subsequent call after the first settles (no stale latch)', async () => {
    // First call: player is up. Second call (after power-off): refused → spawn.
    // Proves we do NOT short-circuit on a remembered "already spawned" state.
    const upDeps = makeDeps('ours');
    await ensureWebForPlayback(playbackEnabled, upDeps);

    const downDeps = makeDeps('refused');
    const status = await ensureWebForPlayback(playbackEnabled, downDeps);

    expect(downDeps.probe).toHaveBeenCalledTimes(1);
    expect(downDeps.spawn).toHaveBeenCalledTimes(1);
    expect(status).toBe('spawned');
  });
});
