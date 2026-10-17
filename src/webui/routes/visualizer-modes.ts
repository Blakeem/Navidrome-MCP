/**
 * Navidrome MCP Server - Web UI Visualizer Modes Route
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readdir } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import { writeError, writeJson } from '../http-helpers.js';
import { PUBLIC_DIR } from './static-files.js';

// A file's name is its mode id. A name that starts with _, such as the template, stays out of the
// cycle.
const MODE_FILE = /^([a-z0-9][a-z0-9-]*)\.js$/;

/** The folder is read per request, so a file dropped into public/visualizers joins the cycle. */
export async function handleVisualizerModes(res: ServerResponse, publicDir: string = PUBLIC_DIR): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(join(publicDir, 'visualizers'));
  } catch (err) {
    logger.error(`webui: cannot list the visualizer modes: ${err instanceof Error ? err.message : String(err)}`);
    writeError(res, 500, 'Visualizer modes unavailable');
    return;
  }
  const modes = names
    .map((name) => MODE_FILE.exec(name)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort();
  writeJson(res, 200, { modes });
}
