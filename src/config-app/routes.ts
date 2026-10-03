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
import { validateMappedSettings } from '../config.js';
import { buildFormSeed, FORM_SUGGESTIONS } from '../config/seed.js';
import { readSettings, writeSettings, SettingsFileSchema, type SettingsFile } from '../config/store.js';
import { parseWebuiTheme, WEBUI_BIND_HOSTS } from '../constants/defaults.js';
import { NavidromeClient } from '../client/navidrome-client.js';
import { writeJson, writeError, readJsonBody } from '../webui/http-helpers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger, redact } from '../utils/logger.js';
import { describeFetchError } from '../utils/network-safety.js';

/**
 * Sentinel sent to / accepted from the browser in place of the real password,
 * so secrets never leave the process in plaintext for display. On save/test, a
 * field still equal to the sentinel means "keep the stored value."
 */
const PASSWORD_SENTINEL = '********';

/**
 * The caller (server.ts) owns the loopback guard, so these handlers assume a local peer.
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
  if (method === 'GET' && path === '/api/settings/suggestions') {
    writeJson(res, 200, FORM_SUGGESTIONS);
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

/** GET /api/settings/seed. Returns pre-fill values with the password masked. */
function handleSeed(res: ServerResponse): void {
  try {
    writeJson(res, 200, maskSecrets(buildFormSeed()));
  } catch (err) {
    logger.warn('settings seed failed:', err);
    writeError(res, 500, 'Failed to read settings');
  }
}

/** POST /api/settings. Validate + persist. The primary settings writer. The
 * player's loopback-only `/api/player/settings` also writes (the player-scoped
 * webui subset). Both use the atomic `writeSettings`, and concurrent saves are
 * last-writer-wins on the whole file, acceptable for these rare local actions. */
async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseSettingsBody(req, res);
  if (parsed === null) return;

  // A valid, savable config requires the mapped flat config to pass ConfigSchema
  // (so we never persist a file the runtime would reject, e.g. a blank URL).
  const validation = validateForm(parsed);
  if (!validation.ok) {
    writeError(res, 400, ErrorFormatter.configValidation(validation.messages));
    return;
  }

  try {
    writeSettings(withStoredPlayerTheme(parsed));
  } catch (err) {
    logger.error('settings save failed:', err);
    writeError(res, 500, 'Failed to write settings');
    return;
  }
  writeJson(res, 200, {
    ok: true,
    // Host-agnostic: this server is launched by the MCP client, the standalone
    // web player, or `navidrome-config`, and the reader doesn't know which. All
    // load settings once at startup (no hot-reload), so cover both restart paths.
    message:
      'Settings saved. They load at startup and the server does not hot-reload, so restart ' +
      "whatever you launched to apply them: your MCP client (e.g. quit and reopen Claude " +
      'Desktop, the full toolset appears after a restart) and/or the web player (re-run ' +
      '`navidrome-web`). You can keep changing settings and saving again from this page.',
  });
}

// The player's gear modal owns webui.theme and this form does not carry it, so a save keeps the stored theme.
function withStoredPlayerTheme(settings: SettingsFile): SettingsFile {
  const theme = parseWebuiTheme(readSettings()?.webui?.theme);
  return theme === null ? settings : { ...settings, webui: { ...settings.webui, theme } };
}

// The runtime downgrades an unsupported webui.host to a warning, so the form rejects it here where the user can fix it.
function validateForm(settings: SettingsFile): ReturnType<typeof validateMappedSettings> {
  const host = settings.webui?.host?.trim() ?? '';
  if (host !== '' && !WEBUI_BIND_HOSTS.includes(host)) {
    return {
      ok: false,
      messages: [`webui.host: "${host}" is not supported. Leave it blank or use one of ${WEBUI_BIND_HOSTS.join(', ')}.`],
    };
  }
  return validateMappedSettings(settings);
}

/** POST /api/settings/test. Connect with the entered values without saving. */
async function handleTest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseSettingsBody(req, res);
  if (parsed === null) return;

  const validation = validateForm(parsed);
  if (!validation.ok) {
    writeJson(res, 200, { ok: false, error: ErrorFormatter.configValidation(validation.messages) });
    return;
  }

  try {
    const client = new NavidromeClient(validation.config);
    await client.initialize(); // JWT login is the actual connectivity and auth test
    writeJson(res, 200, { ok: true, message: 'Successfully connected to Navidrome.' });
  } catch (err) {
    // redact() strips credentials before the text reaches the browser, since
    // fetch reflects a mistyped URL's userinfo verbatim in its error.
    const message = redact(describeFetchError(err)) as string;
    writeJson(res, 200, { ok: false, error: message });
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

/** Replace stored secrets (Navidrome password, MCP auth token) with the sentinel
 * for safe display. */
function maskSecrets(settings: SettingsFile): SettingsFile {
  let masked = settings;
  const password = settings.navidrome?.password;
  if (password !== undefined && password !== '') {
    masked = { ...masked, navidrome: { ...masked.navidrome, password: PASSWORD_SENTINEL } };
  }
  const authToken = settings.transport?.authToken;
  if (authToken !== undefined && authToken !== null && authToken !== '') {
    masked = { ...masked, transport: { ...masked.transport, authToken: PASSWORD_SENTINEL } };
  }
  return masked;
}

/**
 * Restore the real secrets when the form sent back the unchanged sentinel. They come from `buildFormSeed`, the
 * source the form was seeded from, because on a first run no settings.json exists to read them from.
 */
function unmaskSecrets(settings: SettingsFile): SettingsFile {
  let result = settings;
  let seed: SettingsFile | undefined;
  const seeded = (): SettingsFile => (seed ??= buildFormSeed());
  if (result.navidrome?.password === PASSWORD_SENTINEL) {
    const stored = seeded().navidrome?.password ?? '';
    result = { ...result, navidrome: { ...result.navidrome, password: stored } };
  }
  if (result.transport?.authToken === PASSWORD_SENTINEL) {
    const stored = seeded().transport?.authToken ?? null;
    result = { ...result, transport: { ...result.transport, authToken: stored } };
  }
  return result;
}
