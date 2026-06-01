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
import { readSettings, type SettingsFile } from './config/store.js';
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
 *
 * @param settings - Optional already-read settings snapshot. When provided, it
 *   is parsed directly instead of re-reading from disk; this lets a caller that
 *   has already performed a presence check (e.g. {@link resolveConfigState})
 *   parse the SAME snapshot, closing the TOCTOU window where a concurrent
 *   settings save between two independent `readSettings()` disk reads could make
 *   the guard and the parse disagree. When omitted, behaves exactly as before
 *   (reads from disk).
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async kept for callers that await this public function; body is intentionally sync (ConfigSchema.parse + readSettings are synchronous)
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
    // Reuse the single `settings` snapshot already read above for the URL guard
    // instead of letting loadConfig re-read from disk — a second independent
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
