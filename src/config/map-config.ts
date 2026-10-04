/**
 * Navidrome MCP Server - Settings store → flat Config projection
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

import {
  DEFAULT_LRCLIB_BASE,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_TOKEN_EXPIRY_SECONDS,
  DEFAULT_TRANSCODE_BITRATE,
  DEFAULT_TRANSCODE_FORMAT,
  DEFAULT_WEBUI_PORT,
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

// A hand-edited or env-seeded host outside WEBUI_BIND_HOSTS falls back to loopback, the safe default.
function resolveWebuiHost(host: string | undefined): string | undefined {
  if (host === undefined || WEBUI_BIND_HOSTS.includes(host)) return host;
  logger.warn(
    `webui.host "${host}" is not supported (use one of ${WEBUI_BIND_HOSTS.join(', ')}), so the web player binds 127.0.0.1.`,
  );
  return '127.0.0.1';
}

/**
 * Project the nested store into the flat `RawConfigInput` that `ConfigSchema` validates.
 * `mpvPath` is the caller's resolved mpv binary, and null turns playback off.
 */
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

  // defaultLibraryIds: an empty array means "all libraries", the same as unset.
  const libIds = library.defaultLibraryIds;
  const defaultLibraryIds = libIds !== undefined && libIds.length > 0 ? libIds : undefined;

  // webui host: an explicit host wins. Otherwise `expose` flips the bind to 0.0.0.0.
  const expose = webui.expose ?? false;
  const explicitHost = resolveWebuiHost(nonEmpty(webui.host));
  const host = explicitHost ?? (expose ? '0.0.0.0' : '127.0.0.1');

  // transport host: the webui model above. Loopback by default, an explicit
  // host wins, and `expose` is the deliberate opt-in to 0.0.0.0.
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
    // No features.* flag, since MusicBrainz needs no API key. An absent value falls back
    // to DEFAULT_MUSICBRAINZ_USER_AGENT at the call site.
    musicBrainzUserAgent: nonEmpty(features.musicBrainzUserAgent),
    radioBrowserUserAgent,
    // Only an explicit, real URL pins the mirror. Null or blank keeps SRV resolution.
    radioBrowserBaseOverride: nonEmpty(features.radioBrowserBase),

    lyricsProvider,
    lrclibUserAgent,
    // null/blank falls through to the canonical LRCLIB endpoint.
    lrclibBase: nonEmpty(features.lrclibBase) ?? DEFAULT_LRCLIB_BASE,

    ...(mpvPath !== null ? { mpvPath } : {}),
    playbackTranscodeFormat: nonEmpty(playback.transcodeFormat) ?? DEFAULT_TRANSCODE_FORMAT,
    playbackTranscodeBitrate: nonEmpty(playback.transcodeBitrate) ?? DEFAULT_TRANSCODE_BITRATE,

    filterCacheEnabled: library.filterCacheEnabled ?? true,

    webui: {
      enabled: webui.enabled ?? true,
      host,
      port: webui.port ?? DEFAULT_WEBUI_PORT,
      expose,
      autoOpenBrowser: webui.autoOpenBrowser ?? false,
      persistAfterMcpExit: webui.persistAfterMcpExit ?? false,
      theme: parseWebuiTheme(webui.theme),
      visualizer: webui.visualizer ?? true,
    },
  };
}
