/**
 * Navidrome MCP Server - Web UI Player State / Settings / Shutdown Routes
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

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../../config.js';
import type { WebuiTheme } from '../../constants/defaults.js';
import { readSettings, writeSettings, SettingsFileSchema, type SettingsFile } from '../../config/store.js';
import { PlayerSettingsPatchSchema } from '../../schemas/index.js';
import { logger } from '../../utils/logger.js';
import { getPersist, getTheme, setPersist, setTheme } from '../../web/player-runtime.js';
import type { SseBroadcaster } from '../broadcaster.js';
import { readValidBody, writeError, writeJson } from '../http-helpers.js';
import { isLocalRequest } from '../loopback.js';

interface PlayerSettingsBody {
  persistAfterMcpExit: boolean;
  autoOpenBrowser: boolean;
  theme: WebuiTheme | null;
}

/** Live flags report live state. `autoOpenBrowser` has no live state, so each caller supplies it. */
function playerSettingsBody(autoOpenBrowser: boolean): PlayerSettingsBody {
  return { persistAfterMcpExit: getPersist(), autoOpenBrowser, theme: getTheme() };
}

/**
 * GET /api/player-state returns per-peer flags the frontend needs at load. `isLocal` reflects
 * THIS request's peer and decides the local-only affordances (settings gear, power).
 *
 * `theme` is the live color theme every peer renders, or null to follow each device.
 *
 * `lyrics.lrclibEnabled` only shapes the lyrics overlay's empty-state message.
 * The overlay itself still opens when the flag is false, because a song can
 * carry lyrics in its own file tag with no LRCLIB involved.
 */
export function handlePlayerState(req: IncomingMessage, res: ServerResponse, config: Config): void {
  writeJson(res, 200, {
    isLocal: isLocalRequest(req),
    theme: getTheme(),
    lyrics: { lrclibEnabled: config.features.lyrics },
  });
}

/**
 * GET /api/player/settings returns the player-scoped settings (loopback-only).
 * `persistAfterMcpExit` reflects the LIVE flag (toggled this session).
 * `autoOpenBrowser` only affects the next launch, so it is the stored value, or the resolved
 * launch config when no store exists.
 */
export function handleGetPlayerSettings(req: IncomingMessage, res: ServerResponse, config: Config): void {
  if (!isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  const storedAutoOpen = readSettings()?.webui?.autoOpenBrowser;
  writeJson(res, 200, playerSettingsBody(storedAutoOpen ?? config.webui.autoOpenBrowser));
}

/**
 * POST /api/player/settings updates player-scoped settings (loopback-only).
 * Body `{ persistAfterMcpExit?: boolean, autoOpenBrowser?: boolean, theme?: WebuiTheme }`.
 * `persistAfterMcpExit` and `theme` take effect immediately AND are persisted,
 * and the snapshot broadcast carries them to every open remote.
 * `autoOpenBrowser` is persisted for next launch.
 * `persisted` is false when settings.json was not written, so the change holds for this session only.
 * Only the webui keys are touched (read-merge-write), so other settings and
 * credentials are never clobbered.
 */
export async function handleSetPlayerSettings(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  broadcaster: Pick<SseBroadcaster, 'broadcastNow'>,
): Promise<void> {
  if (!isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }

  const input = await readValidBody(req, res, PlayerSettingsPatchSchema);
  if (input === null) return;
  let persistedWebui: NonNullable<SettingsFile['webui']> | null = null;

  // The live flags matter for the running process, so they apply before the best-effort write below.
  if (input.persistAfterMcpExit !== undefined) {
    setPersist(input.persistAfterMcpExit);
  }
  if (input.theme !== undefined) {
    setTheme(input.theme);
  }

  const current = readSettings();
  if (current === null) {
    // No usable store is normal in env-fallback mode (or a corrupt file). Writing a near-empty
    // file here would replace that config, so the change applies live only.
    logger.warn('player settings: settings.json missing; applied for this session only');
  } else {
    const webui = { ...(current.webui ?? {}) };
    if (input.persistAfterMcpExit !== undefined) webui.persistAfterMcpExit = input.persistAfterMcpExit;
    if (input.autoOpenBrowser !== undefined) webui.autoOpenBrowser = input.autoOpenBrowser;
    if (input.theme !== undefined) webui.theme = input.theme;
    const merged = { ...current, webui };
    // Never persist a file that would not parse back, the same guard the config-app writer keeps.
    const check = SettingsFileSchema.safeParse(merged);
    if (!check.success) {
      logger.warn('player settings: merged settings failed validation; not writing (applied live only)');
    } else {
      try {
        writeSettings(merged);
        persistedWebui = webui;
      } catch (err) {
        logger.warn('player settings: failed to persist to settings.json:', err);
      }
    }
  }

  const storedWebui = persistedWebui ?? current?.webui;
  writeJson(res, 200, {
    ...playerSettingsBody(storedWebui?.autoOpenBrowser ?? config.webui.autoOpenBrowser),
    persisted: persistedWebui !== null,
  });
  broadcaster.broadcastNow();
}

/**
 * POST /api/shutdown is the power button (loopback-only). Stops mpv and exits the
 * web server via the injected shutdown callback. Responds 200 first so the
 * browser sees success before the server closes.
 */
export function handleShutdown(
  req: IncomingMessage,
  res: ServerResponse,
  shutdown: () => void,
): void {
  if (!isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  writeJson(res, 200, { ok: true });
  // Defer so the response flushes before we tear the server down.
  setTimeout(shutdown, 50).unref();
}
