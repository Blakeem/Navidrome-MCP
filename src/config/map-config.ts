/**
 * Navidrome MCP Server - Settings store → flat Config projection
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  DEFAULT_GUEST_QUEUE_LIMIT,
  DEFAULT_LRCLIB_BASE,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_TOKEN_EXPIRY_SECONDS,
  DEFAULT_TRANSCODE_BITRATE,
  DEFAULT_TRANSCODE_FORMAT,
  DEFAULT_WEBUI_PORT,
  parseJukeboxShareLink,
  parseWebuiTheme,
  WEBUI_BIND_HOSTS,
} from '../constants/defaults.js';
import { logger } from '../utils/logger.js';
import { isLanReachable } from '../webui/network.js';
import { resolveFeatureSwitches } from './feature-switches.js';
import { nonEmpty } from './non-empty.js';
import type { Config, RawConfigInput } from './schema.js';
import type { SettingsFile } from './store.js';

type StoredWebuiAuth = NonNullable<SettingsFile['webui']>['auth'];

function cleanList(value: readonly (string | null | undefined)[] | null | undefined): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = value.map((v) => v?.trim()).filter((v): v is string => v !== undefined && v !== '');
  return cleaned.length > 0 ? cleaned : undefined;
}

// A hand-edited or env-set host outside WEBUI_BIND_HOSTS falls back to loopback, the safe default.
function resolveWebuiHost(host: string | undefined): string | undefined {
  if (host === undefined || WEBUI_BIND_HOSTS.includes(host)) return host;
  logger.warn(
    `webui.host "${host}" is not supported (use one of ${WEBUI_BIND_HOSTS.join(', ')}), so the Jukebox Remote binds 127.0.0.1.`,
  );
  return '127.0.0.1';
}

// The id `auto` is mpv's OS default output, the same as no saved device.
function mapAudioDevice(
  device: NonNullable<SettingsFile['playback']>['audioDevice'],
): RawConfigInput['playbackAudioDevice'] {
  const id = nonEmpty(device?.id);
  if (id === undefined || id === 'auto') return null;
  return { id, name: nonEmpty(device?.name) ?? null };
}

/** A typed table, so a new Config field fails to compile until it names its settings.json key. */
const STORE_PATH_BY_CONFIG_KEY: Record<keyof RawConfigInput, string> = {
  navidromeUrl: 'navidrome.url',
  navidromeUsername: 'navidrome.username',
  navidromePassword: 'navidrome.password',
  debug: 'advanced.debug',
  tokenExpiry: 'advanced.tokenExpiry',
  transport: 'transport',
  defaultLibraryIds: 'library.defaultLibraryIds',
  features: 'features',
  lastFmApiKey: 'features.lastFmApiKey',
  musicBrainzUserAgent: 'features.musicBrainzUserAgent',
  radioBrowserUserAgent: 'features.radioBrowserUserAgent',
  radioBrowserBaseOverride: 'features.radioBrowserBase',
  lrclibUserAgent: 'features.lrclibUserAgent',
  lrclibBase: 'features.lrclibBase',
  mpvPath: 'playback.mpvPath',
  playbackTranscodeFormat: 'playback.transcodeFormat',
  playbackTranscodeBitrate: 'playback.transcodeBitrate',
  playbackAudioDevice: 'playback.audioDevice',
  filterCacheEnabled: 'library.filterCacheEnabled',
  webui: 'webui',
  jukebox: 'jukebox',
};

/**
 * A Config issue path starts with a projection key such as `navidromeUrl`, and a person editing
 * settings.json needs the file's key, such as `navidrome.url`. Nested keys share their store names.
 */
export function storePathOf(issuePath: readonly PropertyKey[]): string {
  const [first, ...rest] = issuePath.map(String);
  if (first === undefined) return '(root)';
  const head = Object.hasOwn(STORE_PATH_BY_CONFIG_KEY, first)
    ? STORE_PATH_BY_CONFIG_KEY[first as keyof RawConfigInput]
    : first;
  return [head, ...rest].join('.');
}

/**
 * An explicit host wins over `expose`, so a stored pair that disagrees binds where `expose` does not
 * say. Only a pair with both keys set counts, and the transport pair only for an http transport.
 */
export function findBindConflicts(settings: SettingsFile): string[] {
  const conflicts: string[] = [];
  const webuiHost = nonEmpty(settings.webui?.host);
  const webuiExpose = settings.webui?.expose;
  if (webuiHost !== undefined && WEBUI_BIND_HOSTS.includes(webuiHost) && webuiExpose !== undefined) {
    const conflict = bindConflict('webui', 'the Jukebox Remote', webuiHost, webuiExpose);
    if (conflict !== null) conflicts.push(conflict);
  }
  const transportHost = nonEmpty(settings.transport?.host);
  const transportExpose = settings.transport?.expose;
  if (settings.transport?.type === 'http' && transportHost !== undefined && transportExpose !== undefined) {
    const conflict = bindConflict('transport', 'the MCP HTTP server', transportHost, transportExpose);
    if (conflict !== null) conflicts.push(conflict);
  }
  return conflicts;
}

