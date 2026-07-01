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
import { ensureWebServerRunning } from './web/spawn.js';
import { webOwnerPresent } from './web/acquire.js';
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

/**
 * Build a fully-configured MCP {@link Server}: a fresh instance with all tools
 * and resources registered against the shared, already-authenticated client.
 *
 * Factored out because the Streamable HTTP transport is stateful and needs one
 * Server per session, while stdio needs exactly one — both call this so the two
 * paths register an identical surface.
 */
function createConfiguredServer(client: NavidromeClient, config: Config): Server {
  const server = new Server(
    {
      name: 'navidrome-mcp',
      version: getPackageVersion(),
    },
    {
      capabilities: MCP_CAPABILITIES,
    }
  );
  registerTools(server, client, config);
  registerResources(server, client);
  return server;
}

async function main(): Promise<void> {
  try {
    // Add startup diagnostics for troubleshooting. Config now comes from the
    // settings.json store (resolved below), not env — so we don't log env
    // presence here, which would be misleading under the store-based model.
    logger.debug('Starting Navidrome MCP Server...');
    logger.debug('Node version:', process.version);
    logger.debug('Platform:', process.platform);

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

      // Setup mode is inherently local + interactive, so it always uses stdio
      // (the HTTP transport is opt-in for a configured, headless deployment).
      const server = new Server(
        { name: 'navidrome-mcp', version: getPackageVersion() },
        { capabilities: MCP_CAPABILITIES }
      );
      registerDegradedTools(server, settings.url);

      // Mirror the happy-path handlers: close the config server, then exit with
      // the conventional 128 + signal number. StdioServerTransport keeps stdin
      // referenced, so without an explicit exit the process would linger after a
      // signal until the MCP host escalates to SIGKILL. Best-effort: exit even
      // if close() rejects.
      const stopSettings = (signo: number) => (): void => {
        void (async (): Promise<void> => {
          try {
            await settings.close();
          } finally {
            process.exit(128 + signo);
          }
        })();
      };
      process.once('SIGINT', stopSettings(2));
      process.once('SIGTERM', stopSettings(15));

      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info('Navidrome MCP Server started in setup mode (awaiting configuration)');
      return;
    }

    // Shared bootstrap: resolves config, authenticates the client, primes the
    // library/filter caches, and configures the playback engine. Identical for
    // the MCP server and the future standalone web server.
    const { config, client } = await createRuntime(state.config);

    // Standalone web player (spec §6). Instead of an in-process server, MCP
    // spawns the SAME `navidrome-web` process it would run standalone, as an IPC
    // CHILD so the child can react to this MCP's exit (stop with it by default,
    // or persist if webui.persistAfterMcpExit). Eager at startup, gated on
    // playback + webui.enabled. The spawn is best-effort and non-fatal — the MCP
    // server stays up even if the player can't start (e.g. port conflict). The
    // return value no longer feeds the scrobble decision (that's now a live,
    // per-track probe below), so we don't capture it.
    if (config.features.playback && config.webui.enabled) {
      await ensureWebServerRunning(config);
    }

    // Auto-scrobble plays to Navidrome (Last.fm rules: now-playing on start,
    // submission past 50% of duration or 4 min, whichever first; ≥30s tracks
    // only). The tracker observes the shared mpv via the engine state stream,
    // so MCP- and web-initiated plays are tracked identically.
    //
    // Single-submitter rule (spec §6.4), evaluated LIVE per track rather than
    // once from static config: exactly one process counts each mpv play. MCP
    // ALWAYS attaches a tracker, but for each track it submits IFF no
    // `navidrome-web` owns the port at that track's start (webOwnerPresent) —
    // the same signal the mpv teardown below uses. A running web owner is the
    // submitter (and the playback survivor that keeps scrobbling after MCP
    // closes); MCP scrobbles whenever there's no web owner (MCP-only mode, a
    // foreign/failed web, or a web that came up or went away mid-session). The
    // tracker skips the in-flight track on attach, so handoffs don't double- or
    // miss-count the track playing when ownership changes.
    if (config.features.playback) {
      // Subscribe BEFORE adopting mpv so the tracker catches the initial state
      // emit (it hydrates without re-scrobbling the in-flight track).
      const tracker = new ScrobbleTracker(client, playbackEngine, async () => {
        return !(await webOwnerPresent(config.webui.port));
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
    // (one MCP Server per session); stdio serves the single local-process client
    // the same way it always has.
    let httpHandle: HttpTransport | undefined;
    if (config.transport.type === 'http') {
      // Loud warning for the genuinely unsafe combination: bound to a
      // non-loopback address with no bearer token. We don't refuse to start —
      // a NetworkPolicy-locked / same-pod deployment is a legitimate no-token
      // case — but it must never happen silently.
      const loopback = new Set(['127.0.0.1', '::1', 'localhost']);
      if (!loopback.has(config.transport.host) && config.transport.authToken === undefined) {
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
      let stopping = false;
      const shutdown = (signo: number) => (): void => {
        if (stopping) return;
        stopping = true;
        void (async (): Promise<void> => {
          try {
            if (httpHandle !== undefined) await httpHandle.close();
            if (config.features.playback && !(await webOwnerPresent(config.webui.port))) {
              await playbackEngine.quitMpv();
              logger.info('MCP exit: no web server owns mpv — quit it');
            }
          } catch (err) {
            logger.debug('shutdown cleanup error (continuing to exit):', err);
          } finally {
            process.exit(128 + signo);
          }
        })();
      };
      process.once('SIGINT', shutdown(2));
      process.once('SIGTERM', shutdown(15));
    }
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
