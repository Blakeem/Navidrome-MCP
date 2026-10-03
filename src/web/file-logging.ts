/**
 * Navidrome MCP Server - File log sink for the standalone web player
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

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inspect } from 'node:util';

import { getSettingsStorePath } from '../config/store-path.js';
import { logger, type LogLevel } from '../utils/logger.js';

/** The spawned child's stdio is ignored, so the sink must exist before any imported module logs. */
function setupFileLogging(): string {
  const logPath = join(dirname(getSettingsStorePath()), 'navidrome-web.log');
  try {
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  } catch {
    /* The directory may already exist. A failing append surfaces real failures. */
  }
  let sinkFailed = false;
  logger.setSink((level: LogLevel, args: unknown[]) => {
    const stamp = new Date().toISOString();
    const body = args
      .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4 })))
      .join(' ');
    const line = `[${stamp}] [${level}] ${body}\n`;
    try {
      // The log carries redacted but operational detail, so it stays owner-only. mode applies only on creation.
      appendFileSync(logPath, line, { mode: 0o600 });
    } catch (err) {
      // Never throw from the log path. A direct run has a real stderr, so fall back to it and say once that file logging broke.
      if (!sinkFailed) {
        sinkFailed = true;
        try {
          process.stderr.write(`navidrome-web: file logging to ${logPath} failed (${String(err)}); logging to stderr\n`);
        } catch {
          /* nothing more we can do */
        }
      }
      try {
        process.stderr.write(line);
      } catch {
        /* best-effort */
      }
    }
  });
  return logPath;
}

export const logPath = setupFileLogging();
