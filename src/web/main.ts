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
 * The standalone web player: the `navidrome-web` binary and the IPC child the MCP server spawns.
 * It owns mpv, so every shutdown path quits mpv.
 */

// First, because ESM evaluates every import before this body and some imported modules log at load.
import { logPath } from './file-logging.js';

import type { Server } from 'node:http';

import { createRuntime } from '../bootstrap.js';
import { resolveConfigState } from '../config.js';
import { startConfigServer } from '../config-app/server.js';
import { WEB_OWNER_ATTACH_INTERVAL_MS } from '../constants/timeouts.js';
import { playbackEngine } from '../services/playback/playback-engine.js';
import { ScrobbleTracker } from '../services/playback/scrobble-tracker.js';
import { logger } from '../utils/logger.js';
import { openBrowser } from '../utils/open-browser.js';
import { SseBroadcaster } from '../webui/broadcaster.js';
import { isLanReachable, listLanInterfaces } from '../webui/network.js';
import { createServer } from '../webui/server.js';
import { acquireOrAttach, loopbackUrl } from './acquire.js';
import { getPersist, setPersist, setTheme } from './player-runtime.js';

// Node 20+ exits on an unhandled rejection, and an MCP-spawned child's stderr is ignored, so it goes to the file sink.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});

/** Hard ceiling on owner shutdown: if the mpv `quit` IPC wedges, exit anyway. */
const SHUTDOWN_HARD_EXIT_MS = 3000;

// Only an MCP spawn opens an IPC channel, so process.send marks who launched this process.
const launchedByMcp = process.send !== undefined;

/**
 * Opened here, not in the parent, because only this process knows the bind succeeded. A direct run always
 * opens, since the user launched it to use it. NAVIDROME_WEB_AUTO_OPEN=0 keeps test runs from opening one.
 */
function maybeOpenBrowser(port: number, autoOpenBrowser: boolean): void {
  if (process.env['NAVIDROME_WEB_AUTO_OPEN'] === '0') return;
  const shouldOpen = launchedByMcp ? autoOpenBrowser : true;
  if (shouldOpen) openBrowser(loopbackUrl(port));
}

/** Also printed to stdout, since a direct terminal run sees nothing the file logger writes. */
function logBanner(port: number, host: string): void {
  const lines = [`navidrome-web listening on ${loopbackUrl(port)}`];
  if (isLanReachable(host)) {
    for (const iface of listLanInterfaces(port)) {
      lines.push(`  LAN: ${iface.url} (${iface.iface})`);
    }
  }
  for (const line of lines) logger.info(line);
  process.stdout.write(`\n  ${lines.join('\n  ')}\n\n`);
}

// Set once this process owns the port, so the one shutdown path can tear them down whatever triggered it.
let serverRef: Server | null = null;
let broadcasterRef: SseBroadcaster | null = null;
let shuttingDown = false;

/** The owner quits mpv on every shutdown, and a hard exit backstops a wedged mpv `quit` IPC. */
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

/** SIGHUP is caught so a closed terminal still quits the detached mpv. */
function installShutdownTriggers(): void {
  process.once('SIGINT', (): void => shutdownPlayer('SIGINT'));
  process.once('SIGTERM', (): void => shutdownPlayer('SIGTERM'));
  process.once('SIGHUP', (): void => shutdownPlayer('SIGHUP'));
  const onMcpDisconnect = (): void => {
    if (getPersist()) {
      logger.info('MCP parent exited; persisting as an independent player.');
    } else {
      shutdownPlayer('mcp-exit');
    }
  };
  process.on('disconnect', onMcpDisconnect);
  // A parent that exited during startup emitted 'disconnect' before this listener existed.
  if (launchedByMcp && !process.connected) onMcpDisconnect();
}

/**
 * The MCP engine can spawn mpv after this owner starts, and the owner's tracker
 * sees track changes only while attached, so an unattached owner keeps retrying.
 */
function keepPlaybackAttached(): void {
  const timer = setInterval(() => {
    if (shuttingDown || playbackEngine.isRunning()) return;
    playbackEngine.ensureAttached().catch((err: unknown) => {
      logger.debug('periodic mpv attach failed:', err);
    });
  }, WEB_OWNER_ATTACH_INTERVAL_MS);
  timer.unref();
}

