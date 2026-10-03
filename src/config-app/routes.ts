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

import { copyFileSync, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateMappedSettings } from '../config.js';
import { buildFormSeed, FORM_SUGGESTIONS } from '../config/env-settings.js';
import { readSettings, writeSettings, SettingsFileSchema, type SettingsFile } from '../config/store.js';
import { getSettingsStorePath } from '../config/store-path.js';
import { parseWebuiTheme, WEBUI_BIND_HOSTS } from '../constants/defaults.js';
import { NavidromeClient } from '../client/navidrome-client.js';
import { writeJson, writeError, readJsonBody } from '../webui/http-helpers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger, redact } from '../utils/logger.js';
import { describeFetchError } from '../utils/network-safety.js';

/**
 * Stands in for stored secrets (Navidrome password, MCP auth token) in the browser, so they
 * never leave the process in plaintext. A field still equal to it on save/test keeps the stored value.
 */
const SECRET_SENTINEL = '********';

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

/** GET /api/settings/seed. Returns pre-fill values with secrets masked. */
function handleSeed(res: ServerResponse): void {
  try {
    writeJson(res, 200, maskSecrets(buildFormSeed()));
  } catch (err) {
    logger.warn('settings seed failed:', err);
    writeError(res, 500, 'Failed to read settings');
  }
}

// The player's /api/player/settings also writes this file. Both use atomic writeSettings, so concurrent saves are last-writer-wins on the whole file.
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

  const stored = readSettings();
  let backupPath: string | null = null;
  try {
    backupPath = backupUnusableStore(stored);
    writeSettings(withStoredPlayerTheme(parsed, stored));
  } catch (err) {
    logger.error('settings save failed:', err);
    const reason = err instanceof Error ? err.message : String(err);
    writeError(res, 500, `Failed to write settings to ${getSettingsStorePath()}: ${reason}`);
    return;
  }
  const backupNotice = backupPath === null
    ? ''
    : `The previous settings.json could not be read, so it was kept as ${backupPath}. `;
  writeJson(res, 200, {
    ok: true,
    // Host-agnostic: this server is launched by the MCP client, the standalone
    // web player, or `navidrome-config`, and the reader doesn't know which. All
    // load settings once at startup (no hot-reload), so cover both restart paths.
    message:
      `${backupNotice}Settings saved. They load at startup and the server does not hot-reload, so restart ` +
      "whatever you launched to apply them: your MCP client (e.g. quit and reopen Claude " +
      'Desktop, the full toolset appears after a restart) and/or the web player (re-run ' +
      '`navidrome-web`). A web player port or host change needs both restarted. ' +
      'You can keep changing settings and saving again from this page.',
  });
}

// The form never loaded a store that readSettings rejected, so overwriting it would lose every value not retyped.
function backupUnusableStore(stored: SettingsFile | null): string | null {
  const storePath = getSettingsStorePath();
  if (stored !== null || !existsSync(storePath)) return null;
  const backupPath = `${storePath}.bak`;
  copyFileSync(storePath, backupPath);
  return backupPath;
}

// The player's gear modal owns webui.theme and this form does not carry it, so a save keeps the stored theme.
function withStoredPlayerTheme(settings: SettingsFile, stored: SettingsFile | null): SettingsFile {
  const theme = parseWebuiTheme(stored?.webui?.theme);
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
  // Save and Test never read the playback fields, so they skip the mpv detection shell-out.
  return validateMappedSettings(settings, null);
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

function maskSecrets(settings: SettingsFile): SettingsFile {
  let masked = settings;
  const password = settings.navidrome?.password;
  if (password !== undefined && password !== '') {
    masked = { ...masked, navidrome: { ...masked.navidrome, password: SECRET_SENTINEL } };
  }
  const authToken = settings.transport?.authToken;
  if (authToken !== undefined && authToken !== null && authToken !== '') {
    masked = { ...masked, transport: { ...masked.transport, authToken: SECRET_SENTINEL } };
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
  if (result.navidrome?.password === SECRET_SENTINEL) {
    const stored = seeded().navidrome?.password ?? '';
    result = { ...result, navidrome: { ...result.navidrome, password: stored } };
  }
  if (result.transport?.authToken === SECRET_SENTINEL) {
    const stored = seeded().transport?.authToken ?? null;
    result = { ...result, transport: { ...result.transport, authToken: stored } };
  }
  return result;
}
