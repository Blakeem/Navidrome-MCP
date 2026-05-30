#!/usr/bin/env node
/**
 * Navidrome MCP Server - Settings app launcher (bin: navidrome-config)
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

import { startConfigServer } from './server.js';
import { openBrowser } from '../utils/open-browser.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  const { url, close } = await startConfigServer();

  // Standalone CLI context (NOT MCP stdio) — printing to stdout is correct and
  // is the guaranteed fallback if the browser can't be opened automatically.
  process.stdout.write(
    `\n  Navidrome MCP — Settings\n  Open this in your browser:  ${url}\n  (attempting to open it for you…)  Press Ctrl-C when you're done.\n\n`,
  );
  openBrowser(url);

  const shutdown = (): void => {
    void close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('navidrome-config failed to start:', err);
  process.exit(1);
});