/**
 * Generous, because reaping mid-config is worse than a harmless idle loopback process,
 * and its own ephemeral port means a lingering one never blocks a freshly launched player.
 */
const SETUP_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Hosts the settings UI so a user who launched the player first, even from the terminal-less desktop
 * shortcut, has a visible path to configure. No power button exists yet, so the server reaps itself when idle.
 */
async function runSetupMode(): Promise<void> {
  const settings = await startConfigServer({
    idleTimeoutMs: SETUP_IDLE_TIMEOUT_MS,
    onIdleTimeout: () => {
      logger.info(
        'navidrome-web: settings page idle — leaving setup mode. Re-launch navidrome-web when ready.',
      );
      process.exit(0);
    },
  });

  logger.warn(`navidrome-web is not configured. Opening the settings page: ${settings.url}`);
  // The logger writes to a file, so stdout carries the URL for a terminal run and for a host where no browser opens.
  process.stdout.write(
    `\n  navidrome-web is not configured yet.\n  Open this in your browser to set it up:  ${settings.url}\n  (attempting to open it for you…)  After you Save, re-launch navidrome-web.\n\n`,
  );
  if (process.env['NAVIDROME_WEB_AUTO_OPEN'] !== '0') openBrowser(settings.url);

  const stop = (): void => {
    void settings.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  // The listening config server keeps the process alive. Serving waits for the next launch to read the saved config.
}

async function main(): Promise<void> {
  logger.info('navidrome-web starting');

  const state = await resolveConfigState();
  if (!state.configured) {
    await runSetupMode();
    return;
  }
  logger.setDebug(state.config.debug);

  // A bare createRuntime() re-reads the store, which throws on the env-var fallback path and opens a TOCTOU window.
  const { config, client } = await createRuntime(state.config);
  // Seed the live flags, which the settings modal may toggle.
  setPersist(config.webui.persistAfterMcpExit);
  setTheme(config.webui.theme);

  // Startup can outlast the MCP that spawned this process, and binding then would only open a doomed player.
  if (launchedByMcp && !process.connected && !getPersist()) {
    logger.info('navidrome-web: the spawning MCP exited during startup. Standing down.');
    return;
  }

  const broadcaster = new SseBroadcaster(client);
  const makeServer = (): Server =>
    createServer({ config, client, broadcaster, shutdown: () => shutdownPlayer('power-button') });

  const result = await acquireOrAttach(config, makeServer);
  if (result.mode === 'attached') {
    // A user who launched a second copy still expects the player, so point them at the running one.
    // An MCP-spawned copy lost a start race, and the owner already handled auto-open.
    const runningMessage = `navidrome-web already running at ${result.url}`;
    logger.info(`${runningMessage}. Standing down.`);
    process.stdout.write(`\n  ${runningMessage}\n\n`);
    if (!launchedByMcp) maybeOpenBrowser(config.webui.port, config.webui.autoOpenBrowser);
    return;
  }

  serverRef = result.server;
  broadcasterRef = broadcaster;
  broadcaster.start();

  // The port owner is the elected scrobble submitter, and MCP defers while /healthz reports it attached.
  // Subscribe BEFORE adopting mpv so the tracker hydrates from the initial emit without re-scrobbling.
  if (config.features.playback) {
    new ScrobbleTracker(client, playbackEngine).attach();
    // Adopt an already-playing mpv left by a since-closed session, so the
    // player controls it at once. Best-effort, and ensureAttached never spawns mpv.
    try {
      await playbackEngine.ensureAttached();
    } catch (err) {
      logger.debug('ensureAttached at startup failed (no mpv yet?):', err);
    }
    keepPlaybackAttached();
  }

  logBanner(config.webui.port, config.webui.host);
  maybeOpenBrowser(config.webui.port, config.webui.autoOpenBrowser);
  installShutdownTriggers();

  logger.info('navidrome-web started successfully (port owner)');
}

main().catch((error: unknown) => {
  // The file sink is installed at module load, so this reaches the logfile even
  // when MCP spawned us with stdio ignored (stderr → /dev/null).
  logger.error('navidrome-web failed to start:', error);
  // A direct terminal run would otherwise exit with no visible reason.
  const message = error instanceof Error ? error.message : String(error);
  try {
    process.stderr.write(`navidrome-web failed to start: ${message} (log: ${logPath})\n`);
  } catch {
    /* best-effort */
  }
  process.exit(1);
});
