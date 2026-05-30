/**
 * Navidrome MCP Server - Shared runtime bootstrap
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

import { loadConfig } from './config.js';
import type { Config } from './config.js';
import { NavidromeClient } from './client/navidrome-client.js';
import { libraryManager } from './services/library-manager.js';
import { filterCacheManager } from './services/filter-cache-manager.js';
import { playbackEngine } from './services/playback/playback-engine.js';
import { logger } from './utils/logger.js';

/**
 * The fully-initialized core every entry point needs to operate: the resolved
 * config plus an authenticated, ready-to-use client. The library and filter
 * caches and the playback engine are module singletons configured as a side
 * effect of this call, so they don't need to be returned.
 */
interface Runtime {
  config: Config;
  client: NavidromeClient;
}

/**
 * Shared startup sequence used by both the MCP server (`src/index.ts`) and,
 * later, the standalone web server. Resolves config, authenticates the client,
 * primes the library/filter caches, and configures the playback engine so any
 * transport-agnostic tool impl can run identically regardless of who launched
 * the process.
 *
 * Deliberately does NOT attach the scrobbler — scrobbling ownership is
 * process-conditional (the playback survivor scrobbles; see the standalone-web
 * spec §6.4), so each entry point wires it itself after calling this.
 */
export async function createRuntime(): Promise<Runtime> {
  const config = await loadConfig();
  logger.setDebug(config.debug);

  const client = new NavidromeClient(config);
  await client.initialize();

  // Initialize library manager with user data and configuration.
  await libraryManager.initialize(client, config);

  // Initialize filter cache manager for enhanced search functionality.
  await filterCacheManager.initialize(client, config);

  // Configure the singleton engine with the loaded config so tools can
  // lazy-spawn mpv on first invocation. Gated on the playback feature (mpv
  // detected) — `buildStreamUrl()` and every play_* tool depend on it.
  if (config.features.playback) {
    playbackEngine.configure(config);
  }

  return { config, client };
}