function bindConflict(section: string, listener: string, host: string, expose: boolean): string | null {
  const hostExposes = isLanReachable(host);
  if (hostExposes === expose) return null;
  const binds = hostExposes ? `opens ${listener} to the network` : `keeps ${listener} on this computer`;
  return (
    `${section}.host "${host}" ${binds}, but ${section}.expose is ${String(expose)}. ` +
    `${section}.host wins. Clear ${section}.host to let ${section}.expose decide.`
  );
}

/** A running player re-reads these values from the store too, so it fills an absent key with the same default as startup. */
export function mapStoreWebuiAuth(auth: StoredWebuiAuth): Config['webui']['auth'] {
  return {
    mode: auth?.mode ?? 'none',
    adminPasswordHash: nonEmpty(auth?.adminPasswordHash) ?? null,
    adminAccess: auth?.adminAccess ?? 'localhost',
    askPasswordOnThisComputer: auth?.askPasswordOnThisComputer ?? true,
  };
}

/** `mpvPath` is the caller's resolved mpv binary, and null turns playback off. */
export function mapStoreToConfig(settings: SettingsFile, mpvPath: string | null): RawConfigInput {
  const nav = settings.navidrome ?? {};
  const transport = settings.transport ?? {};
  const features = settings.features ?? {};
  const playback = settings.playback ?? {};
  const webui = settings.webui ?? {};
  const advanced = settings.advanced ?? {};
  const library = settings.library ?? {};

  const lastFmApiKey = nonEmpty(features.lastFmApiKey);
  const switches = resolveFeatureSwitches(features);

  // An empty array means all libraries, the same as unset.
  const libIds = library.defaultLibraryIds;
  const defaultLibraryIds = libIds !== undefined && libIds.length > 0 ? libIds : undefined;

  const expose = webui.expose ?? false;
  const explicitHost = resolveWebuiHost(nonEmpty(webui.host));
  const host = explicitHost ?? (expose ? '0.0.0.0' : '127.0.0.1');

  const transportExpose = transport.expose ?? false;
  const transportExplicitHost = nonEmpty(transport.host);
  const transportHost = transportExplicitHost ?? (transportExpose ? '0.0.0.0' : '127.0.0.1');

  return {
    navidromeUrl: nonEmpty(nav.url)?.replace(/\/+$/, '') ?? '',
    navidromeUsername: nav.username?.trim() ?? '',
    navidromePassword: nav.password ?? '',
    debug: advanced.debug ?? false,
    tokenExpiry: advanced.tokenExpiry ?? DEFAULT_TOKEN_EXPIRY_SECONDS,

    transport: {
      type: transport.type ?? 'stdio',
      host: transportHost,
      port: transport.port ?? DEFAULT_MCP_HTTP_PORT,
      expose: transportExpose,
      authToken: nonEmpty(transport.authToken),
      allowedHosts: cleanList(transport.allowedHosts),
      allowedOrigins: cleanList(transport.allowedOrigins),
    },

    defaultLibraryIds,

    features: {
      lastfm: lastFmApiKey !== undefined,
      radioBrowser: switches.radio,
      lyrics: switches.lyrics,
      playback: mpvPath !== null,
    },

    lastFmApiKey,
    // No features.* flag, since MusicBrainz needs no API key. An absent value falls back to
    // DEFAULT_MUSICBRAINZ_USER_AGENT at the call site.
    musicBrainzUserAgent: nonEmpty(features.musicBrainzUserAgent),
    radioBrowserUserAgent: nonEmpty(features.radioBrowserUserAgent),
    radioBrowserBaseOverride: nonEmpty(features.radioBrowserBase),

    lrclibUserAgent: nonEmpty(features.lrclibUserAgent),
    lrclibBase: nonEmpty(features.lrclibBase) ?? DEFAULT_LRCLIB_BASE,

    ...(mpvPath !== null ? { mpvPath } : {}),
    playbackTranscodeFormat: nonEmpty(playback.transcodeFormat) ?? DEFAULT_TRANSCODE_FORMAT,
    playbackTranscodeBitrate: nonEmpty(playback.transcodeBitrate) ?? DEFAULT_TRANSCODE_BITRATE,
    playbackAudioDevice: mapAudioDevice(playback.audioDevice),

    filterCacheEnabled: library.filterCacheEnabled ?? true,

    webui: {
      enabled: webui.enabled ?? true,
      host,
      port: webui.port ?? DEFAULT_WEBUI_PORT,
      expose,
      allowedHosts: cleanList(webui.allowedHosts) ?? [],
      publicUrl: nonEmpty(webui.publicUrl) ?? null,
      autoOpenBrowser: webui.autoOpenBrowser ?? false,
      persistAfterMcpExit: webui.persistAfterMcpExit ?? false,
      theme: parseWebuiTheme(webui.theme),
      visualizer: webui.visualizer ?? true,
      tls: {
        certPath: nonEmpty(webui.tls?.certPath) ?? null,
        keyPath: nonEmpty(webui.tls?.keyPath) ?? null,
      },
      auth: mapStoreWebuiAuth(webui.auth),
    },

    jukebox: {
      guestQueueLimit: settings.jukebox?.guestQueueLimit ?? DEFAULT_GUEST_QUEUE_LIMIT,
      shareLink: parseJukeboxShareLink(settings.jukebox?.shareLink),
    },
  };
}
