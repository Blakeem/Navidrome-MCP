#!/usr/bin/env node
/**
 * Navidrome MCP Server - Standalone web player entry (`navidrome-web`)
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
 * The standalone web player. This is BOTH the binary a user runs directly
 * (`navidrome-web`) AND the artifact the MCP server spawns as an IPC child
 * (spec §6 / lifecycle §B.1). It owns the web server's full lifecycle: shared
 * bootstrap → port-as-lock acquire → serve UI/API/SSE → scrobble (as the
 * playback owner) → shutdown.
 *
 * The web server OWNS mpv: whenever it shuts down it quits mpv. It shuts down on
 * a direct signal, the in-UI power button, or — if spawned by MCP and
 * `persistAfterMcpExit` is off — when that MCP exits (IPC `disconnect`). With
 * persist on (or when launched standalone) it survives MCP and stops only via
 * the power button / a signal. No idle reaper.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join } from 'node:path';
import { inspect } from 'node:util';

import { createRuntime } from '../bootstrap.js';
import { resolveConfigState } from '../config.js';
import { getSettingsStorePath } from '../config/store-path.js';
import { playbackEngine } from '../services/playback/playback-engine.js';
import { ScrobbleTracker } from '../services/playback/scrobble-tracker.js';
import { logger, type LogLevel } from '../utils/logger.js';
import { openBrowser } from '../utils/open-browser.js';
import { SseBroadcaster } from '../webui/broadcaster.js';
import { listLanInterfaces } from '../webui/network.js';
import { createServer } from '../webui/server.js';
import { acquireOrAttach } from './acquire.js';
import { getPersist, initPersist } from './player-runtime.js';

// Belt-and-suspenders against any unhandled rejection escaping the system —
// without this, Node 20+ terminates the process by default, and (MCP-spawned)
// our stderr is /dev/null, so a fire-and-forget rejection would die silently.
// Routes through the already-installed file sink. Mirrors src/index.ts.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});

/** Hard ceiling on owner shutdown: if the mpv `quit` IPC wedges, exit anyway. */
const SHUTDOWN_HARD_EXIT_MS = 3000;

/**
 * Redirect the logger to a file. When MCP spawns us its stdio is ignored, so
 * stderr is /dev/null — anything not written to the file is lost. Installed
 * FIRST, before anything can log. (A direct `navidrome-web` run has a real
 * stderr, which the sink falls back to if the file write ever fails.)
 */
function setupFileLogging(): string {
  const logPath = join(dirname(getSettingsStorePath()), 'navidrome-web.log');
  try {
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  } catch {
    /* directory may already exist; sink-append will surface real failures */
  }
  let sinkFailed = false;
  logger.setSink((level: LogLevel, args: unknown[]) => {
    const stamp = new Date().toISOString();
    const body = args
      .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4 })))
      .join(' ');
    const line = `[${stamp}] [${level}] ${body}\n`;
    try {
      // mode applies only on creation; the log can carry (redacted, but still
      // operational) detail, so keep it owner-only on multi-user hosts.
      appendFileSync(logPath, line, { mode: 0o600 });
    } catch (err) {
      // Best-effort logging; never throw from the log path. But don't go fully
      // dark on a misconfigured (e.g. read-only) dir: a direct `navidrome-web`
      // run has a real stderr, so fall back to it ONCE so the operator sees
      // that file logging is broken.
      if (!sinkFailed) {
        sinkFailed = true;
        try {
          process.stderr.write(`navidrome-web: file logging to ${logPath} failed (${String(err)}); logging to stderr\n`);
        } catch {
          /* nothing more we can do */
        }
      }
      try {
        process.stderr.write(line);
      } catch {
        /* best-effort */
      }
    }
  });
  return logPath;
}

/** loopback player URL (never the LAN IP — 0.0.0.0 still serves loopback). */
function loopbackUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Auto-open the browser. Direct runs (`navidrome-web`) always open — the user
 * launched it to use it. MCP-spawned runs honor `webui.autoOpenBrowser`, which
 * the parent passes through as `NAVIDROME_WEB_AUTO_OPEN=1|0`. Opened here (not
 * in the parent) because only the owner knows the bind succeeded.
 */
function maybeOpenBrowser(port: number): void {
  const flag = process.env['NAVIDROME_WEB_AUTO_OPEN'];
  const launchedByMcp = flag !== undefined;
  const shouldOpen = launchedByMcp ? flag === '1' : true;
  if (shouldOpen) openBrowser(loopbackUrl(port));
}

function logBanner(port: number, host: string, expose: boolean): void {
  logger.info(`navidrome-web listening on ${loopbackUrl(port)}`);
  if (expose || host === '0.0.0.0') {
    for (const iface of listLanInterfaces(port)) {
      logger.info(`  LAN: ${iface.url} (${iface.iface})`);
    }
  }
}

