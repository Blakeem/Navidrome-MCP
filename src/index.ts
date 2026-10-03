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
import { createRuntime, type Runtime } from './bootstrap.js';
import { resolveConfigState, type Config } from './config.js';
import { startHttpTransport, type HttpTransport } from './transport/http.js';
import type { NavidromeClient } from './client/navidrome-client.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { playbackEngine } from './services/playback/playback-engine.js';
import { ScrobbleTracker } from './services/playback/scrobble-tracker.js';
import { logger } from './utils/logger.js';
import { getPackageVersion } from './utils/version.js';
import { MCP_CAPABILITIES } from './capabilities.js';
import { ensureWebForPlayback } from './web/spawn.js';
import { webOwnerPresent, webOwnerScrobbling } from './web/acquire.js';
import { startConfigServer } from './config-app/server.js';
import { registerDegradedTools } from './config-app/degraded-tools.js';
import { openBrowser } from './utils/open-browser.js';
import { isLanReachable } from './webui/network.js';

// Belt-and-suspenders against any unhandled rejection escaping the system.
// Without this, Node 20+ terminates the process by default. The mpv IPC layer
// has its own settled-sentinel safety, but a single regression in tool code
// shouldn't crash the whole MCP server.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});

/** Holds the server identity and capabilities in one place for setup and configured modes. */
function createBareServer(): Server {
  return new Server(
    { name: 'navidrome-mcp', version: getPackageVersion() },
    { capabilities: MCP_CAPABILITIES }
  );
}

/**
 * Build a fully-configured MCP {@link Server}: a fresh instance with all tools
 * and resources registered against the shared, already-authenticated client.
 *
 * Factored out because the Streamable HTTP transport is stateful and needs one
 * Server per session, while stdio needs exactly one. Both call this so the two
 * paths register an identical surface.
 */
function createConfiguredServer(client: NavidromeClient, config: Config): Server {
  const server = createBareServer();
  registerTools(server, client, config);
  registerResources(server, client);
  return server;
}

/**
 * Exit with 128 + signal number after a best-effort cleanup. StdioServerTransport
 * keeps stdin referenced, so without an explicit exit the process lingers until
 * the MCP host escalates to SIGKILL.
 */
function installExitHandlers(cleanup: () => Promise<void>): void {
  let stopping = false;
  const onSignal = (signo: number) => (): void => {
    if (stopping) return;
    stopping = true;
    void (async (): Promise<void> => {
      try {
        await cleanup();
      } catch (err) {
        logger.debug('shutdown cleanup error (continuing to exit):', err);
      } finally {
        process.exit(128 + signo);
      }
    })();
  };
  process.once('SIGINT', onSignal(2));
  process.once('SIGTERM', onSignal(15));
}

/**
 * First-run / degraded mode, used when neither settings.json nor the env-var
 * fallback yields a usable config, or when stdio startup fails with the saved
 * settings. The auto-open silently no-ops on headless/SSH, so the degraded
 * tools hand the user the settings URL in band.
 */
async function runSetupMode(failureReason?: string): Promise<void> {
  const settings = await startConfigServer();
  const headline =
    failureReason === undefined
      ? 'Navidrome MCP is not configured.'
      : `Navidrome MCP could not start with the saved settings (${failureReason}).`;
  logger.warn(
    `${headline} Open the settings page to set it up: ${settings.url}\n` +
    'Headless/container? The settings page is loopback-only — configure via environment ' +
    'variables instead: NAVIDROME_URL, NAVIDROME_USERNAME, NAVIDROME_PASSWORD ' +
    '(plus MCP_TRANSPORT=http and MCP_HTTP_EXPOSE=true for a remote-reachable container).'
  );
  openBrowser(settings.url);

  // Setup mode is local and interactive, so it always uses stdio.
  const server = createBareServer();
  registerDegradedTools(server, settings.url, failureReason);
  installExitHandlers(() => settings.close());

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
      throw new Error(`${reason} (run navidrome-config to fix the settings, then restart)`, { cause: error });
    }
    logger.error('Navidrome MCP could not start with the saved settings:', error);
    await runSetupMode(reason);
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

  // createRuntime is shared with src/web/main.ts.
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
      return !(await webOwnerScrobbling(config.webui.port, config.webui.host));
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

  if (httpHandle !== undefined || config.features.playback) {
    installExitHandlers(async () => {
      if (httpHandle !== undefined) await httpHandle.close();
      if (config.features.playback && !(await webOwnerPresent(config.webui.port, config.webui.host))) {
        await playbackEngine.quitMpv();
        logger.info('MCP exit: no web server owns mpv, so it was quit');
      }
    });
  }
}

main().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
