/**
 * Navidrome MCP Server - Settings app route handlers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { copyFileSync, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { finished } from 'node:stream';
import type { z } from 'zod';
import { validateMappedSettings } from '../config.js';
import { ConfigSchema } from '../config/schema.js';
import { buildFormSeed } from '../config/env-settings.js';
import {
  mergeOntoStored,
  readRawSettings,
  readSalvagedRawSettings,
  readStoreNotices,
  readStoreProblem,
  writeSettings,
  SettingsFileSchema,
  type SettingsFile,
} from '../config/store.js';
import { getSettingsStorePath } from '../config/store-path.js';
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  isAdminPasswordLengthValid,
  parseWebuiTheme,
  WEBUI_BIND_HOSTS,
} from '../constants/defaults.js';
import { NavidromeClient } from '../client/navidrome-client.js';
import { listUserLibraries } from '../services/library-manager.js';
import { audioDeviceDriver, filterToOneDriver, probeAudioDevices } from '../services/playback/audio-devices.js';
import { resolveMpvBinary } from '../services/playback/mpv-process.js';
import { writeJson, writeError, readJsonBody } from '../webui/http-helpers.js';
import { ErrorFormatter, errorMessage } from '../utils/error-formatter.js';
import { logger, redact } from '../utils/logger.js';
import { describeFetchError } from '../utils/network-safety.js';
import { hashPassword, isPasswordHash } from '../utils/secrets.js';
import { jukeboxLogPath } from '../web/log-path.js';
import { GNOME_ALLOW_LAUNCH_HINT, REINSTALL_HINT } from '../cli/texts.js';
import { createJukeboxShortcut, type ShortcutResult } from '../shortcut/create.js';
import { APP_NAME } from '../shortcut/paths.js';
import { firstSaveSteps, HostStartError, laterSaveMessage, type SaveChange, type SaveTakeover, type SettingsPageHost } from './save-message.js';

/**
 * Stands in for the Navidrome password, MCP auth token and Last.fm API key in the browser, so they
 * never leave the process in plaintext. A field still equal to it on Save or Test keeps the seeded value.
 */
const SECRET_SENTINEL = '********';

/** The page sets it on a Save that posts only the fields changed since it loaded a usable store. */
const CHANGED_ONLY_HEADER = 'x-settings-changed-only';
const STORE_CHANGED_SINCE_LOAD =
  'settings.json changed after this page loaded, and the server can no longer use it. Reload the page, then save again.';
const HOST_STARTING_FROM_SAVE = "Another tab's Save is starting the Jukebox Remote. Save here again only if that start fails.";

/** Holds each host that is starting, or started, from a Save until its settings server closes. */
const hostsStartingFromSave = new WeakSet<SettingsRouteContext>();

/** What the settings server's host gives the Save route. */
export interface SettingsRouteContext {
  host: SettingsPageHost;
  /** A resolve means the host took over, so the route closes the server once the reply is sent. */
  onSaved: (() => Promise<SaveTakeover>) | undefined;
  close: () => Promise<void>;
}

/** The caller (server.ts) owns the loopback guard, so these handlers assume a local peer. */
export async function handleSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  context: SettingsRouteContext,
): Promise<boolean> {
  if (method === 'GET' && path === '/api/settings/seed') {
    handleSeed(res);
    return true;
  }
  if (method === 'GET' && path === '/api/settings/audio-devices') {
    await handleAudioDevices(res);
    return true;
  }
  if (method === 'POST' && path === '/api/settings') {
    await handleSave(req, res, context);
    return true;
  }
  if (method === 'POST' && path === '/api/settings/test') {
    await handleTest(req, res);
    return true;
  }
  if (method === 'POST' && path === '/api/settings/libraries') {
    await handleLibraries(req, res);
    return true;
  }
  if (method === 'POST' && path === '/api/settings/shortcut') {
    await handleShortcut(res);
    return true;
  }
  return false;
}

function handleSeed(res: ServerResponse): void {
  try {
    const problem = readStoreProblem();
    writeJson(res, 200, {
      ...seedForBrowser(buildFormSeed()),
      // The page posts only changed fields over a usable store, and every field otherwise.
      storeUsable: readRawSettings() !== null,
      storeProblem: problem?.text ?? null,
      storeUnreadable: problem?.unreadable === true,
      storeSalvaged: problem?.salvaged === true,
      storeNotices: readStoreNotices(),
      storePath: getSettingsStorePath(),
      logPath: jukeboxLogPath(),
    });
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
    writeJson(res, 200, { devices: [], message: errorMessage(err) });
  }
}

