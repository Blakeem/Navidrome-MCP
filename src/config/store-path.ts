/**
 * Navidrome MCP Server - Settings store path resolution
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = 'navidrome-mcp';
const STORE_FILE = 'settings.json';

/** `NAVIDROME_CONFIG_PATH` overrides the file location, not config values. */
export function getSettingsStorePath(): string {
  const override = process.env['NAVIDROME_CONFIG_PATH'];
  if (override !== undefined && override.trim() !== '') {
    return override;
  }

  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    const base = appData !== undefined && appData.trim() !== ''
      ? appData
      : join(homedir(), 'AppData', 'Roaming');
    return join(base, APP_DIR, STORE_FILE);
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_DIR, STORE_FILE);
  }

  const xdgConfig = process.env['XDG_CONFIG_HOME'];
  const base = xdgConfig !== undefined && xdgConfig.trim() !== ''
    ? xdgConfig
    : join(homedir(), '.config');
  return join(base, APP_DIR, STORE_FILE);
}
