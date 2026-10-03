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
export interface Runtime {
  config: Config;
  client: NavidromeClient;
}

/**
 * Shared startup for src/index.ts and src/web/main.ts. Scrobbler wiring is left
 * to each entry point, because scrobble ownership depends on the process.
 * `config` is required because only resolveConfigState() includes the env fallback.
 */
export async function createRuntime(config: Config): Promise<Runtime> {
  logger.setDebug(config.debug);

  const client = new NavidromeClient(config);
  await client.initialize();

  await libraryManager.initialize(client, config);
  await filterCacheManager.initialize(client, config);

  // Configure the singleton engine with the loaded config so tools can
  // lazy-spawn mpv on first invocation. Gated on the playback feature (mpv
  // detected), since `buildStreamUrl()` and every play_* tool depend on it.
  if (config.features.playback) {
    playbackEngine.configure(config);
  }

  return { config, client };
}
