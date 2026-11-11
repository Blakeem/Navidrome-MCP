/**
 * Navidrome MCP Server - Jukebox Remote entry (`navidrome-mcp jukebox`)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Entry for `navidrome-mcp jukebox`, for the desktop shortcut and for the IPC child the MCP server spawns. The port owner
 * is responsible for mpv's lifetime, so every owner shutdown path quits mpv.
 */

// First, because ESM evaluates every import before this body and some imported modules log at load.
import { logPath } from './file-logging.js';

import type { Server } from 'node:http';

import { createRuntime, type Runtime } from '../bootstrap.js';
import { resolveConfigState, type Config, type StartupFailure } from '../config.js';
import { readEnvAdminPassword } from '../config/env-settings.js';
import { startConfigServer } from '../config-app/server.js';
import { SETTINGS_PAGE_IDLE_TIMEOUT_MS, WEB_OWNER_ATTACH_INTERVAL_MS } from '../constants/timeouts.js';
import { playbackEngine } from '../services/playback/playback-engine.js';
import { ScrobbleTracker } from '../services/playback/scrobble-tracker.js';
import { errorMessage } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { openBrowser } from '../utils/open-browser.js';
import { assertArgon2Available } from '../utils/secrets.js';
import { AuthService } from '../webui/auth/auth-service.js';
import { SseBroadcaster } from '../webui/broadcaster.js';
import { GuestQueue } from '../webui/jukebox/guest-queue.js';
import { adminPageUrl } from '../webui/page-paths.js';
import type { McpLeaseCounter } from '../webui/routes/player.js';
import { createServer } from '../webui/server.js';
import { isAddressRewritingHost } from '../webui/source-address.js';
import { VisualizerHub } from '../webui/visualizer-hub.js';
import { acquireOrAttach } from './acquire.js';
import { buildAttachLines, buildBannerLines, buildSetupHeadline } from './banner.js';
import { readLaunchKey, withLaunchKey, writeLaunchKey } from './launch-key.js';
import {
  getPersist,
  getVisualizer,
  setGuestQueueLimit,
  setJukeboxShareLink,
  setPersist,
  setTheme,
  setVisualizer,
  shouldStopForMcpExit,
} from './player-runtime.js';
import { createSettingsPageHolder } from './settings-page.js';
import { createSetupSaveHandler, type ConfiguredState, type PortAcquisition } from './setup-mode.js';

// Node exits on an unhandled rejection by default, and an MCP-spawned child's stderr is ignored, so
// the reason goes to the log file instead.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});

/** Bounds owner shutdown, so a wedged mpv `quit` IPC cannot keep the process alive. */
const SHUTDOWN_HARD_EXIT_MS = 3000;

// Only an MCP spawn opens an IPC channel, so process.send marks who launched this process.
const launchedByMcp = process.send !== undefined;

/**
 * Only this process knows the bind succeeded, so the MCP parent opens the browser only for open_jukebox_remote,
 * after its probe sees this player answer. A direct run always opens, since the user launched it to use it.
 * Tests set NAVIDROME_WEB_AUTO_OPEN=0.
 */
function maybeOpenBrowser(url: string, autoOpenBrowser: boolean): void {
  if (process.env['NAVIDROME_WEB_AUTO_OPEN'] === '0') return;
  const shouldOpen = launchedByMcp ? autoOpenBrowser : true;
  if (shouldOpen) openBrowser(url);
}

/** Also printed to stdout, since a direct terminal run sees nothing the file logger writes. */
function logBanner(webui: Config['webui']): void {
  const lines = buildBannerLines(webui, !launchedByMcp);
  for (const line of lines) logger.info(line);
  process.stdout.write(`\n  ${lines.join('\n  ')}\n\n`);
}

// Set once this process owns the port, so the one shutdown path tears them down for every trigger.
let serverRef: Server | null = null;
let broadcasterRef: SseBroadcaster | null = null;
let visualizerHubRef: VisualizerHub | null = null;
let authRef: AuthService | null = null;
let shuttingDown = false;
// Every MCP whose probe finds this player running holds one lease, the spawner included.
let openMcpLeases = 0;
// Starts on the first All settings click, so the player runs no settings server until an admin asks for one.
const settingsPage = createSettingsPageHolder();

