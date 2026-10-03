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

import { readSavedWebuiEndpoint, type Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { probeWebOwner, type WebEndpoint, type WebOwnerProbe } from './acquire.js';
import { holdOwnerLease } from './lease.js';

/**
 * Outcome of trying to bring the web player up:
 * - `running`: a navidrome-web already owns the port.
 * - `spawned`: we launched an IPC child that will become the owner.
 * - `unavailable`: the port is held by a FOREIGN process, the spawn failed, or features.playback or webui.enabled is off.
 */
type WebServerStatus = 'running' | 'spawned' | 'unavailable';

interface LaunchTarget {
  command: string;
  args: string[];
}

/**
 * process.execPath is PATH-independent and avoids the Windows tsx.cmd shim that a non-shell spawn cannot
 * resolve. NAVIDROME_DEV=1 forces the tsx launch of src/web/main.ts even when dist/web/main.js exists.
 */
function resolveLaunchTarget(): LaunchTarget {
  const here = dirname(fileURLToPath(import.meta.url));
  const distMain = join(here, 'main.js');
  const isProd = process.env['NAVIDROME_DEV'] !== '1' && existsSync(distMain);
  if (isProd) {
    return { command: process.execPath, args: [distMain] };
  }
  // `here` is src/web or dist/web, both two levels below the package root.
  const srcMain = join(here, '..', '..', 'src', 'web', 'main.ts');
  // Resolved from this module, because the child inherits a cwd that may sit outside the repo.
  return { command: process.execPath, args: ['--import', import.meta.resolve('tsx'), srcMain] };
}

/**
 * Detached, because Windows kills a non-detached child when its parent exits, before 'disconnect' or the mpv
 * quit can run. The child and its IPC channel are unref'd so neither holds the MCP open.
 */
function spawnWebChild(): WebServerStatus {
  try {
    const target = resolveLaunchTarget();
    const child = spawn(target.command, target.args, {
      // The child logs to its own file. The 4th fd is the IPC channel that lets it detect this parent's exit.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: process.env,
      detached: true,
      windowsHide: true,
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
 * Injectable seam for {@link ensureWebForPlayback}. Lets unit tests drive the
 * probe/spawn decision without real sockets or child processes.
 */
export interface RespawnDeps {
  probe: (startup: WebEndpoint) => Promise<WebOwnerProbe>;
  spawn: () => WebServerStatus;
  lease: (port: number) => Promise<void>;
}

const DEFAULT_RESPAWN_DEPS: RespawnDeps = {
  probe: (startup) => probeWebOwner(startup, readSavedWebuiEndpoint),
  spawn: spawnWebChild,
  lease: holdOwnerLease,
};

/**
 * Coalesces play calls that overlap one probe. A spawn during a child's boot yields a redundant child,
 * which port-as-lock stands down.
 */
let respawnInFlight: Promise<WebServerStatus> | null = null;

/**
 * Probes fresh before every enqueue, since the user can power the player off mid-session. Gated on
 * features.playback and webui.enabled, because the MCP owns mpv itself when the UI is off.
 */
export async function ensureWebForPlayback(
  config: Config,
  deps: RespawnDeps = DEFAULT_RESPAWN_DEPS,
): Promise<WebServerStatus> {
  if (!config.features.playback || !config.webui.enabled) return 'unavailable';
  if (respawnInFlight) return respawnInFlight;

  respawnInFlight = (async (): Promise<WebServerStatus> => {
    const probe = await deps.probe(config.webui);
    if (probe.outcome === 'ours') {
      // Counted before the play's mpv commands run, so the spawner's exit cannot stop this play.
      await deps.lease(probe.port);
      return 'running';
    }
    if (probe.outcome === 'foreign') {
      logger.warn(
        `Web UI port ${probe.port} is in use by another application; not starting the player. ` +
          `Scrobbling will be handled by the MCP process until the conflict is resolved ` +
          `(change webui.port in settings or stop the conflicting process).`,
      );
      return 'unavailable';
    }
    logger.debug('web player not running, spawning');
    return deps.spawn();
  })();

  try {
    return await respawnInFlight;
  } finally {
    respawnInFlight = null;
  }
}
