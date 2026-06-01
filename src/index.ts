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
import { createRuntime } from './bootstrap.js';
import { resolveConfigState } from './config.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { playbackEngine } from './services/playback/playback-engine.js';
import { ScrobbleTracker } from './services/playback/scrobble-tracker.js';
import { shouldMcpSubmit } from './services/playback/scrobble-election.js';
import { logger } from './utils/logger.js';
import { getPackageVersion } from './utils/version.js';
import { MCP_CAPABILITIES } from './capabilities.js';
import { ensureWebServerRunning, type WebServerStatus } from './web/spawn.js';
import { probeHealthz } from './web/acquire.js';
import { startConfigServer } from './config-app/server.js';
import { registerDegradedTools } from './config-app/degraded-tools.js';
import { openBrowser } from './utils/open-browser.js';

// Belt-and-suspenders against any unhandled rejection escaping the system —
// without this, Node 20+ terminates the process by default. The mpv IPC layer
// has its own settled-sentinel safety, but a single regression in tool code
// shouldn't crash the whole MCP server.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});

async function main(): Promise<void> {
  try {
    // Add startup diagnostics for troubleshooting. Config now comes from the
    // settings.json store (resolved below), not env — so we don't log env
    // presence here, which would be misleading under the store-based model.
    logger.debug('Starting Navidrome MCP Server...');
    logger.debug('Node version:', process.version);
    logger.debug('Platform:', process.platform);

    const server = new Server(
      {
        name: 'navidrome-mcp',
        version: getPackageVersion(),
      },
      {
        capabilities: MCP_CAPABILITIES,
      }
    );

    // First-run / degraded mode: when settings.json has no usable Navidrome URL
    // we cannot build a client. Instead of crashing, start the loopback settings
    // server, try to open the browser, and register a minimal toolset that hands
    // the user the settings URL (the auto-open silently no-ops on headless/SSH,
    // so the in-band URL is the real path to first config).
    const state = await resolveConfigState();
    if (!state.configured) {
      const settings = await startConfigServer();
      logger.warn(
        `Navidrome MCP is not configured. Open the settings page to set it up: ${settings.url}`
      );
      openBrowser(settings.url);
      registerDegradedTools(server, settings.url);

      const stopSettings = (): void => {
        void settings.close();
      };
      process.once('SIGINT', stopSettings);
      process.once('SIGTERM', stopSettings);

      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info('Navidrome MCP Server started in setup mode (awaiting configuration)');
      return;
    }

    // Shared bootstrap: resolves config, authenticates the client, primes the
    // library/filter caches, and configures the playback engine. Identical for
    // the MCP server and the future standalone web server.
    const { config, client } = await createRuntime();

    registerTools(server, client, config);
    registerResources(server, client);

    // Standalone web player (spec §6). Instead of an in-process server, MCP
    // spawns the SAME `navidrome-web` process it would run standalone, as an IPC
    // CHILD so the child can react to this MCP's exit (stop with it by default,
    // or persist if webui.persistAfterMcpExit). Eager at startup, gated on
    // playback + webui.enabled. The spawn is best-effort and non-fatal — the MCP
    // server stays up even if the player can't start (e.g. port conflict). Done
    // BEFORE the scrobbler election because its result decides who scrobbles.
    let webStatus: WebServerStatus = 'unavailable';
    if (config.features.playback && config.webui.enabled) {
      webStatus = await ensureWebServerRunning(config);
    }

    // Auto-scrobble plays to Navidrome (Last.fm rules: now-playing on start,
    // submission past 50% of duration or 4 min, whichever first; ≥30s tracks
    // only). The tracker observes the shared mpv via the engine state stream,
    // so MCP- and web-initiated plays are tracked identically.
    //
    // Single-submitter election (spec §6.4): exactly one process submits each
    // mpv play. When a `navidrome-web` owner is running/spawned it is the
    // submitter (the playback survivor — keeps scrobbling after MCP closes), so
    // MCP stands down. MCP becomes the active host when there is NO web owner:
    // MCP-only mode (webui disabled) OR the web server couldn't be brought up
    // (foreign port / spawn failure) — otherwise plays would go unscrobbled.
    const mcpIsActiveHost =
      config.features.playback && (shouldMcpSubmit(config) || webStatus === 'unavailable');
    if (mcpIsActiveHost) {
      // Subscribe BEFORE adopting mpv so the tracker catches the initial state
      // emit (it hydrates without re-scrobbling the in-flight track).
      const tracker = new ScrobbleTracker(client, playbackEngine);
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

    // mpv teardown on MCP exit (lifecycle §B.1): mpv stops with its last host.
    // On a graceful signal, quit mpv IFF no web server is running — when a
    // `navidrome-web` owns the port (incl. an MCP-spawned child or a persisted
    // one) it owns mpv and tears it down itself, so MCP must not double-quit.
    // Covers MCP-only mode and the spawn-failed case. Probe is loopback.
    if (config.features.playback) {
      let stopping = false;
      // Exit with the conventional 128 + signal number so a supervisor sees
      // signal termination (SIGINT → 130, SIGTERM → 143) rather than a clean
      // 0 that masks the fact we were killed. Teardown is identical for both.
      const makeExit = (signo: number) => (): void => {
        if (stopping) return;
        stopping = true;
        void (async (): Promise<void> => {
          try {
            const probe = await probeHealthz(config.webui.port);
            if (probe !== 'ours') {
              await playbackEngine.quitMpv();
              logger.info('MCP exit: no web server owns mpv — quit it');
            }
          } catch {
            /* best-effort */
          }
          process.exit(128 + signo);
        })();
      };
      process.once('SIGINT', makeExit(2));
      process.once('SIGTERM', makeExit(15));
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('Navidrome MCP Server started successfully');
  } catch (error) {
    // Provide detailed error information for debugging
    logger.error('Failed to start Navidrome MCP Server');
    logger.error('Error details:', error);
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Stack trace:', error.stack);
    }
    throw error; // Re-throw to be caught by outer handler
  }
}

main().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
