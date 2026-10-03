/**
 * Navidrome MCP Server - Cross-platform browser launcher
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

import { spawn } from 'node:child_process';
import { logger } from './logger.js';

/** Best effort only. Callers always surface the URL too, since headless or SSH hosts cannot open a browser. */
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
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- intentional: all non-darwin/win32 platforms (linux, freebsd, etc.) fall through to xdg-open as a best-effort attempt
  switch (process.platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      // start is a cmd builtin that takes its first quoted argument as the window title.
      // Without that title argument, a URL with spaces would be misparsed as the title.
      return { command: 'cmd', args: ['/c', 'start', '""', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}
