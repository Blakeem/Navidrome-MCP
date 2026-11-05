/**
 * Navidrome MCP Server - Cross-platform browser launcher
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawn } from 'node:child_process';
import { logger } from './logger.js';

/** The launch is best effort, so callers also print the URL for a headless or SSH host. */
export function openBrowser(url: string): void {
  const { command, args } = browserCommand(url);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      logger.debug(`openBrowser: could not launch a browser for ${url} (no GUI?)`);
    });
    child.unref();
  } catch {
    logger.debug(`openBrowser: spawn threw for ${url} (no GUI?)`);
  }
}

function browserCommand(url: string): { command: string; args: string[] } {
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- others use xdg-open
  switch (process.platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      // start takes its first quoted argument as the window title, so the empty title keeps a
      // quoted URL from being read as one.
      return { command: 'cmd', args: ['/c', 'start', '""', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}