/**
 * A host that starts from a Save reads settings.json once, so a Save from a second tab during that
 * start, or after it, would write settings the started host never reads.
 */
async function handleSave(req: IncomingMessage, res: ServerResponse, context: SettingsRouteContext): Promise<void> {
  if (context.onSaved === undefined) {
    await saveSettings(req, res, context);
    return;
  }
  if (hostsStartingFromSave.has(context)) {
    writeError(res, 409, HOST_STARTING_FROM_SAVE);
    return;
  }
  hostsStartingFromSave.add(context);
  let tookOver = false;
  try {
    tookOver = await saveSettings(req, res, context);
  } finally {
    if (!tookOver) hostsStartingFromSave.delete(context);
  }
}

// The player's /api/player/settings also writes this file with atomic writeSettings, so
// concurrent saves are last-writer-wins on the entire file. Returns true when the host took over.
async function saveSettings(req: IncomingMessage, res: ServerResponse, context: SettingsRouteContext): Promise<boolean> {
  const body = await parseSettingsBody(req, res);
  if (body === null) return false;
  const { settings: parsed, newAdminPassword } = body;

  if (newAdminPassword !== null && !isAdminPasswordLengthValid(newAdminPassword)) {
    writeError(res, 400, ErrorFormatter.configValidation([
      `webui.auth.adminPassword: The admin password must be ${String(ADMIN_PASSWORD_MIN_LENGTH)} to ${String(ADMIN_PASSWORD_MAX_LENGTH)} characters.`,
    ]));
    return false;
  }

  const stored = readRawSettings();
  const noticesBeforeSave = readStoreNotices();
  const storedConfig = usableStoredSettings(stored);
  // A changed-fields body over an env or salvaged base would replace the values the page showed.
  if (stored === null && req.headers[CHANGED_ONLY_HEADER] === '1') {
    writeError(res, 409, STORE_CHANGED_SINCE_LOAD);
    return false;
  }
  // The form seeded from a rejected file's valid values, so a save also keeps the values and keys the form does not show, such as the admin password hash.
  const salvaged = stored === null ? readSalvagedRawSettings() : null;
  const base = stored ?? withSeedValuesTheFormHides(salvaged ?? {});
  const merged = normalizedForSave(mergeOntoStored(base, parsed) as SettingsFile);

  // Never persist a file the runtime would reject, such as one with a blank URL.
  const validation = validateForm(merged);
  if (!validation.ok) {
    writeError(res, 400, ErrorFormatter.configValidation(validation.messages));
    return false;
  }

  let settings = merged;
  if (newAdminPassword !== null) {
    try {
      settings = withAdminPasswordHash(merged, await hashPassword(newAdminPassword));
    } catch (err) {
      logger.error('admin password hash failed:', err);
      writeError(res, 500, `Failed to hash the admin password: ${errorMessage(err)}`);
      return false;
    }
  }

  let backupPath: string | null = null;
  try {
    backupPath = backupUnusableStore(stored);
    writeSettings(settings);
  } catch (err) {
    logger.error('settings save failed:', err);
    const reason = errorMessage(err);
    writeError(res, 500, `Failed to write settings to ${getSettingsStorePath()}: ${reason}`);
    return false;
  }
  const backupNotice = backupPath === null ? '' : backupMessage(backupPath, salvaged !== null);
  const savedTo = `${backupNotice}Settings saved to ${getSettingsStorePath()}.`;
  const storeNotices = readStoreNotices();

  const hostStart = await runOnSaved(context);
  if ('startError' in hostStart) {
    writeJson(res, 200, { ok: true, message: `${savedTo} ${hostStart.startError}`, startFailed: true, storeNotices });
    return false;
  }

  const { takeover } = hostStart;
  const webui = validation.config.webui;
  const clearedStoreNotice = noticesBeforeSave.some((notice) => !storeNotices.includes(notice));
  if (storedConfig === null || takeover !== null) {
    const nextSteps = firstSaveSteps(context.host, webui, takeover);
    writeJson(res, 200, { ok: true, message: savedTo, nextSteps, pageClosed: takeover !== null, storeNotices });
  } else if (context.host === 'mcp-setup') {
    // An MCP server in setup mode loads no store until the AI app restarts, so its next steps name that
    // restart. A running player may still have read the stored file, so the message names its restart.
    const message = laterSaveMessage(savedTo, saveChange(storedConfig, settings, newAdminPassword, clearedStoreNotice), 'mcp');
    writeJson(res, 200, { ok: true, message, nextSteps: firstSaveSteps(context.host, webui, null), storeNotices });
  } else {
    const message = laterSaveMessage(savedTo, saveChange(storedConfig, settings, newAdminPassword, clearedStoreNotice));
    writeJson(res, 200, { ok: true, message, storeNotices });
  }
  if (takeover !== null) finished(res, () => void context.close());
  return takeover !== null;
}

