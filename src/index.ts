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
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { playbackEngine } from './services/playback/playback-engine.js';
import { ScrobbleTracker } from './services/playback/scrobble-tracker.js';
import { logger } from './utils/logger.js';
import { getPackageVersion } from './utils/version.js';
import { MCP_CAPABILITIES } from './capabilities.js';
import { WebUIServer } from './webui/index.js';

// Belt-and-suspenders against any unhandled rejection escaping the system —
// without this, Node 20+ terminates the process by default. The mpv IPC layer
// has its own settled-sentinel safety, but a single regression in tool code
// shouldn't crash the whole MCP server.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', reason);
});

async function main(): Promise<void> {
  try {
    // Add startup diagnostics for troubleshooting
    logger.debug('Starting Navidrome MCP Server...');
    logger.debug('Node version:', process.version);
    logger.debug('Platform:', process.platform);
    logger.debug('Environment variables present:', {
      NAVIDROME_URL: (process.env['NAVIDROME_URL'] !== null && process.env['NAVIDROME_URL'] !== undefined && process.env['NAVIDROME_URL'] !== ''),
      NAVIDROME_USERNAME: (process.env['NAVIDROME_USERNAME'] !== null && process.env['NAVIDROME_USERNAME'] !== undefined && process.env['NAVIDROME_USERNAME'] !== ''),
      NAVIDROME_PASSWORD: (process.env['NAVIDROME_PASSWORD'] !== null && process.env['NAVIDROME_PASSWORD'] !== undefined && process.env['NAVIDROME_PASSWORD'] !== ''),
    });

    // Shared bootstrap: resolves config, authenticates the client, primes the
    // library/filter caches, and configures the playback engine. Identical for
    // the MCP server and the future standalone web server.
    const { config, client } = await createRuntime();

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

    // Auto-scrobble plays to Navidrome (Last.fm rules: now-playing on start,
    // submission past 50% of duration or 4 min, whichever first; ≥30s tracks
    // only). The tracker observes the shared mpv via the engine state stream,
    // so MCP- and web-initiated plays are tracked identically. It's attached
    // here in the entry point (not in tool registration) because scrobbling is
    // a process-lifetime playback concern, not a tool-registration concern —
    // and the standalone-web spec (§6.4) ultimately moves this single line to
    // the web server, the playback survivor. The tracker has no explicit
    // shutdown: on SIGINT/SIGTERM the engine closes its IPC socket (mpv keeps
    // running, detached) and the tracker is torn down with the process; any
    // in-flight /scrobble request is abandoned, acceptable per Last.fm
    // best-effort semantics.
    if (config.features.playback) {
      new ScrobbleTracker(client, playbackEngine).attach();
    }

    // Companion web UI for mpv playback control. Only initialized when the
    // playback feature itself is enabled (mpv detected) and the user hasn't
    // disabled the panel via WEBUI_ENABLED=false. `init()` doesn't bind a
    // port unless something is already queued — first-play in the current
    // session triggers the bind lazily via the engine state stream. Errors
    // here are non-fatal: the MCP server stays up even if the panel can't
    // start (e.g. port collision).
    if (config.features.playback && config.webui.enabled) {
      const webui = new WebUIServer(config, client);
      try {
        await webui.init();
      } catch (err) {
        logger.warn('Web UI init failed (continuing without panel):', err);
      }
      const stopWebUI = (): void => {
        void webui.stop();
      };
      process.once('SIGINT', stopWebUI);
      process.once('SIGTERM', stopWebUI);
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
