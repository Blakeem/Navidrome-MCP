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

import { z } from 'zod';
import { ErrorFormatter } from './utils/error-formatter.js';
import { logger } from './utils/logger.js';
import { ConfigSchema, type Config } from './config/schema.js';
import { readSettings } from './config/store.js';
import { mapStoreToConfig } from './config/map-config.js';
import { getSettingsStorePath } from './config/store-path.js';

export type { Config } from './config/schema.js';

/**
 * Resolve the runtime configuration from the canonical `settings.json` store.
 *
 * `settings.json` is the single source of truth (no env layering): config is
 * collected once through the settings GUI and persisted to disk. Throws when
 * the store is absent or incomplete — callers that need to branch into a
 * first-run/degraded flow should use {@link resolveConfigState} instead.
 */
export async function loadConfig(): Promise<Config> {
  const settings = readSettings();
  if (settings === null) {
    throw new Error(
      ErrorFormatter.configValidation([
        `No usable settings found at ${getSettingsStorePath()}.`,
        'Run `navidrome-config` (or start the server unconfigured) to create it.',
      ])
    );
  }

  try {
    return ConfigSchema.parse(mapStoreToConfig(settings));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new Error(ErrorFormatter.configValidation(messages));
    }
    throw error;
  }
}

/**
 * Discriminated config state for the entry point to branch into normal vs.
 * first-run/degraded operation WITHOUT poisoning the `Config` type with a union
 * (every `config.navidromeUrl` site stays non-optional under ultra-strict TS).
 *
 * "configured" requires a present, non-empty Navidrome URL AND a fully valid
 * mapped config. A corrupt or incomplete `settings.json` resolves to
 * `configured: false` (open the GUI to fix) rather than throwing at startup.
 */
type ConfigState =
  | { configured: true; config: Config }
  | { configured: false };

export async function resolveConfigState(): Promise<ConfigState> {
  const settings = readSettings();
  const url = settings?.navidrome?.url;
  if (settings === null || url === undefined || url.trim() === '') {
    return { configured: false };
  }

  try {
    return { configured: true, config: await loadConfig() };
  } catch (err) {
    // Present but invalid → treat as unconfigured so the entry point opens the
    // settings GUI instead of crashing. Log the specific reason so a malformed
    // hand-edited store doesn't silently look like a fresh first run.
    logger.warn('settings.json is present but invalid; entering setup mode:', err);
    return { configured: false };
  }
}