/** A null takeover means no host waits on a Save. A startError says why the host could not start and how to recover. */
async function runOnSaved(context: SettingsRouteContext): Promise<{ takeover: SaveTakeover | null } | { startError: string }> {
  if (context.onSaved === undefined) return { takeover: null };
  try {
    return { takeover: await context.onSaved() };
  } catch (err) {
    logger.error('settings save: the host could not start with the saved settings:', err);
    if (err instanceof HostStartError) return { startError: err.message };
    const reason = browserSafeError(err);
    return { startError: `The Jukebox Remote could not start. Fix the settings and save again. Error: ${reason}` };
  }
}

function saveChange(storedFile: SettingsFile, saved: SettingsFile, newAdminPassword: string | null, clearedStoreNotice: boolean): SaveChange {
  return { storedFile, storedSettings: normalizedForSave(storedFile), saved, adminPasswordChanged: newAdminPassword !== null, clearedStoreNotice };
}

/** Null when the store before the save gave no usable config, so no running process read it. */
function usableStoredSettings(stored: Record<string, unknown> | null): SettingsFile | null {
  if (stored === null) return null;
  const settings = stored as SettingsFile;
  return validateMappedSettings(settings, null).ok ? settings : null;
}

function backupMessage(backupPath: string, salvaged: boolean): string {
  return salvaged
    ? `The previous settings.json failed validation. This save kept each of its valid values. The old file is kept as ${backupPath}. `
    : `The previous settings.json could not be read, so it was kept as ${backupPath}. `;
}

// A save over a store that readRawSettings rejected drops its invalid values, so the backup keeps
// them, such as a mistyped value the user still has to retype.
function backupUnusableStore(stored: Record<string, unknown> | null): string | null {
  const storePath = getSettingsStorePath();
  if (stored !== null || !existsSync(storePath)) return null;
  const backupPath = `${storePath}.bak`;
  copyFileSync(storePath, backupPath);
  return backupPath;
}

// Each step writes a value the runtime already read the same way, so a later save compares the stored file through it too.
function normalizedForSave(settings: SettingsFile): SettingsFile {
  return withoutLegacyLyricsProvider(withShownFeatureSwitches(withoutLegacyTheme(settings)));
}

// The runtime reads a legacy theme such as 'system' as unset, so a save drops it from the file.
function withoutLegacyTheme(settings: SettingsFile): SettingsFile {
  if (settings.webui === undefined) return settings;
  return { ...settings, webui: { ...settings.webui, theme: parseWebuiTheme(settings.webui.theme) ?? undefined } };
}

// The page posts no value for these keys, so a save with no usable store carries the seed's values, such as MUSICBRAINZ_USER_AGENT.
// Each key has no page field, belongs to the player's gear menu or Guests dialog, or sits in a row the page disables while unused.
function withSeedValuesTheFormHides(base: Record<string, unknown>): Record<string, unknown> {
  const seed = buildFormSeed();
  const auth = seed.webui?.auth;
  const rules = ConfigSchema.shape;
  return mergeOntoStored(base, {
    transport: {
      ...seed.transport,
      port: seedNumberOrUndefined('transport.port', seed.transport?.port, rules.transport.shape.port),
    },
    playback: { transcodeBitrate: seed.playback?.transcodeBitrate },
    features: { musicBrainzUserAgent: seed.features?.musicBrainzUserAgent ?? undefined },
    webui: {
      persistAfterMcpExit: seed.webui?.persistAfterMcpExit,
      visualizer: seed.webui?.visualizer,
      auth: { adminAccess: auth?.adminAccess, askPasswordOnThisComputer: auth?.askPasswordOnThisComputer },
    },
    jukebox: {
      guestQueueLimit: seedNumberOrUndefined('jukebox.guestQueueLimit', seed.jukebox?.guestQueueLimit, rules.jukebox.shape.guestQueueLimit),
    },
    advanced: { tokenExpiry: seedNumberOrUndefined('advanced.tokenExpiry', seed.advanced?.tokenExpiry, rules.tokenExpiry) },
  });
}

