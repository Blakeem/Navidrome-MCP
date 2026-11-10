/**
 * Navidrome MCP Server - Settings page of the running Jukebox Remote
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { startConfigServer } from '../config-app/server.js';
import { SETTINGS_PAGE_IDLE_TIMEOUT_MS } from '../constants/timeouts.js';
import { logger } from '../utils/logger.js';
import type { SettingsPageOpener } from '../webui/routes/player.js';

type StartSettingsServer = typeof startConfigServer;
type SettingsServer = Awaited<ReturnType<StartSettingsServer>>;

interface SettingsPageHolder extends SettingsPageOpener {
  close(): Promise<void>;
}

/**
 * Holds at most one settings server, so every click of All settings opens the same page. The page
 * has no power button, so the server closes when idle and the next open starts a new one.
 */
export function createSettingsPageHolder(start: StartSettingsServer = startConfigServer): SettingsPageHolder {
  let current: Promise<SettingsServer> | null = null;

  const startServer = (): Promise<SettingsServer> => {
    const starting = start({
      idleTimeoutMs: SETTINGS_PAGE_IDLE_TIMEOUT_MS,
      onIdleTimeout: () => {
        logger.info('settings page: idle, so its server closed');
        if (current === starting) current = null;
      },
    });
    // A failed start leaves nothing to reuse, so the next open tries again. The caller logs the failure.
    starting.then(
      (server) => logger.info(`settings page: serving ${server.url}`),
      () => {
        if (current === starting) current = null;
      },
    );
    return starting;
  };

  return {
    async open(): Promise<string> {
      current ??= startServer();
      const server = await current;
      return server.url;
    },
    async close(): Promise<void> {
      const closing = current;
      current = null;
      if (closing === null) return;
      const server = await closing.catch(() => null);
      await server?.close();
    },
  };
}
