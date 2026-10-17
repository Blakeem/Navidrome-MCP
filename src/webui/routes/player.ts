/**
 * Navidrome MCP Server - Web UI Player State / Settings / Shutdown Routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../../config.js';
import type { WebuiTheme } from '../../constants/defaults.js';
import { readSettings, writeSettings, SettingsFileSchema, type SettingsFile } from '../../config/store.js';
import { PlayerSettingsPatchSchema } from '../../schemas/index.js';
import { playbackEngine } from '../../services/playback/playback-engine.js';
import { logger } from '../../utils/logger.js';
import { getPersist, getTheme, getVisualizer, setPersist, setTheme, setVisualizer } from '../../web/player-runtime.js';
import type { SseBroadcaster } from '../broadcaster.js';
import { readValidBody, writeError, writeJson } from '../http-helpers.js';
import { isLocalRequest } from '../loopback.js';

interface PlayerSettingsBody {
  persistAfterMcpExit: boolean;
  autoOpenBrowser: boolean;
  theme: WebuiTheme | null;
  visualizer: boolean;
  visualizerUnsupported: boolean;
}

/**
 * `autoOpenBrowser` affects only the next launch, so it has no live flag and each caller supplies
 * the stored value, or the launch config when no store exists.
 */
function playerSettingsBody(autoOpenBrowser: boolean): PlayerSettingsBody {
  return {
    persistAfterMcpExit: getPersist(),
    autoOpenBrowser,
    theme: getTheme(),
    visualizer: getVisualizer(),
    visualizerUnsupported: playbackEngine.isVisualizerUnsupported(),
  };
}

/**
 * `isLocal` is per request, so only a local browser shows the settings and power buttons.
 * `lrclibEnabled` shapes only the overlay's empty-state note, since a file tag can carry lyrics.
 */
export function handlePlayerState(req: IncomingMessage, res: ServerResponse, config: Config): void {
  writeJson(res, 200, {
    isLocal: isLocalRequest(req),
    theme: getTheme(),
    lyrics: { lrclibEnabled: config.features.lyrics },
  });
}

export function handleGetPlayerSettings(req: IncomingMessage, res: ServerResponse, config: Config): void {
  if (!isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  const storedAutoOpen = readSettings()?.webui?.autoOpenBrowser;
  writeJson(res, 200, playerSettingsBody(storedAutoOpen ?? config.webui.autoOpenBrowser));
}

/**
 * The write merges only the webui keys into the stored file, so credentials and other settings are
 * never overwritten. `persisted` is false when the change holds for this session only.
 */
export async function handleSetPlayerSettings(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  broadcaster: Pick<SseBroadcaster, 'broadcastNow'>,
): Promise<void> {
  if (!isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }

  const input = await readValidBody(req, res, PlayerSettingsPatchSchema);
  if (input === null) return;
  let persistedWebui: NonNullable<SettingsFile['webui']> | null = null;

  // The live flags matter to the running process, so they apply before the best-effort write.
  if (input.persistAfterMcpExit !== undefined) {
    setPersist(input.persistAfterMcpExit);
  }
  if (input.theme !== undefined) {
    setTheme(input.theme);
  }
  if (input.visualizer !== undefined) {
    setVisualizer(input.visualizer);
    void playbackEngine.syncVisualizerFilter();
  }

  const current = readSettings();
  if (current === null) {
    // No usable store is normal in env-fallback mode. A near-empty file written here would replace
    // that config, since a usable store wins over env.
    logger.warn('player settings: settings.json missing; applied for this session only');
  } else {
    const webui = { ...(current.webui ?? {}) };
    if (input.persistAfterMcpExit !== undefined) webui.persistAfterMcpExit = input.persistAfterMcpExit;
    if (input.autoOpenBrowser !== undefined) webui.autoOpenBrowser = input.autoOpenBrowser;
    if (input.theme !== undefined) webui.theme = input.theme;
    if (input.visualizer !== undefined) webui.visualizer = input.visualizer;
    const merged = { ...current, webui };
    // A file that does not parse back would leave the store unusable.
    const check = SettingsFileSchema.safeParse(merged);
    if (!check.success) {
      logger.warn('player settings: merged settings failed validation; not writing (applied live only)');
    } else {
      try {
        writeSettings(merged);
        persistedWebui = webui;
      } catch (err) {
        logger.warn('player settings: failed to persist to settings.json:', err);
      }
    }
  }

  const storedWebui = persistedWebui ?? current?.webui;
  writeJson(res, 200, {
    ...playerSettingsBody(storedWebui?.autoOpenBrowser ?? config.webui.autoOpenBrowser),
    persisted: persistedWebui !== null,
  });
  broadcaster.broadcastNow();
}

export const MCP_LEASE_PATH = '/api/mcp-lease';

/** The entry point decides what a close means, so the route only counts. */
export interface McpLeaseCounter {
  open(): void;
  close(): void;
}

/**
 * The response stays open while the MCP lives, and the OS closes the socket when that MCP dies, so
 * the player counts every MCP using it, not only its spawner.
 */
export function handleMcpLease(req: IncomingMessage, res: ServerResponse, leases: McpLeaseCounter): void {
  if (!isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  req.resume();
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.flushHeaders();
  leases.open();
  res.once('close', () => leases.close());
}

export function handleShutdown(
  req: IncomingMessage,
  res: ServerResponse,
  shutdown: () => void,
): void {
  if (!isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  writeJson(res, 200, { ok: true });
  // The delay lets the 200 reach the browser before the server closes.
  setTimeout(shutdown, 50).unref();
}
