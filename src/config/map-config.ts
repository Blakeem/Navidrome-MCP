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
import type { RawConfigInput } from './schema.js';
import type { SettingsFile } from './store.js';

function nonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function cleanList(value: readonly (string | null | undefined)[] | null | undefined): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = value.map((v) => v?.trim()).filter((v): v is string => v !== undefined && v !== '');
  return cleaned.length > 0 ? cleaned : undefined;
}

// A hand-edited or env-set host outside WEBUI_BIND_HOSTS falls back to loopback, the safe default.
function resolveWebuiHost(host: string | undefined): string | undefined {
  if (host === undefined || WEBUI_BIND_HOSTS.includes(host)) return host;
  logger.warn(
    `webui.host "${host}" is not supported (use one of ${WEBUI_BIND_HOSTS.join(', ')}), so the web player binds 127.0.0.1.`,
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
  const radioBrowserUserAgent = nonEmpty(features.radioBrowserUserAgent);
  const lyricsProvider = nonEmpty(features.lyricsProvider);
  const lrclibUserAgent = nonEmpty(features.lrclibUserAgent);

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
      radioBrowser: radioBrowserUserAgent !== undefined,
      lyrics: lyricsProvider !== undefined && lrclibUserAgent !== undefined,
      playback: mpvPath !== null,
    },

    lastFmApiKey,
    // No features.* flag, since MusicBrainz needs no API key. An absent value falls back to
    // DEFAULT_MUSICBRAINZ_USER_AGENT at the call site.
    musicBrainzUserAgent: nonEmpty(features.musicBrainzUserAgent),
    radioBrowserUserAgent,
    radioBrowserBaseOverride: nonEmpty(features.radioBrowserBase),

    lyricsProvider,
    lrclibUserAgent,
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
      auth: {
        mode: webui.auth?.mode ?? 'none',
        adminPasswordHash: nonEmpty(webui.auth?.adminPasswordHash) ?? null,
        adminAccess: webui.auth?.adminAccess ?? 'localhost',
      },
    },

    jukebox: {
      guestQueueLimit: settings.jukebox?.guestQueueLimit ?? DEFAULT_GUEST_QUEUE_LIMIT,
      shareLink: parseJukeboxShareLink(settings.jukebox?.shareLink),
    },
  };
}
