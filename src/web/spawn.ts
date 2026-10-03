/**
 * Navidrome MCP Server - Spawn the standalone web server as an IPC child
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

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { probeHealthz, type ProbeOutcome } from './acquire.js';

/**
 * Outcome of trying to bring the web player up:
 * - `running`: a navidrome-web already owns the port.
 * - `spawned`: we launched an IPC child that will become the owner.
 * - `unavailable`: the port is held by a FOREIGN process, or the spawn failed.
 */
type WebServerStatus = 'running' | 'spawned' | 'unavailable';

interface LaunchTarget {
  command: string;
  args: string[];
}

/**
 * Decide how to launch the web server. In a built install the compiled entry
 * sits next to this module (`dist/web/main.js`) and is run with the same Node.
 * In dev (MCP under `tsx`, no `dist/`) we run the TS source through tsx as a
 * Node loader — `node --import tsx src/web/main.ts`. Using `process.execPath`
 * (not a bare `tsx`) is deliberate: it is PATH-independent (Claude Desktop often
 * doesn't put `node_modules/.bin` on PATH) and avoids the Windows `tsx.cmd`
 * shim that a non-shell `spawn` can't resolve. Honors `NAVIDROME_DEV=1`.
 */
function resolveLaunchTarget(): LaunchTarget {
  const here = dirname(fileURLToPath(import.meta.url));
  const distMain = join(here, 'main.js');
  const isProd = process.env['NAVIDROME_DEV'] !== '1' && existsSync(distMain);
  if (isProd) {
    return { command: process.execPath, args: [distMain] };
  }
  const srcMain = join(here, 'main.ts');
  return { command: process.execPath, args: ['--import', 'tsx', srcMain] };
}

/**
 * Spawn the `navidrome-web` IPC child. The child watches the IPC channel's
 * 'disconnect' to learn when this MCP exits, then stops with it or persists per
 * webui.persistAfterMcpExit. Both the child handle and its IPC channel are
 * unref'd so neither keeps the MCP event loop alive, and the child still receives
 * 'disconnect' when MCP exits. NOT detached, since the IPC channel must stay
 * bound to this parent.
 *
 * The child re-runs `acquireOrAttach`, so a redundant spawn stands down and exits
 * cleanly. It inherits `NAVIDROME_CONFIG_PATH`, so parent and child read the same
 * store. Non-throwing: returns `'unavailable'` if `spawn` itself throws.
 */
function spawnWebChild(): WebServerStatus {
  const target = resolveLaunchTarget();

  try {
    const child = spawn(target.command, target.args, {
      // stdin/out/err ignored (the child logs to its own file); the 4th fd is
      // the IPC channel that lets the child detect this parent's exit.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: process.env,
    });
    // A late 'error' (e.g. ENOENT) fires after this function returns, so it can only be logged.
    child.on('error', (err) => {
      logger.warn('navidrome-web child failed after spawn:', err);
    });
    child.unref();
    child.channel?.unref();
    logger.debug(`spawned navidrome-web: ${target.command} ${target.args.join(' ')}`);
    return 'spawned';
  } catch (err) {
    logger.warn('failed to spawn navidrome-web:', err);
    return 'unavailable';
  }
}

/**
 * Injectable seam for {@link ensureWebForPlayback} — lets unit tests drive the
 * probe/spawn decision without real sockets or child processes.
 */
export interface RespawnDeps {
  probe: (port: number, bindHost: string) => Promise<ProbeOutcome>;
  spawn: () => WebServerStatus;
}

const DEFAULT_RESPAWN_DEPS: RespawnDeps = { probe: probeHealthz, spawn: spawnWebChild };

/**
 * In-flight coalescer: two rapid play calls must not both probe-and-spawn. The
 * first call's promise is shared until it settles, then cleared. Cross-process
 * double-spawn is already harmless via port-as-lock.
 */
let respawnInFlight: Promise<WebServerStatus> | null = null;

/**
 * Ensure the web player is up, at MCP startup and again whenever playback
 * starts. The play tool handlers call it BEFORE they enqueue, so the web UI is
 * present to own and scrobble the play it's about to trigger. It always probes
 * `/healthz` fresh, since the user can power the player off mid-session.
 *
 * Gated on `features.playback && webui.enabled`: when the UI is disabled the MCP
 * process owns mpv itself (and tears it down on exit), so we must NOT spawn a
 * web player here. Outcomes:
 * - `ours`    → already running, nothing to do.
 * - `refused` → server is down (e.g. powered off) → spawn it.
 * - `foreign` → port taken by another app → warn-skip (don't fight for it).
 */
export async function ensureWebForPlayback(
  config: Config,
  deps: RespawnDeps = DEFAULT_RESPAWN_DEPS,
): Promise<WebServerStatus> {
  if (!config.features.playback || !config.webui.enabled) return 'unavailable';
  if (respawnInFlight) return respawnInFlight;

  respawnInFlight = (async (): Promise<WebServerStatus> => {
    const probe = await deps.probe(config.webui.port, config.webui.host);
    if (probe === 'ours') return 'running';
    if (probe === 'foreign') {
      logger.warn(
        `Web UI port ${config.webui.port} is in use by another application; not starting the player. ` +
          `Scrobbling will be handled by the MCP process until the conflict is resolved ` +
          `(change webui.port in settings or stop the conflicting process).`,
      );
      return 'unavailable';
    }
    // refused → nobody listening (e.g. the player was powered off) → spawn.
    logger.debug('web player not running, spawning');
    return deps.spawn();
  })();

  try {
    return await respawnInFlight;
  } finally {
    respawnInFlight = null;
  }
}
