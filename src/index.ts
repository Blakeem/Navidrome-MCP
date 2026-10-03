#!/usr/bin/env node
/**
 * Navidrome MCP Server
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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { createRuntime, type Runtime } from './bootstrap.js';
import { readSavedWebuiEndpoint, resolveConfigState, type Config } from './config.js';
import { startHttpTransport, type HttpTransport } from './transport/http.js';
import type { NavidromeClient } from './client/navidrome-client.js';
import { isNavidromeUnreachable } from './client/auth-manager.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { playbackEngine } from './services/playback/playback-engine.js';
import { ScrobbleTracker } from './services/playback/scrobble-tracker.js';
import { logger } from './utils/logger.js';
import { getPackageVersion } from './utils/version.js';
import { MCP_CAPABILITIES, SETUP_CAPABILITIES } from './capabilities.js';
import { ensureWebForPlayback } from './web/spawn.js';
import { webOwnerPresent, webOwnerScrobbling } from './web/acquire.js';
import { startConfigServer } from './config-app/server.js';
import { buildSetupNotice, registerDegradedTools, type StartupFailure } from './config-app/degraded-tools.js';
import { openBrowser } from './utils/open-browser.js';
import { isLanReachable } from './webui/network.js';

// Belt-and-suspenders against any unhandled rejection escaping the system.
// Without this, Node 20+ terminates the process by default. The mpv IPC layer
// has its own settled-sentinel safety, but a single regression in tool code
// shouldn't crash the whole MCP server.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});

/** Setup mode serves no resources, so each mode declares its own capabilities. */
function createBareServer(capabilities: ServerCapabilities): Server {
  return new Server(
    { name: 'navidrome-mcp', version: getPackageVersion() },
    { capabilities }
  );
}

/** HTTP needs one Server per session and stdio needs one, so both build here to keep one tool surface. */
function createConfiguredServer(client: NavidromeClient, config: Config): Server {
  const server = createBareServer(MCP_CAPABILITIES);
  registerTools(server, client, config);
  registerResources(server, client);
  return server;
}

/**
 * Signals and, under stdio, stdin EOF run cleanup then exit, since StdioServerTransport
 * ignores EOF and a ref'd mpv socket or settings listener would keep the process alive.
 */
function installExitHandlers(cleanup: () => Promise<void>, watchStdin: boolean): void {
  let stopping = false;
  const shutdown = (exitCode: number): void => {
    if (stopping) return;
    stopping = true;
    void (async (): Promise<void> => {
      try {
        await cleanup();
      } catch (err) {
        logger.debug('shutdown cleanup error (continuing to exit):', err);
      } finally {
        process.exit(exitCode);
      }
    })();
  };
  process.once('SIGINT', () => { shutdown(130); });
  process.once('SIGTERM', () => { shutdown(143); });
  process.once('SIGHUP', () => { shutdown(129); });
  if (watchStdin) {
    process.stdin.once('end', () => { shutdown(0); });
    process.stdin.once('close', () => { shutdown(0); });
  }
}

/**
 * First-run / degraded mode, used when neither settings.json nor the env-var
 * fallback yields a usable config, or when stdio startup fails. An unreachable
 * Navidrome skips the auto-open, since its settings are not at fault. The auto-open
 * silently no-ops on headless/SSH, so the degraded tools hand the user the settings URL in band.
 */
async function runSetupMode(failure?: StartupFailure): Promise<void> {
  const settings = await startConfigServer();
  logger.warn(buildSetupNotice(settings.url, failure));
  if (failure?.unreachable !== true) {
    openBrowser(settings.url);
  }

  // Setup mode is local and interactive, so it always uses stdio.
  const server = createBareServer(SETUP_CAPABILITIES);
  registerDegradedTools(server, settings.url, failure);
  installExitHandlers(() => settings.close(), true);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Navidrome MCP Server started in setup mode (awaiting configuration)');
}

