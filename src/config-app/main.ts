/**
 * Navidrome MCP Server - Settings page launcher (`navidrome-mcp settings`)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { startConfigServer } from './server.js';
import { openBrowser } from '../utils/open-browser.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  const { url, close } = await startConfigServer({ host: 'settings-command' });

  // This CLI is not an MCP stdio server, so stdout can carry the URL for a host where no
  // browser opens.
  process.stdout.write(
    `\n  Navidrome MCP Settings\n  Open this in your browser:  ${url}\n  (attempting to open it for you…)  Press Ctrl-C when you're done.\n\n`,
  );
  openBrowser(url);

  const shutdown = (): void => {
    void close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('The settings page failed to start:', err);
  process.exit(1);
});