function shutdownPlayer(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Jukebox Remote shutting down (${reason})`);
  broadcasterRef?.stop();
  visualizerHubRef?.stop();
  authRef?.flush();
  serverRef?.close();
  settingsPage.close().catch((err: unknown) => {
    logger.warn('shutdown: settings page close failed', err);
  });
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
    } else if (openMcpLeases > 0) {
      logger.info(`MCP parent exited; ${String(openMcpLeases)} other MCP process(es) still use this player.`);
    }
    stopIfNoMcpRemains();
  };
  process.on('disconnect', onMcpDisconnect);
  // A parent that exited during startup emitted 'disconnect' before this listener existed.
  if (launchedByMcp && !process.connected) onMcpDisconnect();
}

/** Runs on the spawner's exit and on every lease close, so the player stops with its last MCP. */
function stopIfNoMcpRemains(): void {
  const stop = shouldStopForMcpExit({
    launchedByMcp,
    parentConnected: process.connected,
    openLeases: openMcpLeases,
    persist: getPersist(),
  });
  if (stop) shutdownPlayer('mcp-exit');
}

const mcpLeases: McpLeaseCounter = {
  open: (): void => {
    openMcpLeases++;
  },
  close: (): void => {
    openMcpLeases--;
    stopIfNoMcpRemains();
  },
};

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
 * A user who launched the player first, even from the terminal-less desktop shortcut, needs a
 * visible path to configure. The settings page has no power button, so the server exits when idle.
 */
async function runSetupMode(failure?: StartupFailure): Promise<void> {
  const headline = buildSetupHeadline(failure);
  const stopSetup = (): void => {
    void settings.close().then(() => process.exit(0));
  };
  const settings = await startConfigServer({
    host: 'jukebox-setup',
    idleTimeoutMs: SETTINGS_PAGE_IDLE_TIMEOUT_MS,
    onIdleTimeout: () => {
      logger.info(
        'Jukebox Remote: settings page idle. Leaving setup mode. Run `navidrome-mcp jukebox` again when ready.',
      );
      process.exit(0);
    },
    onSaved: createSetupSaveHandler({
      resolveState: resolveConfigState,
      acquire: async (state) => acquirePlayerPort(state, await createPlayerRuntime(state)),
      leaveSetup: () => {
        // The player installs its own shutdown triggers, which quit mpv.
        process.removeListener('SIGINT', stopSetup);
        process.removeListener('SIGTERM', stopSetup);
        logger.info('Jukebox Remote: the saved settings are usable. Leaving setup mode.');
      },
      runOwner: (owner) => {
        runPortOwner(owner).catch(failStart);
      },
    }),
  });

  logger.warn(`${headline} Opening the settings page: ${settings.url}`);
  // The logger writes to a file, so stdout carries the URL for a terminal run and for a host where
  // no browser opens.
  process.stdout.write(
    `\n  ${headline}\n  Open this in your browser to set it up:  ${settings.url}\n  (attempting to open it for you…)  The Jukebox Remote starts after you Save.\n\n`,
  );
  if (process.env['NAVIDROME_WEB_AUTO_OPEN'] !== '0') openBrowser(settings.url);

  process.once('SIGINT', stopSetup);
  process.once('SIGTERM', stopSetup);

  // The listening config server keeps the process alive until a Save starts the player.
}

async function createPlayerRuntime(state: ConfiguredState): Promise<Runtime> {
  logger.setDebug(state.config.debug);
  // Only a mode with a login hashes or verifies a password, so mode none runs on a Node.js without Argon2.
  if (state.config.webui.auth.mode !== 'none') await assertArgon2Available();
  return createRuntime(state.config);
}

interface PortOwner {
  runtime: Runtime;
  url: string;
  server: Server;
  auth: AuthService;
  guests: GuestQueue;
  broadcaster: SseBroadcaster;
  visualizer: VisualizerHub;
}

/**
 * Setup mode runs createPlayerRuntime and this before its settings page closes, so a failure up to
 * the bind, such as a busy port, leaves that page up.
 */
async function acquirePlayerPort(state: ConfiguredState, runtime: Runtime): Promise<PortAcquisition<PortOwner>> {
  const { config, client } = runtime;
  setPersist(config.webui.persistAfterMcpExit);
  setTheme(config.webui.theme);
  setVisualizer(config.webui.visualizer);
  setGuestQueueLimit(config.jukebox.guestQueueLimit);
  setJukeboxShareLink(config.jukebox.shareLink);
  // The owner alone keeps mpv's filter in sync, since the snapshot and the settings dialog read its
  // live flag.
  playbackEngine.setVisualizerSource(getVisualizer, { keepInSync: true });

  // Startup can outlast the spawning MCP, and a player bound then would stop at once.
  if (launchedByMcp && !process.connected && !getPersist()) {
    logger.info('Jukebox Remote: the spawning MCP exited during startup. Standing down.');
    return { mode: 'mcp-exited' };
  }

  const auth = await AuthService.load(config, state.source, state.source === 'env' ? readEnvAdminPassword() : null);
  const guests = new GuestQueue();
  const broadcaster = new SseBroadcaster(client, guests);
  const visualizer = new VisualizerHub();
  const makeServer = (): Server =>
    createServer({ config, client, broadcaster, visualizer, shutdown: () => shutdownPlayer('power-button'), leases: mcpLeases, settingsPage, auth, guests });

  const result = await acquireOrAttach(config, makeServer);
  if (result.mode === 'attached') {
    // A user who launched a second copy still expects the player, so point them at the running one.
    // An MCP-spawned copy lost a start race, and the owner already handled auto-open.
    const adminUrl = adminPageUrl(result.url);
    const attachLines = buildAttachLines(adminUrl, result.url.startsWith('https:'));
    logger.info(`${attachLines.join(' ')} Standing down.`);
    process.stdout.write(`\n  ${attachLines.join('\n  ')}\n\n`);
    if (!launchedByMcp) maybeOpenBrowser(withLaunchKey(adminUrl, readLaunchKey(config.webui.port)), config.webui.autoOpenBrowser);
    return { mode: 'attached', url: result.url };
  }
  // Before the bind's first request runs, so a launcher finds this start's key.
  writeLaunchKey(config.webui.port, auth.launchKey);
  return { mode: 'owner', owner: { runtime, url: result.url, server: result.server, auth, guests, broadcaster, visualizer } };
}

async function runPortOwner(owner: PortOwner): Promise<void> {
  const { runtime: { config, client }, auth, guests, broadcaster, visualizer } = owner;
  serverRef = owner.server;
  broadcasterRef = broadcaster;
  visualizerHubRef = visualizer;
  authRef = auth;
  auth.claimStore();
  broadcaster.addHeartbeatTask(() => auth.sweep());
  broadcaster.addHeartbeatTask(() => guests.prune());
  guests.watch(() => broadcaster.broadcastNow());
  broadcaster.start();

  // The owner claims plays through mpv like every attached MCP, and the first claim submits.
  // Subscribing before adopting mpv lets the tracker hydrate from the initial emit unscrobbled.
  if (config.features.playback) {
    new ScrobbleTracker(client, playbackEngine).attach();
    // Adopts an mpv a closed session left playing, so the player controls it at once.
    // ensureAttached never spawns mpv.
    try {
      await playbackEngine.ensureAttached();
    } catch (err) {
      logger.debug('ensureAttached at startup failed (no mpv yet?):', err);
    }
    keepPlaybackAttached();
  }

  auth.warnOnPlainHttpLogin();
  if (isAddressRewritingHost()) {
    logger.warn('Jukebox Remote runs in a container or WSL, where port forwarding may rewrite source addresses. LAN checks may then treat internet clients as local.');
  }
  logBanner(config.webui);
  maybeOpenBrowser(withLaunchKey(adminPageUrl(owner.url), auth.launchKey), config.webui.autoOpenBrowser);
  installShutdownTriggers();

  logger.info('Jukebox Remote started successfully (port owner)');
}

async function main(): Promise<void> {
  logger.info('Jukebox Remote starting');

  const state = await resolveConfigState();
  if (!state.configured) {
    await runSetupMode(state.failure);
    return;
  }
  const acquired = await acquirePlayerPort(state, await createPlayerRuntime(state));
  if (acquired.mode === 'owner') await runPortOwner(acquired.owner);
}

function failStart(error: unknown): void {
  logger.error('Jukebox Remote failed to start:', error);
  // A direct terminal run would otherwise exit with no visible reason.
  const message = errorMessage(error);
  try {
    process.stderr.write(`Jukebox Remote failed to start: ${message} (log: ${logPath})\n`);
  } catch {
    /* best-effort */
  }
  process.exit(1);
}

main().catch(failStart);