/**
 * Build the runtime. A stdio exit reaches the user only as a generic client
 * disconnect, so a stdio startup failure falls back to setup mode with the
 * reason and resolves null. An HTTP startup failure still exits.
 */
async function createRuntimeOrSetupMode(config: Config): Promise<Runtime | null> {
  try {
    return await createRuntime(config);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (config.transport.type === 'http') {
      throw new Error(
        `${reason} (fix settings.json with navidrome-config, or the NAVIDROME_* environment variables when no settings.json exists, then restart)`,
        { cause: error },
      );
    }
    logger.error('Navidrome MCP could not start with the current configuration:', error);
    await runSetupMode({ reason, unreachable: isNavidromeUnreachable(error) });
    return null;
  }
}

async function main(): Promise<void> {
  logger.debug('Starting Navidrome MCP Server...');
  logger.debug('Node version:', process.version);
  logger.debug('Platform:', process.platform);

  const state = await resolveConfigState();
  if (!state.configured) {
    await runSetupMode();
    return;
  }

  const runtime = await createRuntimeOrSetupMode(state.config);
  if (runtime === null) return;
  const { config, client } = runtime;

  // Spawned as an IPC child so it can follow this process's exit. Best effort,
  // so a player failure never stops MCP.
  await ensureWebForPlayback(config);

  // Exactly one process submits each play. MCP submits a track unless a
  // navidrome-web owns the port and is attached to mpv at that track's start.
  if (config.features.playback) {
    // Subscribe BEFORE adopting mpv so the tracker catches the initial state
    // emit (it hydrates without re-scrobbling the in-flight track).
    const tracker = new ScrobbleTracker(client, playbackEngine, async () => {
      return !(await webOwnerScrobbling(config.webui, readSavedWebuiEndpoint));
    });
    tracker.attach();
    // Adopt an already-playing mpv (e.g. left by a prior session) so the
    // scrobbler sees real state immediately. Best-effort and never spawns mpv
    // (ensureAttached only latches onto an existing socket).
    try {
      await playbackEngine.ensureAttached();
    } catch (err) {
      logger.debug('ensureAttached at startup failed (no mpv yet?):', err);
    }
  }

  // Bind the configured transport. HTTP serves remote clients over a socket
  // (one MCP Server per session). stdio serves the single local-process client.
  let httpHandle: HttpTransport | undefined;
  if (config.transport.type === 'http') {
    // A NetworkPolicy-locked or same-pod deployment is a legitimate no-token
    // case, so this warns instead of refusing to start.
    if (isLanReachable(config.transport.host) && config.transport.authToken === undefined) {
      logger.warn(
        `MCP HTTP transport is bound to ${config.transport.host} with NO auth token — ` +
        'anyone who can reach the port gets full, unauthenticated control of your Navidrome ' +
        'library. Set transport.authToken, or restrict access with a network policy / ' +
        'authenticating reverse proxy.'
      );
    }

    httpHandle = await startHttpTransport({
      host: config.transport.host,
      port: config.transport.port,
      authToken: config.transport.authToken,
      allowedHosts: config.transport.allowedHosts,
      allowedOrigins: config.transport.allowedOrigins,
      createMcpServer: () => createConfiguredServer(client, config),
    });

    logger.info(`Navidrome MCP Server listening on ${httpHandle.url} (Streamable HTTP)`);
  } else {
    const transport = new StdioServerTransport();
    const server = createConfiguredServer(client, config);
    await server.connect(transport);
    logger.info('Navidrome MCP Server started successfully');
  }

  installExitHandlers(async () => {
    if (httpHandle !== undefined) await httpHandle.close();
    // An MCP that never controlled mpv must not stop another MCP's playback.
    if (
      config.features.playback &&
      playbackEngine.hasControlledMpv() &&
      !(await webOwnerPresent(config.webui, readSavedWebuiEndpoint))
    ) {
      await playbackEngine.quitMpv();
      logger.info('MCP exit: no web server owns mpv, so it was quit');
    }
  }, config.transport.type === 'stdio');
}

main().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
