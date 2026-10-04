/**
 * Navidrome MCP Server - Configuration Management
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

import { ErrorFormatter } from './utils/error-formatter.js';
import { logger } from './utils/logger.js';
import { ConfigSchema, type Config } from './config/schema.js';
import { readSettings, type SettingsFile } from './config/store.js';
import { mapStoreToConfig } from './config/map-config.js';
import { getSettingsStorePath } from './config/store-path.js';
import { buildEnvRuntimeSettings } from './config/env-settings.js';
import { resolveMpvBinary } from './services/playback/mpv-process.js';

export type { Config } from './config/schema.js';

/**
 * Validate a store snapshot against the runtime schema. Shared by startup and the settings
 * Save and Test routes, so each reports the same `path: message` issue list.
 */
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
 * Validate a settings snapshot into the runtime config. A caller that already read the store
 * passes that snapshot, so its guard and this parse see the same file.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async kept for callers that await this public function. The body is synchronous.
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
 * Env fallback for a missing or unusable store, configured only when `NAVIDROME_URL` is set and validates.
 * A broken env config logs its rejection reason before setup mode, so set env vars are never silently ignored.
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
 * The webui settings settings.json holds now, so a running process sees what the web player or the
 * config app saved after it started. Null when the store is absent or invalid.
 */
export function readSavedWebuiSettings(): Config['webui'] | null {
  const settings = readSettings();
  if (settings === null) return null;
  const result = validateMappedSettings(settings, null);
  return result.ok ? result.config.webui : null;
}

/** A spawned or re-run web player binds the saved endpoint, not the one this process started with. */
export function readSavedWebuiEndpoint(): Pick<Config['webui'], 'port' | 'host'> | null {
  const webui = readSavedWebuiSettings();
  return webui === null ? null : { port: webui.port, host: webui.host };
}
