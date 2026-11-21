/**
 * Navidrome MCP Server - Jukebox Remote log file path
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { dirname, join } from 'node:path';

import { getSettingsStorePath } from '../config/store-path.js';

const LOG_FILE = 'jukebox-remote.log';

/** Pure, so the help text can show the path without installing the file sink. */
export function jukeboxLogPath(): string {
  return join(dirname(getSettingsStorePath()), LOG_FILE);
}
