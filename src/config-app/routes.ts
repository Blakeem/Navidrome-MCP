/**
 * Navidrome MCP Server - Settings app route handlers
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
import { z } from 'zod';
import { buildFormSeed } from '../config/seed.js';
import { writeSettings, SettingsFileSchema, type SettingsFile } from '../config/store.js';
import { mapStoreToConfig } from '../config/map-config.js';
import { ConfigSchema } from '../config/schema.js';
import { NavidromeClient } from '../client/navidrome-client.js';
import { writeJson, writeError, readJsonBody } from '../webui/http-helpers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

/**
 * Sentinel sent to / accepted from the browser in place of the real password,
 * so secrets never leave the process in plaintext for display. On save/test, a
 * field still equal to the sentinel means "keep the stored value."
 */
const PASSWORD_SENTINEL = '********';

/**
 * Mountable settings routes — written so a future `/config` surface inside the
 * player web UI can reuse them verbatim. The caller (server.ts) is responsible
 * for the loopback guard; these handlers assume a local peer.
 *
 * Returns `true` if it handled the request, `false` if the path/method is not a
 * settings route (so the server can fall through to static files / 404).
 */
export async function handleSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
): Promise<boolean> {
  if (method === 'GET' && path === '/api/settings/seed') {
    handleSeed(res);
    return true;
  }
  if (method === 'POST' && path === '/api/settings') {
    await handleSave(req, res);
    return true;
  }
  if (method === 'POST' && path === '/api/settings/test') {
    await handleTest(req, res);
    return true;
  }
  return false;
}

/** GET /api/settings/seed — pre-fill values, password masked. */
function handleSeed(res: ServerResponse): void {
  try {
    writeJson(res, 200, maskSecrets(buildFormSeed()));
  } catch (err) {
    logger.warn('settings seed failed:', err);
    writeError(res, 500, 'Failed to read settings');
  }
}

/** POST /api/settings — validate + persist (sole writer of settings.json). */
async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseSettingsBody(req, res);
  if (parsed === null) return;

  // A valid, savable config requires the mapped flat config to pass ConfigSchema
  // (so we never persist a file the runtime would reject — e.g. a blank URL).
  const validation = ConfigSchema.safeParse(mapStoreToConfig(parsed));
  if (!validation.success) {
    const messages = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
    writeError(res, 400, ErrorFormatter.configValidation(messages));
    return;
  }

  try {
    writeSettings(parsed);
  } catch (err) {
    logger.error('settings save failed:', err);
    writeError(res, 500, 'Failed to write settings');
    return;
  }
  writeJson(res, 200, {
    ok: true,
    message:
      'Settings saved. Now RESTART your MCP client (e.g. quit and reopen Claude Desktop) — ' +
      'the server does not hot-reload, and the full toolset only appears after a restart.',
  });
}

/** POST /api/settings/test — connect with the entered values without saving. */
async function handleTest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseSettingsBody(req, res);
  if (parsed === null) return;

  const validation = ConfigSchema.safeParse(mapStoreToConfig(parsed));
  if (!validation.success) {
    const first = validation.error.issues[0];
    writeJson(res, 200, {
      ok: false,
      error: first !== undefined ? `${first.path.join('.')}: ${first.message}` : 'Invalid settings',
    });
    return;
  }

  try {
    const client = new NavidromeClient(validation.data);
    await client.initialize(); // JWT login — the actual connectivity + auth test
    writeJson(res, 200, { ok: true, message: 'Successfully connected to Navidrome.' });
  } catch (err) {
    // Run through ErrorFormatter so a mistyped URL with creds is never echoed raw.
    writeJson(res, 200, { ok: false, error: ErrorFormatter.authentication(extractMessage(err)) });
  }
}

/**
 * Read + schema-validate the posted settings body and un-mask the password
 * (sentinel → stored value). Writes an error response and returns `null` on
 * malformed input.
 */
async function parseSettingsBody(req: IncomingMessage, res: ServerResponse): Promise<SettingsFile | null> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    writeError(res, 400, 'Invalid or oversized request body');
    return null;
  }

  const result = SettingsFileSchema.safeParse(body ?? {});
  if (!result.success) {
    writeError(res, 400, 'Malformed settings payload');
    return null;
  }
  return unmaskSecrets(result.data);
}

/** Replace the real password with the sentinel for safe display. */
function maskSecrets(settings: SettingsFile): SettingsFile {
  const password = settings.navidrome?.password;
  if (password === undefined || password === '') return settings;
  return {
    ...settings,
    navidrome: { ...settings.navidrome, password: PASSWORD_SENTINEL },
  };
}

/**
 * Restore the real password when the form sent back the unchanged sentinel.
 *
 * Read it from the SAME source the form was seeded from (`buildFormSeed`): the
 * existing settings.json if present, otherwise the legacy env/.env import. On a
 * true first run there is no settings.json yet, so reading only the store here
 * would yield an empty password and fail validation even though the field
 * looked filled — the seed is the correct source.
 */
function unmaskSecrets(settings: SettingsFile): SettingsFile {
  if (settings.navidrome?.password !== PASSWORD_SENTINEL) return settings;
  const stored = buildFormSeed().navidrome?.password ?? '';
  return {
    ...settings,
    navidrome: { ...settings.navidrome, password: stored },
  };
}

function extractMessage(err: unknown): string {
  if (err instanceof z.ZodError) return 'Invalid settings';
  return err instanceof Error ? err.message : 'Unknown error';
}
