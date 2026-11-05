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
import { WEBUI_ADMIN_ACCESS_LEVELS, WEBUI_AUTH_MODES } from '../constants/defaults.js';
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
    audioDevice: z.object({ id: z.string(), name: z.string().nullish() }).nullish(),
  }).optional(),
  webui: z.object({
    enabled: z.boolean().optional(),
    port: z.number().optional(),
    host: z.string().nullish(),
    expose: z.boolean().optional(),
    allowedHosts: z.array(z.string()).nullish(),
    publicUrl: z.string().nullish(),
    autoOpenBrowser: z.boolean().optional(),
    persistAfterMcpExit: z.boolean().optional(),
    // Not an enum, so an unknown theme reads as unset instead of failing the entire store.
    theme: z.string().nullish(),
    visualizer: z.boolean().optional(),
    tls: z.object({
      certPath: z.string().nullish(),
      keyPath: z.string().nullish(),
    }).nullish(),
    // Enums, unlike theme, so a mistyped mode voids the store, and readSettingsForStartup still
    // reports the mode so startup skips the env fallback, which would open the remote.
    auth: z.object({
      mode: z.enum(WEBUI_AUTH_MODES).optional(),
      adminPasswordHash: z.string().nullish(),
      adminAccess: z.enum(WEBUI_ADMIN_ACCESS_LEVELS).optional(),
    }).nullish(),
  }).optional(),
  jukebox: z.object({
    guestQueueLimit: z.number().optional(),
    // Any shape, so a hand-edited or unknown link reads as the default instead of failing the entire store.
    shareLink: z.unknown().optional(),
  }).optional(),
  advanced: z.object({
    debug: z.boolean().optional(),
    tokenExpiry: z.number().optional(),
  }).optional(),
}).passthrough();

export type SettingsFile = z.infer<typeof SettingsFileSchema>;

interface StoreContents {
  /** Null when the file is absent, unreadable, not JSON, or fails the schema. */
  settings: SettingsFile | null;
  /** Kept when the schema rejects the file. Null when the file is absent, unreadable or not JSON. */
  parsed: unknown;
  /** Why a present file is not usable. Both problem fields are null for an absent file or a usable one. */
  problem: string | null;
  problemKind: StoreProblemKind | null;
}

type StoreProblemKind = 'unreadable' | 'not-json' | 'invalid';

const NO_STORE: StoreContents = { settings: null, parsed: null, problem: null, problemKind: null };

const StoredAuthModeSchema = z.object({ webui: z.object({ auth: z.object({ mode: z.unknown() }) }) });

/** Every failure returns null instead of throwing, so a bad file never crashes startup. */
export function readSettings(): SettingsFile | null {
  return readStore().settings;
}

/**
 * The schema strips nested keys this build does not know, so a save merges onto this unstripped
 * object instead. It is null whenever readSettings returns null.
 */
export function readRawSettings(): Record<string, unknown> | null {
  const { settings, parsed } = readStore();
  // SettingsFileSchema accepts only a plain object, so a parsed store is one.
  return settings === null ? null : parsed as Record<string, unknown>;
}

/** Lets the settings page say why it shows default and environment values instead of the file's. */
export function readStoreProblem(): { text: string; unreadable: boolean } | null {
  const { problem, problemKind } = readStore();
  return problem === null ? null : { text: problem, unreadable: problemKind === 'unreadable' };
}

/**
 * The env fallback opens the web remote by default, so startup also learns whether the file names
 * an auth mode other than none, even when the schema rejects the file. A file that cannot be read
 * or parsed cannot prove it names no auth mode, so it counts as one that does.
 */
export function readSettingsForStartup(): {
  settings: SettingsFile | null;
  requestsWebuiAuth: boolean;
  problem: string | null;
} {
  const { settings, parsed, problem, problemKind } = readStore();
  const stored = StoredAuthModeSchema.safeParse(parsed);
  const mode = stored.success ? stored.data.webui.auth.mode : undefined;
  const namesAuthMode = mode !== undefined && mode !== null && mode !== 'none';
  const unparsable = problemKind === 'unreadable' || problemKind === 'not-json';
  return { settings, requestsWebuiAuth: unparsable || namesAuthMode, problem };
}

function readStore(): StoreContents {
  const path = getSettingsStorePath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return NO_STORE;
    return unusableStore(`settings.json at ${path} is unreadable (${code ?? String(err)})`, null, 'unreadable');
  }
  // Windows editors may prepend a UTF-8 BOM, which JSON.parse rejects.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unusableStore(`settings.json is not valid JSON (${path})`, null, 'not-json');
  }

  const result = SettingsFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return unusableStore(`settings.json failed validation (${path}) [${issues}]`, parsed, 'invalid');
  }
  return { settings: result.data, parsed, problem: null, problemKind: null };
}

// Startup decides between env fallback and setup mode, so this line states only that the values are dropped.
function unusableStore(problem: string, parsed: unknown, kind: StoreProblemKind): StoreContents {
  logger.warn(`${problem}. Its values are ignored.`);
  return { settings: null, parsed, problem, problemKind: kind };
}

export function writeSettings(settings: SettingsFile): void {
  writePrivateFileAtomic(getSettingsStorePath(), `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * A secrets file must never exist with default perms or partial content, so a 0600 temp file is
 * synced and renamed into place. Windows ignores the mode and relies on per-user %APPDATA%.
 */
export function writePrivateFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });

  const tmpPath = `${path}.${process.pid}.${Math.floor(performance.now() * 1000).toString(36)}.tmp`;
  const fd = openSync(tmpPath, 'wx', 0o600);
  try {
    // Any failure after open removes the tmp file, so no plaintext credentials are orphaned.
    // closeSync runs before that cleanup because an open fd blocks the unlink on Windows.
    try {
      // openSync applies its mode through the umask, so fchmod sets 0600 regardless of umask.
      fchmodSync(fd, 0o600);
      writeSync(fd, content);
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

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every store writer sets only some keys, so a save keeps each stored key it does not set, even one
 * the schema would strip. A posted null, '' or [] replaces the stored value. Only undefined keeps it.
 */
export function mergeOntoStored(stored: JsonObject, posted: JsonObject): JsonObject {
  const merged: JsonObject = { ...stored };
  for (const [key, value] of Object.entries(posted)) {
    // Assigning __proto__ would replace the prototype instead of adding a key.
    if (key === '__proto__' || value === undefined) continue;
    const storedValue = merged[key];
    merged[key] = isJsonObject(value) && isJsonObject(storedValue) ? mergeOntoStored(storedValue, value) : value;
  }
  return merged;
}
