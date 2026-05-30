/**
 * Navidrome MCP Server - Settings store path resolution
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

import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = 'navidrome-mcp';
const STORE_FILE = 'settings.json';

/**
 * Absolute path to the canonical `settings.json` store.
 *
 * Mirrors the OS-awareness of `getDefaultIpcPath()` (mpv-process.ts):
 *   - Linux:   `${XDG_CONFIG_HOME:-~/.config}/navidrome-mcp/settings.json`
 *   - macOS:   `~/Library/Application Support/navidrome-mcp/settings.json`
 *   - Windows: `%APPDATA%\navidrome-mcp\settings.json`
 *
 * `NAVIDROME_CONFIG_PATH` overrides the location entirely (it points at the
 * **file**, not the directory). This is a *location* override used by tests
 * (isolated temp file per run), portable installs, and multi-profile setups —
 * it is NOT a config-value override.
 */
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

  // Linux / other POSIX
  const xdgConfig = process.env['XDG_CONFIG_HOME'];
  const base = xdgConfig !== undefined && xdgConfig.trim() !== ''
    ? xdgConfig.replace(/\/+$/, '')
    : join(homedir(), '.config');
  return join(base, APP_DIR, STORE_FILE);
}
