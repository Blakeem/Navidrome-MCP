/**
 * Navidrome MCP Server - Shared runtime bootstrap
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readSavedAudioDevice, readSavedWebuiSettings, saveAudioDevice, type Config } from './config.js';
import { NavidromeClient } from './client/navidrome-client.js';
import { libraryManager } from './services/library-manager.js';
import { filterCacheManager } from './services/filter-cache-manager.js';
import { playbackEngine } from './services/playback/playback-engine.js';
import { logger } from './utils/logger.js';

/**
 * The library and filter caches and the playback engine are module singletons that createRuntime
 * configures, so they are not part of the returned runtime.
 */
export interface Runtime {
  config: Config;
  client: NavidromeClient;
}

/**
 * Scrobbler wiring stays in each entry point, since scrobble ownership depends on the process.
 * The caller passes `config` because only resolveConfigState() applies the env fallback.
 */
export async function createRuntime(config: Config): Promise<Runtime> {
  logger.setDebug(config.debug);

  const client = new NavidromeClient(config);
  await client.initialize();

  await libraryManager.initialize(client, config);
  await filterCacheManager.initialize(client, config);

  // Tools lazy-spawn mpv on first use, so the engine needs the config before any tool runs.
  if (config.features.playback) {
    playbackEngine.configure(config);
    // Read at each mpv spawn, so a visualizer toggle saved after this process started applies.
    playbackEngine.setVisualizerSource(
      () => config.webui.enabled && (readSavedWebuiSettings()?.visualizer ?? config.webui.visualizer),
    );
    // A saved null means the OS default, so only a missing store falls back to the startup config.
    playbackEngine.setAudioDeviceSource(
      () => {
        const saved = readSavedAudioDevice();
        return saved === undefined ? config.playbackAudioDevice : saved;
      },
      { save: saveAudioDevice },
    );
  }

  return { config, client };
}
