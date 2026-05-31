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
import { probeHealthz } from './acquire.js';

/**
 * In-process double-spawn guard (spec §6.2): a transient probe miss must not
 * spawn two children within one MCP process. Cross-process double-spawn is
 * harmless — each child runs `acquireOrAttach` and the bind loser self-exits.
 */
let spawned = false;

/**
 * Result of `ensureWebServerRunning`, so the caller (MCP) can decide whether it
 * must run the scrobbler itself:
 * - `running`     — a navidrome-web already owns the port (we attached/stood down).
 * - `spawned`     — we launched an IPC child that will become the owner.
 * - `unavailable` — the port is held by a FOREIGN process, or the spawn failed,
 *                   so NO web owner will exist → MCP must be the active host.
 */
export type WebServerStatus = 'running' | 'spawned' | 'unavailable';

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
 * Ensure the standalone `navidrome-web` server is running, spawning it as an
 * IPC CHILD if not (spec §6, lifecycle §B.1). The `ipc` stdio channel is the
 * parent↔child link: the child watches `process.on('disconnect')` to learn when
 * THIS MCP exits (fires even on MCP crash, cross-platform incl. Windows) and
 * then either stops with it (default) or persists (webui.persistAfterMcpExit).
 * `unref()` so MCP isn't blocked by the child; the child stays alive on its own
 * HTTP server. NOT detached — the IPC channel must stay bound to this parent.
 *
 * The child re-runs `acquireOrAttach` itself, so a redundant spawn (one already
 * running) just stands down and exits cleanly; the MCP side must NOT treat that
 * immediate exit as an error. The child inherits `NAVIDROME_CONFIG_PATH` (so
 * parent/child agree on the store) and gets `NAVIDROME_WEB_AUTO_OPEN` carrying
 * the `webui.autoOpenBrowser` decision.
 *
 * Returns a {@link WebServerStatus} so MCP can fall back to scrobbling itself
 * when no web owner can be brought up (spec §6.4 single-submitter rule must not
 * silently drop scrobbling when the port is foreign or the spawn fails).
 */
export async function ensureWebServerRunning(config: Config): Promise<WebServerStatus> {
  if (spawned) return 'running';

  // Fast path: if a server already owns the port, don't spawn a doomed child.
  const probe = await probeHealthz(config.webui.port);
  if (probe === 'ours') {
    spawned = true;
    logger.debug(`web server already running on port ${config.webui.port}; not spawning`);
    return 'running';
  }
  if (probe === 'foreign') {
    logger.warn(
      `Web UI port ${config.webui.port} is in use by another application; not starting the player. ` +
        `Scrobbling will be handled by the MCP process until the conflict is resolved ` +
        `(change webui.port in settings or stop the conflicting process).`,
    );
    return 'unavailable';
  }

  const target = resolveLaunchTarget();
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NAVIDROME_WEB_AUTO_OPEN: config.webui.autoOpenBrowser ? '1' : '0',
  };

  try {
    const child = spawn(target.command, target.args, {
      // stdin/out/err ignored (the child logs to its own file); the 4th fd is
      // the IPC channel that lets the child detect this parent's exit.
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: childEnv,
    });
    // Don't keep the MCP event loop alive for the child, and don't crash if the
    // launch itself errors. A late 'error' (e.g. ENOENT) fires after this
    // resolves; it's logged, and the child failing to bind leaves mpv playing
    // unscrobbled until the next host adopts it — the accepted orphan edge.
    child.on('error', (err) => {
      // Reset the in-process guard so the next ensureWebServerRunning re-probes
      // and MCP can fall back to scrobbling itself — otherwise the `if (spawned)`
      // fast-path would permanently skip that fallback for a child that never
      // came alive. (The accepted-orphan behavior is unchanged: a child that DID
      // bind but errors later is the operator's edge to resolve.)
      spawned = false;
      logger.warn('navidrome-web child failed after spawn:', err);
    });
    child.unref();
    spawned = true;
    logger.debug(`spawned navidrome-web: ${target.command} ${target.args.join(' ')}`);
    return 'spawned';
  } catch (err) {
    logger.warn('failed to spawn navidrome-web:', err);
    return 'unavailable';
  }
}
