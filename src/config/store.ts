/**
 * Navidrome MCP Server - Settings store (read / write / map)
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

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { getSettingsStorePath } from './store-path.js';
import { logger } from '../utils/logger.js';

/**
 * The canonical on-disk settings shape (nested, grouped by surface). Every
 * field is optional/nullable so a partially-filled or hand-edited file still
 * parses — "is this a usable config?" is decided downstream by whether
 * `navidrome.url` is present and the mapped flat config passes `ConfigSchema`.
 */
export const SettingsFileSchema = z.object({
  navidrome: z.object({
    url: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  library: z.object({
    defaultLibraryIds: z.array(z.number()).optional(),
    filterCacheEnabled: z.boolean().optional(),
  }).optional(),
  features: z.object({
    lastFmApiKey: z.string().nullish(),
    musicBrainzUserAgent: z.string().nullish(),
    radioBrowserUserAgent: z.string().nullish(),
    radioBrowserBase: z.string().nullish(),
    lyricsProvider: z.string().nullish(),
    lrclibUserAgent: z.string().nullish(),
    lrclibBase: z.string().nullish(),
  }).optional(),
  playback: z.object({
    mpvPath: z.string().nullish(),
    transcodeFormat: z.string().nullish(),
    transcodeBitrate: z.string().nullish(),
  }).optional(),
  webui: z.object({
    enabled: z.boolean().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    host: z.string().nullish(),
    expose: z.boolean().optional(),
    autoOpenBrowser: z.boolean().optional(),
    persistAfterMcpExit: z.boolean().optional(),
  }).optional(),
  advanced: z.object({
    debug: z.boolean().optional(),
    cacheTtl: z.number().optional(),
    tokenExpiry: z.number().optional(),
  }).optional(),
}).passthrough();

export type SettingsFile = z.infer<typeof SettingsFileSchema>;

/**
 * Read and validate the settings store. Returns `null` when the file is
 * absent, unreadable, not JSON, or fails the (lenient) schema — callers treat
 * all of those as "unconfigured" rather than crashing at startup.
 */
export function readSettings(): SettingsFile | null {
  const path = getSettingsStorePath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null; // absent / unreadable
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(`settings.json is not valid JSON (${path}); treating as unconfigured`);
    return null;
  }

  const result = SettingsFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    logger.warn(`settings.json failed validation (${path}); treating as unconfigured [${issues}]`);
    return null;
  }
  return result.data;
}

/**
 * Atomically write the settings store with owner-only permissions.
 *
 * Order matters for secret safety (a secrets file must never exist with
 * default perms, even momentarily):
 *   1. write to a uniquely-named temp file in the SAME directory (so the final
 *      `rename` is atomic — cross-device renames are not),
 *   2. `fchmod 0600` BEFORE writing any bytes (no default-perms window),
 *   3. write + `fsync` the fd (rename is atomic but does not flush contents),
 *   4. `rename()` over the target.
 *
 * On Windows the `0600` mode is a no-op; the per-user `%APPDATA%` location is
 * relied on instead (documented limitation).
 */
export function writeSettings(settings: SettingsFile): void {
  const path = getSettingsStorePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const tmpPath = `${path}.${process.pid}.${Math.floor(performance.now() * 1000).toString(36)}.tmp`;
  const fd = openSync(tmpPath, 'wx', 0o600);
  try {
    // Any failure after the tmp file is opened — write/fsync (e.g. disk-full)
    // or the final rename — must remove the tmp file so a partial file holding
    // plaintext credentials is never left orphaned on disk.
    try {
      writeSync(fd, `${JSON.stringify(settings, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}
