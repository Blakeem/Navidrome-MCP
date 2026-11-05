/**
 * Navidrome MCP Server - File log sink for the standalone web player
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
    /* The first failing append reports the problem through the stderr fallback. */
  }
  let sinkFailed = false;
  logger.setSink((level: LogLevel, args: unknown[]) => {
    const stamp = new Date().toISOString();
    const body = args
      .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 4 })))
      .join(' ');
    const line = `[${stamp}] [${level}] ${body}\n`;
    try {
      // The redacted log still carries operational detail, so it stays owner-only. mode applies
      // only when the file is created.
      appendFileSync(logPath, line, { mode: 0o600 });
    } catch (err) {
      // A throw from the log path would break its caller. A direct run has a real stderr, so the
      // line goes there, with a one-time notice that file logging broke.
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
