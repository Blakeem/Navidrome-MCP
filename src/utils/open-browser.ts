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

/**
 * Best-effort open `url` in the user's default browser.
 *
 * This is a convenience only — the URL is always surfaced separately (printed /
 * returned) because there is no reliable way to open a browser on a headless or
 * SSH session (no `DISPLAY`, no `xdg-open`). Failures are swallowed: a spawn
 * error just means "no GUI here," not an error condition for the caller.
 */
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
      // `start` is a cmd builtin; the empty "" is the window title it expects
      // before the URL, otherwise a URL with spaces is misparsed as the title.
      return { command: 'cmd', args: ['/c', 'start', '""', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}
