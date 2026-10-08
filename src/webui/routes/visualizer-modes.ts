/**
 * Navidrome MCP Server - Web UI Visualizer Modes Route
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

import { readdir } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import { writeError, writeJson } from '../http-helpers.js';
import { PUBLIC_DIR } from './static-files.js';

// A file's name is its mode id. A name that starts with _, such as the template, stays out of the cycle.
const MODE_FILE = /^([a-z0-9][a-z0-9-]*)\.js$/;

/**
 * GET /api/visualizer/modes lists the drawing modes in public/visualizers, sorted by id, so a file
 * dropped into that folder joins the visualizer's cycle with no other change.
 */
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
