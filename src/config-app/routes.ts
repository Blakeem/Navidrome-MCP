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
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  isAdminPasswordLengthValid,
  parseWebuiTheme,
  WEBUI_BIND_HOSTS,
} from '../constants/defaults.js';
import { NavidromeClient } from '../client/navidrome-client.js';
import { audioDeviceDriver, filterToOneDriver, probeAudioDevices } from '../services/playback/audio-devices.js';
import { resolveMpvBinary } from '../services/playback/mpv-process.js';
import { writeJson, writeError, readJsonBody } from '../webui/http-helpers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger, redact } from '../utils/logger.js';
import { describeFetchError } from '../utils/network-safety.js';
import { hashPassword, isPasswordHash } from '../utils/secrets.js';

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
  if (method === 'GET' && path === '/api/settings/audio-devices') {
    await handleAudioDevices(res);
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
    writeJson(res, 200, seedForBrowser(buildFormSeed()));
  } catch (err) {
    logger.warn('settings seed failed:', err);
    writeError(res, 500, 'Failed to read settings');
  }
}

// A failed probe still answers 200, so the form loads with System default as the only choice. The
// saved device's driver is kept, so a device picked from another driver does not read as missing.
async function handleAudioDevices(res: ServerResponse): Promise<void> {
  try {
    const playback = buildFormSeed().playback;
    const binary = resolveMpvBinary(playback?.mpvPath);
    if (binary === null) {
      writeJson(res, 200, { devices: [], message: 'mpv was not found' });
      return;
    }
    const savedId = playback?.audioDevice?.id;
    const preferredDriver = savedId === undefined ? null : audioDeviceDriver(savedId);
    const devices = filterToOneDriver(await probeAudioDevices(binary), preferredDriver);
    writeJson(res, 200, { devices });
  } catch (err) {
    logger.warn('settings audio device probe failed:', err);
    writeJson(res, 200, { devices: [], message: err instanceof Error ? err.message : String(err) });
  }
}

// The player's /api/player/settings also writes this file with atomic writeSettings, so
// concurrent saves are last-writer-wins on the entire file.
async function handleSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseSettingsBody(req, res);
  if (body === null) return;
  const { settings: parsed, newAdminPassword } = body;

  if (newAdminPassword !== null && !isAdminPasswordLengthValid(newAdminPassword)) {
    writeError(res, 400, ErrorFormatter.configValidation([
      `webui.auth.adminPassword: The admin password must be ${String(ADMIN_PASSWORD_MIN_LENGTH)} to ${String(ADMIN_PASSWORD_MAX_LENGTH)} characters.`,
    ]));
    return;
  }

  const stored = readRawSettings();
  const merged = withoutLegacyTheme(mergeOntoStored(stored ?? {}, parsed) as SettingsFile);

  // Never persist a file the runtime would reject, such as one with a blank URL.
  const validation = validateForm(merged);
  if (!validation.ok) {
    writeError(res, 400, ErrorFormatter.configValidation(validation.messages));
    return;
  }
  const { mode, adminPasswordHash: storedHash } = validation.config.webui.auth;
  if (mode !== 'none' && newAdminPassword === null && !isUsableAdminHash(storedHash)) {
    writeError(res, 400, ErrorFormatter.configValidation([
      'webui.auth.adminPassword: Access with the admin password needs an admin password. Enter one, or set Access to Open.',
    ]));
    return;
  }

  let settings = merged;
  if (newAdminPassword !== null) {
    try {
      settings = withAdminPasswordHash(merged, await hashPassword(newAdminPassword));
    } catch (err) {
      logger.error('admin password hash failed:', err);
      writeError(res, 500, `Failed to hash the admin password: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
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
  const body = await parseSettingsBody(req, res);
  if (body === null) return;

  const validation = validateForm(body.settings);
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

interface SettingsBody {
  settings: SettingsFile;
  /** Null when the write-only field was blank, which keeps the stored hash. */
  newAdminPassword: string | null;
}

/**
 * The schema strips the write-only `webui.auth.adminPassword`, so it is read from the raw body. A
 * posted hash is dropped, so only a password this server hashed reaches the store.
 */
async function parseSettingsBody(req: IncomingMessage, res: ServerResponse): Promise<SettingsBody | null> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    writeError(res, 400, 'Invalid or oversized request body');
    return null;
  }

  const result = SettingsFileSchema.safeParse(body ?? {});
  const newAdminPassword = readNewAdminPassword(body);
  if (!result.success || newAdminPassword === undefined) {
    writeError(res, 400, 'Malformed settings payload');
    return null;
  }
  return { settings: unmaskSecrets(withoutPostedHash(result.data)), newAdminPassword };
}

/** Undefined marks a field that is present but not a string. */
function readNewAdminPassword(body: unknown): string | null | undefined {
  let value: unknown = body;
  for (const key of ['webui', 'auth', 'adminPassword']) {
    value = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  }
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value : undefined;
}

// An undefined key keeps the stored value through mergeOntoStored.
function withoutPostedHash(settings: SettingsFile): SettingsFile {
  const auth = settings.webui?.auth;
  if (auth === undefined || auth === null) return settings;
  return { ...settings, webui: { ...settings.webui, auth: { ...auth, adminPasswordHash: undefined } } };
}

function withAdminPasswordHash(settings: SettingsFile, adminPasswordHash: string): SettingsFile {
  return { ...settings, webui: { ...settings.webui, auth: { ...settings.webui?.auth, adminPasswordHash } } };
}

/** The web player ignores a stored value that is not an Argon2id hash, so the page counts it as unset too. */
function isUsableAdminHash(hash: string | null): boolean {
  return hash !== null && isPasswordHash(hash);
}

/** The browser learns only whether a hash is set, never the hash. */
function seedForBrowser(seed: SettingsFile): SettingsFile & { webui: { auth: { adminPasswordSet: boolean } } } {
  const { adminPasswordHash, ...auth } = seed.webui?.auth ?? {};
  const adminPasswordSet = isUsableAdminHash(adminPasswordHash?.trim() ?? null);
  return { ...maskSecrets(seed), webui: { ...seed.webui, auth: { ...auth, adminPasswordSet } } };
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
