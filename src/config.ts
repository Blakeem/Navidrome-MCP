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
import { buildEnvRuntimeSettings } from './config/seed.js';

export type { Config } from './config/schema.js';

/**
 * Validate a store snapshot against the runtime schema. Shared by startup and the settings
 * Save and Test routes, so each reports the same `path: message` issue list.
 */
export function validateMappedSettings(
  settings: SettingsFile,
): { ok: true; config: Config } | { ok: false; messages: string[] } {
  const result = ConfigSchema.safeParse(mapStoreToConfig(settings));
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

  const result = validateMappedSettings(settings);
  if (!result.ok) {
    throw new Error(ErrorFormatter.configValidation(result.messages));
  }
  return result.config;
}

/**
 * Discriminated config state for the entry point to branch into normal vs.
 * first-run/degraded operation WITHOUT poisoning the `Config` type with a union
 * (every `config.navidromeUrl` site stays non-optional under ultra-strict TS).
 *
 * Env applies when the store is absent, unparseable, schema-invalid or has a blank URL.
 * A store with a URL but an invalid config resolves to `configured: false`.
 */
type ConfigState =
  | { configured: true; config: Config }
  | { configured: false };

export async function resolveConfigState(): Promise<ConfigState> {
  const settings = readSettings();
  const url = settings?.navidrome?.url;
  if (settings === null || url === undefined || url.trim() === '') {
    // No usable store → try the environment fallback before giving up. This is
    // the headless/container path (Docker `-e`, compose `environment`, an MCP
    // client's `env` block), where the settings GUI is unreachable and env vars
    // are the only practical channel.
    return await resolveEnvFallbackState();
  }

  try {
    // Reuse the single `settings` snapshot already read above for the URL guard
    // instead of letting loadConfig re-read from disk. A second independent
    // read could observe a concurrent settings save and disagree with the guard.
    return { configured: true, config: await loadConfig(settings) };
  } catch (err) {
    // Present but invalid → treat as unconfigured so the entry point opens the
    // settings GUI instead of crashing. Log the specific reason so a malformed
    // hand-edited store doesn't silently look like a fresh first run.
    logger.warn('settings.json is present but invalid; entering setup mode:', err);
    return { configured: false };
  }
}

/**
 * Environment-variable fallback for a missing/unusable store. Configured IFF
 * `NAVIDROME_URL` is set and the env-derived config passes `ConfigSchema`.
 * A present-but-broken env config logs WHY it was rejected (the reported
 * container failure mode was env vars being silently ignored) and then falls
 * through to setup mode.
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
