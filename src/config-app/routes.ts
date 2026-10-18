/**
 * Navidrome MCP Server - Settings app route handlers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { copyFileSync, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateMappedSettings } from '../config.js';
import { buildFormSeed, FORM_SUGGESTIONS } from '../config/env-settings.js';
import { mergeOntoStored, readRawSettings, writeSettings, SettingsFileSchema, type SettingsFile } from '../config/store.js';
import { getSettingsStorePath } from '../config/store-path.js';
import { parseWebuiTheme, WEBUI_BIND_HOSTS } from '../constants/defaults.js';
import { NavidromeClient } from '../client/navidrome-client.js';
import { writeJson, writeError, readJsonBody } from '../webui/http-helpers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger, redact } from '../utils/logger.js';
import { describeFetchError } from '../utils/network-safety.js';

/**
 * Stands in for the Navidrome password, MCP auth token and Last.fm API key in the browser, so they
 * never leave the process in plaintext. A field still equal to it on Save or Test keeps the seeded value.
 */
const SECRET_SENTINEL = '********';

/** The caller (server.ts) owns the loopback guard, so these handlers assume a local peer. */
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

function handleSeed(res: ServerResponse): void {
  try {
    writeJson(res, 200, maskSecrets(buildFormSeed()));
  } catch (err) {
    logger.warn('settings seed failed:', err);
    writeError(res, 500, 'Failed to read settings');
  }
}

// The player's /api/player/settings also writes this file with atomic writeSettings, so
// concurrent saves are last-writer-wins on the entire file.
async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseSettingsBody(req, res);
  if (parsed === null) return;

  const stored = readRawSettings();
  const settings = withoutLegacyTheme(mergeOntoStored(stored ?? {}, parsed) as SettingsFile);

  // Never persist a file the runtime would reject, such as one with a blank URL.
  const validation = validateForm(settings);
  if (!validation.ok) {
    writeError(res, 400, ErrorFormatter.configValidation(validation.messages));
    return;
  }

  let backupPath: string | null = null;
  try {
    backupPath = backupUnusableStore(stored);
    writeSettings(settings);
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
    // The settings server runs under the MCP server, the web player, or `navidrome-config`, so the
    // message names every restart path.
    message:
      `${backupNotice}Settings saved. They load at startup and the server does not hot-reload, so restart ` +
      "whatever you launched to apply them: your MCP client (e.g. quit and reopen Claude " +
      'Desktop, the full toolset appears after a restart) and/or the web player (re-run ' +
      '`navidrome-web`). A web player port or host change needs both restarted. ' +
      'You can keep changing settings and saving again from this page.',
  });
}

// The form never loaded a store that readRawSettings rejected, so overwriting it would lose every
// value not retyped.
function backupUnusableStore(stored: Record<string, unknown> | null): string | null {
  const storePath = getSettingsStorePath();
  if (stored !== null || !existsSync(storePath)) return null;
  const backupPath = `${storePath}.bak`;
  copyFileSync(storePath, backupPath);
  return backupPath;
}

// The runtime reads a legacy theme such as 'system' as unset, so a save drops it from the file.
function withoutLegacyTheme(settings: SettingsFile): SettingsFile {
  if (settings.webui === undefined) return settings;
  return { ...settings, webui: { ...settings.webui, theme: parseWebuiTheme(settings.webui.theme) ?? undefined } };
}

// The runtime downgrades an unsupported webui.host to a warning, so the form rejects it here,
// where the user can fix it.
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
    await client.initialize();
    writeJson(res, 200, { ok: true, message: 'Successfully connected to Navidrome.' });
  } catch (err) {
    // fetch echoes a URL's userinfo verbatim in its error, and this text reaches the browser.
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
  const lastFmApiKey = settings.features?.lastFmApiKey;
  if (lastFmApiKey !== undefined && lastFmApiKey !== null && lastFmApiKey !== '') {
    masked = { ...masked, features: { ...masked.features, lastFmApiKey: SECRET_SENTINEL } };
  }
  return masked;
}

/**
 * The real secrets come from `buildFormSeed`, the form's seed source, since a first run has no
 * settings.json to read them from.
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
  if (result.features?.lastFmApiKey === SECRET_SENTINEL) {
    const stored = seeded().features?.lastFmApiKey ?? null;
    result = { ...result, features: { ...result.features, lastFmApiKey: stored } };
  }
  return result;
}
