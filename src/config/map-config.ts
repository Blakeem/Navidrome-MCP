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

import { resolveMpvBinary } from '../services/playback/mpv-process.js';
import { DEFAULT_LRCLIB_BASE } from '../constants/defaults.js';
import type { RawConfigInput } from './schema.js';
import type { SettingsFile } from './store.js';

// Kept in its own module (separate from store.ts's file I/O) so that the
// read/write path does NOT transitively import the playback subsystem. Only the
// config-resolution path (which legitimately needs mpv detection) pulls it in.

/** Coerce null/undefined/blank strings to `undefined`; trim otherwise. */
function nonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Project the nested store into the flat `RawConfigInput` that `ConfigSchema`
 * validates. The single place the nested→flat translation lives, shared by
 * `loadConfig()` and the settings server's "test connection" route.
 *
 * Performs mpv detection (so `features.playback` and `mpvPath` are correct),
 * which means it is not side-effect-free (it may shell out via `command -v`).
 */
export function mapStoreToConfig(settings: SettingsFile): RawConfigInput {
  const nav = settings.navidrome ?? {};
  const features = settings.features ?? {};
  const playback = settings.playback ?? {};
  const webui = settings.webui ?? {};
  const advanced = settings.advanced ?? {};
  const library = settings.library ?? {};

  const lastFmApiKey = nonEmpty(features.lastFmApiKey);
  const radioBrowserUserAgent = nonEmpty(features.radioBrowserUserAgent);
  const lyricsProvider = nonEmpty(features.lyricsProvider);
  const lrclibUserAgent = nonEmpty(features.lrclibUserAgent);

  // mpv: explicit store path wins; null/empty → auto-detect. Drives the
  // playback feature flag (and is omitted entirely when unresolved, matching
  // the legacy behavior of only setting `mpvPath` when a binary exists).
  const resolvedMpvPath = resolveMpvBinary(playback.mpvPath);

  // defaultLibraryIds: an empty array means "all libraries" — same as unset.
  const libIds = library.defaultLibraryIds;
  const defaultLibraryIds = libIds !== undefined && libIds.length > 0 ? libIds : undefined;

  // webui host: explicit host wins; otherwise `expose` flips the bind to
  // 0.0.0.0 (replaces the legacy env-only buildWebUiConfig()).
  const expose = webui.expose ?? false;
  const explicitHost = nonEmpty(webui.host);
  const host = explicitHost ?? (expose ? '0.0.0.0' : '127.0.0.1');

  return {
    navidromeUrl: nav.url ?? '',
    navidromeUsername: nav.username ?? '',
    navidromePassword: nav.password ?? '',
    debug: advanced.debug ?? false,
    cacheTtl: advanced.cacheTtl ?? 300,
    tokenExpiry: advanced.tokenExpiry ?? 86400,

    defaultLibraryIds,

    features: {
      lastfm: lastFmApiKey !== undefined,
      radioBrowser: radioBrowserUserAgent !== undefined,
      lyrics: lyricsProvider !== undefined && lrclibUserAgent !== undefined,
      playback: resolvedMpvPath !== null,
    },

    lastFmApiKey,
    radioBrowserUserAgent,
    // Only an explicit, real URL pins the mirror; null/blank keeps SRV resolution.
    radioBrowserBaseOverride: nonEmpty(features.radioBrowserBase),

    lyricsProvider,
    lrclibUserAgent,
    // null/blank falls through to the canonical LRCLIB endpoint.
    lrclibBase: nonEmpty(features.lrclibBase) ?? DEFAULT_LRCLIB_BASE,

    ...(resolvedMpvPath !== null ? { mpvPath: resolvedMpvPath } : {}),
    playbackTranscodeFormat: nonEmpty(playback.transcodeFormat) ?? 'raw',
    playbackTranscodeBitrate: nonEmpty(playback.transcodeBitrate) ?? '192',

    filterCacheEnabled: library.filterCacheEnabled ?? true,

    webui: {
      enabled: webui.enabled ?? true,
      host,
      port: webui.port ?? 8808,
      expose,
      autoOpenBrowser: webui.autoOpenBrowser ?? false,
      persistAfterMcpExit: webui.persistAfterMcpExit ?? false,
    },
  };
}
