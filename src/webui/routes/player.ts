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
import { readSettings, writeSettings, SettingsFileSchema } from '../../config/store.js';
import { logger } from '../../utils/logger.js';
import { getPersist, setPersist } from '../../web/player-runtime.js';
import { readJsonBody, writeError, writeJson } from '../http-helpers.js';
import { isLoopbackPeer } from '../loopback.js';

/**
 * GET /api/player-state — per-peer flags the frontend needs at load to decide
 * whether to render the local-only affordances (gear/power). `isLocal` reflects
 * THIS request's peer; combined client-side with the SSE `player` snapshot
 * (hasLiveParent/persist) to compute the power button's visibility live.
 */
export function handlePlayerState(req: IncomingMessage, res: ServerResponse): void {
  writeJson(res, 200, { isLocal: isLoopbackPeer(req) });
}

/**
 * GET /api/player/settings — current player-scoped settings (loopback-only).
 * `persistAfterMcpExit` reflects the LIVE flag (toggled this session);
 * `autoOpenBrowser` is the stored value (only affects the next launch).
 */
export function handleGetPlayerSettings(req: IncomingMessage, res: ServerResponse): void {
  if (!isLoopbackPeer(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  const stored = readSettings()?.webui ?? {};
  writeJson(res, 200, {
    persistAfterMcpExit: getPersist(),
    autoOpenBrowser: stored.autoOpenBrowser ?? false,
  });
}

/**
 * POST /api/player/settings — update player-scoped settings (loopback-only).
 * Body `{ persistAfterMcpExit?: boolean, autoOpenBrowser?: boolean }`.
 * `persistAfterMcpExit` takes effect immediately (governs the disconnect
 * decision) AND is persisted; `autoOpenBrowser` is persisted for next launch.
 * Only the webui keys are touched (read-merge-write) so other settings — and
 * credentials — are never clobbered.
 */
export async function handleSetPlayerSettings(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!isLoopbackPeer(req)) {
    writeError(res, 404, 'Not found');
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    writeError(res, 400, err instanceof Error ? err.message : 'invalid JSON body');
    return;
  }
  // Narrow the unknown JSON body to a plain object before reading fields.
  // A non-object body (array, string, number, null) carries no settings keys,
  // so we treat it as an empty patch rather than indexing into it blindly.
  const input: { persistAfterMcpExit?: unknown; autoOpenBrowser?: unknown } =
    typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {};

  // Apply the live flag first (this is the part that matters for the running
  // process); persistence to disk is best-effort below.
  if (typeof input.persistAfterMcpExit === 'boolean') {
    setPersist(input.persistAfterMcpExit);
  }

  const current = readSettings();
  if (current === null) {
    // No store on disk (shouldn't happen for a configured, running server).
    // Don't write a near-empty file that would clobber config — apply live only.
    logger.warn('player settings: settings.json missing; applied for this session only');
  } else {
    const webui = { ...(current.webui ?? {}) };
    if (typeof input.persistAfterMcpExit === 'boolean') webui.persistAfterMcpExit = input.persistAfterMcpExit;
    if (typeof input.autoOpenBrowser === 'boolean') webui.autoOpenBrowser = input.autoOpenBrowser;
    const merged = { ...current, webui };
    // Defense-in-depth: never persist a file that wouldn't parse back. We only
    // ever flip two booleans on an already-valid file, so this should always
    // pass — but validating keeps this writer honest alongside the config-app one.
    const check = SettingsFileSchema.safeParse(merged);
    if (!check.success) {
      logger.warn('player settings: merged settings failed validation; not writing (applied live only)');
    } else {
      try {
        writeSettings(merged);
      } catch (err) {
        logger.warn('player settings: failed to persist to settings.json:', err);
      }
    }
  }

  // Build the response from values already in hand rather than re-reading
  // settings.json — a concurrent writer (e.g. the config-app) could change the
  // file in the window after writeSettings, and a caught write failure above
  // would make a re-read report stale/un-persisted values as if applied.
  writeJson(res, 200, {
    persistAfterMcpExit: getPersist(),
    autoOpenBrowser:
      typeof input.autoOpenBrowser === 'boolean'
        ? input.autoOpenBrowser
        : (current?.webui?.autoOpenBrowser ?? false),
  });
}

/**
 * POST /api/shutdown — power button (loopback-only). Stops mpv and exits the
 * web server via the injected shutdown callback. Responds 200 first so the
 * browser sees success before the server closes.
 */
export function handleShutdown(
  req: IncomingMessage,
  res: ServerResponse,
  shutdown: () => void,
): void {
  if (!isLoopbackPeer(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  writeJson(res, 200, { ok: true });
  // Defer so the response flushes before we tear the server down.
  setTimeout(shutdown, 50).unref();
}
