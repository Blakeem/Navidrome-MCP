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
 * (`navidrome-web`) AND the artifact the MCP server spawns detached (spec §6).
 * It owns the web server's full lifecycle: shared bootstrap → port-as-lock
 * acquire → serve UI/API/SSE → scrobble (as the playback survivor) → smart mpv
 * shutdown + idle reaper. Closing the MCP server does NOT stop this process.
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
import {
  IDLE_REAPER_INTERVAL_MS,
  IDLE_REAPER_TICKS,
  type IdleReaper,
  shouldKillMpvOnOwnerShutdown,
  startIdleReaper,
} from '../services/playback/shutdown.js';
import { logger, type LogLevel } from '../utils/logger.js';
import { openBrowser } from '../utils/open-browser.js';
import { SseBroadcaster } from '../webui/broadcaster.js';
import { listLanInterfaces } from '../webui/network.js';
import { createServer } from '../webui/server.js';
import { acquireOrAttach } from './acquire.js';

/** Hard ceiling on owner shutdown: if the mpv `quit` IPC wedges, exit anyway. */
const SHUTDOWN_HARD_EXIT_MS = 3000;

/**
 * Redirect the logger to a file. The process is spawned detached with
 * `stdio:'ignore'`, so stderr is /dev/null — anything not written to the file
 * is lost. Installed FIRST, before anything can log.
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
      // dark on a misconfigured (e.g. read-only) dir: when run directly (not
      // detached) stderr is a real terminal, so fall back to it ONCE so the
      // operator sees that file logging is broken.
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

/**
 * Wire SIGINT/SIGTERM for the port owner (spec §8.5): stop the HTTP server +
 * broadcaster + reaper, then kill mpv ONLY if it's not playing (playing → keep
 * detached so a web restart resumes control of the same audio).
 */
function installOwnerShutdown(server: Server, broadcaster: SseBroadcaster, reaper: IdleReaper): void {
  let closing = false;
  const onExit = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info(`navidrome-web received ${signal}; shutting down owner`);
    reaper.stop();
    broadcaster.stop();
    server.close();
    // Hard backstop: never let a wedged mpv `quit` IPC keep us from exiting on a
    // signal (the supervisor would otherwise escalate to SIGKILL). Unref'd so it
    // doesn't itself hold the loop open if the clean path finishes first.
    const hardExit = setTimeout(() => process.exit(0), SHUTDOWN_HARD_EXIT_MS);
    hardExit.unref();
    void (async (): Promise<void> => {
      try {
        if (shouldKillMpvOnOwnerShutdown(playbackEngine.isPlaying())) {
          await playbackEngine.quitMpv();
          logger.info('owner shutdown: mpv was idle — quit it');
        } else {
          logger.info('owner shutdown: mpv is playing — left running (detached)');
        }
      } catch (err) {
        logger.warn('owner shutdown: mpv quit failed', err);
      }
      clearTimeout(hardExit);
      process.exit(0);
    })();
  };
  process.once('SIGINT', (): void => onExit('SIGINT'));
  process.once('SIGTERM', (): void => onExit('SIGTERM'));
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

  const broadcaster = new SseBroadcaster(client);
  const makeServer = (): Server => createServer({ config, client, broadcaster });

  const result = await acquireOrAttach(config, makeServer);
  if (result.mode === 'attached') {
    // Another navidrome-web already owns the port. Nothing to do — exit cleanly
    // (the MCP spawner must treat this exit(0) as success, not an error).
    logger.info(`navidrome-web already running at ${result.url}; standing down.`);
    return;
  }

  // We are the port owner: serve, scrobble, reap. `result.mode === 'owner'`
  // narrows the union, so `result.server` is defined without a cast.
  const { server } = result;
  broadcaster.start();

  // The web port owner is the elected scrobble submitter (spec §6.4). Subscribe
  // BEFORE adopting mpv so the tracker catches the initial state emit (it
  // hydrates without re-scrobbling the in-flight track).
  if (config.features.playback) {
    new ScrobbleTracker(client, playbackEngine).attach();
    // Adopt an already-playing mpv left by a since-closed MCP/session so the
    // scrobbler + reaper see real state immediately (spec §8.6 adopt-on-startup).
    // Best-effort; ensureAttached never spawns mpv.
    try {
      await playbackEngine.ensureAttached();
    } catch (err) {
      logger.debug('ensureAttached at startup failed (no mpv yet?):', err);
    }
  }

  const reaper = startIdleReaper(
    playbackEngine,
    { intervalMs: IDLE_REAPER_INTERVAL_MS, ticksToReap: IDLE_REAPER_TICKS },
    () => logger.info('idle reaper: quit a continuously-idle mpv'),
  );

  logBanner(config.webui.port, config.webui.host, config.webui.expose);
  maybeOpenBrowser(config.webui.port);
  installOwnerShutdown(server, broadcaster, reaper);

  logger.info('navidrome-web started successfully (port owner)');
}

main().catch((error) => {
  // The file sink is installed first thing, so this reaches the logfile even
  // though stderr is /dev/null under detached spawn.
  logger.error('navidrome-web failed to start:', error);
  process.exit(1);
});