// Live references set once we own the port, so the single shutdown path can
// tear them down regardless of what triggered it (signal / power button / MCP
// disconnect).
let serverRef: Server | null = null;
let broadcasterRef: SseBroadcaster | null = null;
let shuttingDown = false;

/**
 * The single owner-shutdown path. The web server OWNS mpv, so it ALWAYS quits
 * mpv as it goes (no keep-if-playing nuance — that only mattered for the
 * since-removed reaper / survive-restart model). Stops the HTTP server +
 * broadcaster, quits mpv, then exits, with a hard backstop so a wedged mpv
 * `quit` IPC can't prevent exit on a signal. Idempotent.
 */
function shutdownPlayer(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`navidrome-web shutting down (${reason})`);
  broadcasterRef?.stop();
  serverRef?.close();
  const hardExit = setTimeout(() => process.exit(0), SHUTDOWN_HARD_EXIT_MS);
  hardExit.unref();
  void (async (): Promise<void> => {
    try {
      await playbackEngine.quitMpv();
      logger.info('shutdown: mpv quit');
    } catch (err) {
      logger.warn('shutdown: mpv quit failed', err);
    }
    clearTimeout(hardExit);
    process.exit(0);
  })();
}

/**
 * Wire the shutdown triggers (spec lifecycle §B.1):
 * - SIGINT/SIGTERM: a direct kill of this process.
 * - IPC `disconnect`: the MCP that spawned us exited. Honor the persist flag —
 *   stop with MCP by default, or stay running (now independent) if persist is
 *   on. `disconnect` never fires for a standalone launch (no IPC parent).
 */
function installShutdownTriggers(): void {
  process.once('SIGINT', (): void => shutdownPlayer('SIGINT'));
  process.once('SIGTERM', (): void => shutdownPlayer('SIGTERM'));
  process.on('disconnect', (): void => {
    if (getPersist()) {
      logger.info('MCP parent exited; persisting — now an independent player.');
    } else {
      shutdownPlayer('mcp-exit');
    }
  });
}

async function main(): Promise<void> {
  setupFileLogging();
  logger.info('navidrome-web starting');

  const state = await resolveConfigState();
  if (!state.configured) {
    logger.warn(
      'navidrome-web is not configured — run `navidrome-config` to set up Navidrome, then restart. Exiting.',
    );
    return;
  }
  logger.setDebug(state.config.debug);

  // Shared bootstrap: same config/client/managers/engine the MCP server builds.
  const { config, client } = await createRuntime();
  // Seed the persist flag (may be toggled live via the settings modal).
  initPersist(config.webui.persistAfterMcpExit);

  const broadcaster = new SseBroadcaster(client);
  const makeServer = (): Server =>
    createServer({ config, client, broadcaster, shutdown: () => shutdownPlayer('power-button') });

  const result = await acquireOrAttach(config, makeServer);
  if (result.mode === 'attached') {
    // Another navidrome-web already owns the port. Nothing to do — exit cleanly
    // (the MCP spawner must treat this exit(0) as success, not an error).
    logger.info(`navidrome-web already running at ${result.url}; standing down.`);
    return;
  }

  // We are the port owner: serve + scrobble. `result.mode === 'owner'` narrows
  // the union, so `result.server` is defined without a cast.
  serverRef = result.server;
  broadcasterRef = broadcaster;
  broadcaster.start();

  // The web port owner is the elected scrobble submitter (spec §6.4): it keeps
  // the default `shouldSubmit` (always true) and counts every play. MCP runs its
  // own tracker but defers to us via a live web-port probe, so exactly one of us
  // submits each play. Subscribe BEFORE adopting mpv so the tracker catches the
  // initial state emit (it hydrates without re-scrobbling the in-flight track).
  if (config.features.playback) {
    new ScrobbleTracker(client, playbackEngine).attach();
    // Adopt an already-playing mpv left by a since-closed session (spec §8.6
    // adopt-on-startup). Best-effort; ensureAttached never spawns mpv.
    try {
      await playbackEngine.ensureAttached();
    } catch (err) {
      logger.debug('ensureAttached at startup failed (no mpv yet?):', err);
    }
  }

  logBanner(config.webui.port, config.webui.host, config.webui.expose);
  maybeOpenBrowser(config.webui.port);
  installShutdownTriggers();

  logger.info('navidrome-web started successfully (port owner)');
}

main().catch((error) => {
  // The file sink is installed first thing, so this reaches the logfile even
  // when MCP spawned us with stdio ignored (stderr → /dev/null).
  logger.error('navidrome-web failed to start:', error);
  process.exit(1);
});
