/**
 * Navidrome MCP Server - Settings store (read / write)
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  closeSync,
  fchmodSync,
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
 * Every field is optional so a partial or hand-edited file still parses. ConfigSchema decides
 * later whether the mapped config is usable.
 */
export const SettingsFileSchema = z.object({
  navidrome: z.object({
    url: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  transport: z.object({
    type: z.enum(['stdio', 'http']).optional(),
    host: z.string().nullish(),
    port: z.number().optional(),
    expose: z.boolean().optional(),
    authToken: z.string().nullish(),
    allowedHosts: z.array(z.string()).nullish(),
    allowedOrigins: z.array(z.string()).nullish(),
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
    port: z.number().optional(),
    host: z.string().nullish(),
    expose: z.boolean().optional(),
    allowedHosts: z.array(z.string()).nullish(),
    autoOpenBrowser: z.boolean().optional(),
    persistAfterMcpExit: z.boolean().optional(),
    // Not an enum, so an unknown theme reads as unset instead of failing the entire store.
    theme: z.string().nullish(),
    visualizer: z.boolean().optional(),
  }).optional(),
  advanced: z.object({
    debug: z.boolean().optional(),
    tokenExpiry: z.number().optional(),
  }).optional(),
}).passthrough();

export type SettingsFile = z.infer<typeof SettingsFileSchema>;

interface StoreContents {
  settings: SettingsFile;
  raw: Record<string, unknown>;
}

/** Every failure returns null instead of throwing, so a bad file never crashes startup. */
export function readSettings(): SettingsFile | null {
  return readStore()?.settings ?? null;
}

/**
 * The schema strips nested keys this build does not know, so a save merges onto this unstripped
 * object instead. It is null whenever readSettings returns null.
 */
export function readRawSettings(): Record<string, unknown> | null {
  return readStore()?.raw ?? null;
}

function readStore(): StoreContents | null {
  const path = getSettingsStorePath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn(`settings.json at ${path} is unreadable (${code ?? String(err)}), treating as unconfigured`);
    }
    return null;
  }
  // Windows editors may prepend a UTF-8 BOM, which JSON.parse rejects.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
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
  // SettingsFileSchema accepts only a plain object, so a parsed store is one.
  return { settings: result.data, raw: parsed as Record<string, unknown> };
}

/**
 * A secrets file must never exist with default perms or partial content, so a 0600 temp file is
 * synced and renamed into place. Windows ignores the mode and relies on per-user %APPDATA%.
 */
export function writeSettings(settings: SettingsFile): void {
  const path = getSettingsStorePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const tmpPath = `${path}.${process.pid}.${Math.floor(performance.now() * 1000).toString(36)}.tmp`;
  const fd = openSync(tmpPath, 'wx', 0o600);
  try {
    // Any failure after open removes the tmp file, so no plaintext credentials are orphaned.
    // closeSync runs before that cleanup because an open fd blocks the unlink on Windows.
    try {
      // openSync applies its mode through the umask, so fchmod sets 0600 regardless of umask.
      fchmodSync(fd, 0o600);
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
      // The original write error matters more than a failed cleanup.
    }
    throw err;
  }
}
