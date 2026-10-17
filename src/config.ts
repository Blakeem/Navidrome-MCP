/**
 * Navidrome MCP Server - Configuration Management
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { ErrorFormatter } from './utils/error-formatter.js';
import { logger } from './utils/logger.js';
import { ConfigSchema, type Config } from './config/schema.js';
import { readSettings, type SettingsFile } from './config/store.js';
import { mapStoreToConfig } from './config/map-config.js';
import { getSettingsStorePath } from './config/store-path.js';
import { buildEnvRuntimeSettings } from './config/env-settings.js';
import { resolveMpvBinary } from './services/playback/mpv-process.js';

export type { Config } from './config/schema.js';

/** Shared by startup and the settings Save and Test routes, so each reports the same issue list. */
export function validateMappedSettings(
  settings: SettingsFile,
  mpvPath: string | null,
): { ok: true; config: Config } | { ok: false; messages: string[] } {
  const result = ConfigSchema.safeParse(mapStoreToConfig(settings, mpvPath));
  if (result.success) return { ok: true, config: result.data };
  const messages = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  return { ok: false, messages };
}

/**
 * A caller that already read the store passes that snapshot, so its guard and this parse see the
 * same file.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- kept async since callers await it
export async function loadConfig(settings?: SettingsFile): Promise<Config> {
  settings ??= readSettings() ?? undefined;
  if (settings === undefined) {
    throw new Error(
      ErrorFormatter.configValidation([
        `No usable settings found at ${getSettingsStorePath()}.`,
        'Run `navidrome-config` (or start the server unconfigured) to create it.',
      ])
    );
  }

  const mpvPath = resolveMpvBinary(settings.playback?.mpvPath);
  const result = validateMappedSettings(settings, mpvPath);
  if (!result.ok) {
    throw new Error(ErrorFormatter.configValidation(result.messages));
  }
  return result.config;
}

/**
 * Lets the entry point branch into setup mode without turning `Config` into a union,
 * so every `Config` field stays non-optional.
 */
type ConfigState =
  | { configured: true; config: Config }
  | { configured: false };

export async function resolveConfigState(): Promise<ConfigState> {
  const settings = readSettings();
  const url = settings?.navidrome?.url;
  if (settings === null || url === undefined || url.trim() === '') {
    return await resolveEnvFallbackState();
  }

  try {
    // Reuse the snapshot the URL guard read, since a second read could see a concurrent save.
    return { configured: true, config: await loadConfig(settings) };
  } catch (err) {
    // An invalid store opens the settings GUI instead of crashing. The logged reason
    // keeps a malformed hand-edited store from looking like a fresh first run.
    logger.warn('settings.json is present but invalid; entering setup mode:', err);
    return { configured: false };
  }
}

/**
 * Applies only when settings.json is absent, unreadable, malformed, or has no Navidrome URL.
 * A rejected env config logs its reason, so set env vars never fail without a trace.
 */
async function resolveEnvFallbackState(): Promise<ConfigState> {
  const envSettings = buildEnvRuntimeSettings();
  const envUrl = envSettings.navidrome?.url;
  if (envUrl === undefined || envUrl.trim() === '') {
    return { configured: false };
  }

  try {
    const config = await loadConfig(envSettings);
    logger.info(
      `No usable settings.json at ${getSettingsStorePath()}. Running from environment variables ` +
      '(NAVIDROME_URL et al.). A usable settings.json takes precedence.'
    );
    return { configured: true, config };
  } catch (err) {
    logger.warn(
      'NAVIDROME_URL is set but the environment-derived config is invalid; entering setup mode:',
      err
    );
    return { configured: false };
  }
}

/**
 * Reads the store on each call, so a running process sees what the web player or the settings app
 * saved after it started.
 */
export function readSavedWebuiSettings(): Config['webui'] | null {
  const settings = readSettings();
  if (settings === null) return null;
  const result = validateMappedSettings(settings, null);
  return result.ok ? result.config.webui : null;
}

/** A spawned or re-run web player binds the saved endpoint, not this process's startup one. */
export function readSavedWebuiEndpoint(): Pick<Config['webui'], 'port' | 'host'> | null {
  const webui = readSavedWebuiSettings();
  return webui === null ? null : { port: webui.port, host: webui.host };
}