// The page cannot correct a seed number it has no field for or disables. An env seed number that fails its rule
// would block every save, so the save leaves it out and the runtime default applies. A salvaged file's value stays in the base.
function seedNumberOrUndefined(storePath: string, value: number | undefined, rule: z.ZodType<number>): number | undefined {
  if (value === undefined || rule.safeParse(value).success) return value;
  logger.warn(`The settings save leaves out the seed value ${String(value)} of ${storePath}, since it fails validation. A salvaged settings.json value at that key stays, and the save error names it.`);
  return undefined;
}

// The page posts only changed fields, so a save of a file that predates the radio and lyrics booleans writes the state the page showed.
function withShownFeatureSwitches(settings: SettingsFile): SettingsFile {
  const features = settings.features ?? {};
  const shown = buildFormSeed().features;
  return { ...settings, features: { ...features, radio: features.radio ?? shown?.radio, lyrics: features.lyrics ?? shown?.lyrics } };
}

// The runtime reads features.lyricsProvider only while features.lyrics is absent, so a save that sets features.lyrics drops it.
function withoutLegacyLyricsProvider(settings: SettingsFile): SettingsFile {
  if (settings.features?.lyrics === undefined) return settings;
  return { ...settings, features: { ...settings.features, lyricsProvider: undefined } };
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

// fetch echoes a URL's userinfo verbatim in its error, and this text reaches the browser.
function browserSafeError(err: unknown): string {
  return redact(describeFetchError(err)) as string;
}

/**
 * A failed validation or login answers with a 200 and `ok: false`, and a malformed body answers
 * 400. Each returns null after it answers.
 */
async function loginFromBody(req: IncomingMessage, res: ServerResponse): Promise<NavidromeClient | null> {
  const body = await parseSettingsBody(req, res);
  if (body === null) return null;

  const validation = validateForm(body.settings);
  if (!validation.ok) {
    writeJson(res, 200, { ok: false, error: ErrorFormatter.configValidation(validation.messages) });
    return null;
  }

  try {
    const client = new NavidromeClient(validation.config);
    await client.initialize();
    return client;
  } catch (err) {
    writeJson(res, 200, { ok: false, error: browserSafeError(err) });
    return null;
  }
}

async function handleTest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const client = await loginFromBody(req, res);
  if (client === null) return;
  writeJson(res, 200, { ok: true, message: 'Successfully connected to Navidrome.' });
}

// The page keeps its text field when this answers ok: false, so a failed list never blocks a save.
async function handleLibraries(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const client = await loginFromBody(req, res);
  if (client === null) return;

  try {
    writeJson(res, 200, { ok: true, libraries: await listUserLibraries(client) });
  } catch (err) {
    logger.warn('settings library list failed:', err);
    writeJson(res, 200, { ok: false, error: browserSafeError(err) });
  }
}

// A failure answers ok: false with the cause, such as the build hint a dev clone with no dist/ gets.
async function handleShortcut(res: ServerResponse): Promise<void> {
  let result: ShortcutResult;
  try {
    result = await createJukeboxShortcut();
  } catch (err) {
    logger.warn('settings shortcut creation failed:', err);
    writeJson(res, 200, { ok: false, error: `Could not create the shortcut: ${errorMessage(err)}` });
    return;
  }
  writeJson(res, 200, { ok: true, message: shortcutMessage(result), paths: result.written });
}

/** The page lists the written paths below this text. */
function shortcutMessage(result: ShortcutResult): string {
  const { removed, kept } = result.oldCleanup;
  const sentences = [`Created the ${APP_NAME} shortcut. Double-click it to start the ${APP_NAME}.`];
  if (result.runner !== null) sentences.push(`The shortcut runs ${result.runner}.`);
  if (result.unconfigured) sentences.push('Navidrome is not configured yet, so the first launch opens this settings page.');
  if (removed.length > 0) sentences.push(`Removed the old Navidrome Player shortcut files: ${removed.join(', ')}.`);
  if (kept.length > 0) sentences.push(`Left in place: ${kept.map(({ path, reason }) => `${path} (${reason})`).join(', ')}.`);
  sentences.push(`Create it again ${REINSTALL_HINT}`);
  if (process.platform === 'linux') sentences.push(GNOME_ALLOW_LAUNCH_HINT);
  return sentences.join(' ');
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

/** The Jukebox Remote ignores a stored value that is not an Argon2id hash, so the page counts it as unset too. */
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
