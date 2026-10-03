/**
 * Navidrome MCP Server - Configuration Schema
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

import { z } from 'zod';
import {
  DEFAULT_CACHE_TTL_SECONDS,
  DEFAULT_LRCLIB_BASE,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_TOKEN_EXPIRY_SECONDS,
  DEFAULT_TRANSCODE_BITRATE,
  DEFAULT_TRANSCODE_FORMAT,
  DEFAULT_WEBUI_PORT,
  WEBUI_THEMES,
} from '../constants/defaults.js';

/**
 * The canonical runtime configuration shape. This is a *flat* projection of the
 * nested `settings.json` store (see `src/config/store.ts`), kept flat because
 * `NavidromeClient`, the playback engine, the managers, and every tool category
 * read fields like `config.navidromeUrl` / `config.features.*` directly.
 */
export const ConfigSchema = z.object({
  navidromeUrl: z.string().url('Navidrome URL must be a valid URL'),
  navidromeUsername: z.string().min(1, 'Navidrome username is required'),
  navidromePassword: z.string().min(1, 'Navidrome password is required'),
  debug: z.boolean().default(false),
  cacheTtl: z.number().positive().default(DEFAULT_CACHE_TTL_SECONDS),
  tokenExpiry: z.number().positive().default(DEFAULT_TOKEN_EXPIRY_SECONDS),

  // 'http' serves Streamable HTTP at `/mcp` so the server can run long-lived without an external bridge.
  // Only an unauthenticated loopback bind auto-allowlists loopback Hosts, since a bearer token already defeats DNS rebinding.
  transport: z.object({
    type: z.enum(['stdio', 'http']).default('stdio'),
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(DEFAULT_MCP_HTTP_PORT),
    expose: z.boolean().default(false),
    authToken: z.string().optional(),
    allowedHosts: z.array(z.string()).optional(),
    allowedOrigins: z.array(z.string()).optional(),
  }),

  // Library Configuration
  defaultLibraryIds: z.array(z.number()).optional(),

  // Feature Configuration
  features: z.object({
    lastfm: z.boolean().default(false),
    radioBrowser: z.boolean().default(false),
    lyrics: z.boolean().default(false),
    playback: z.boolean().default(false),
  }),

  // API Keys and External Service Configuration
  lastFmApiKey: z.string().optional(),
  // MusicBrainz requires a meaningful User-Agent (https://musicbrainz.org/doc/MusicBrainz_API).
  // Optional: absent falls back to DEFAULT_MUSICBRAINZ_USER_AGENT. No feature flag, since
  // MusicBrainz needs no API key, so it is always available.
  musicBrainzUserAgent: z.string().optional(),
  radioBrowserUserAgent: z.string().optional(),
  // Set only when the user explicitly provides a Radio Browser base in the
  // store. It bypasses SRV resolution and pins to the chosen mirror. Production
  // base resolution otherwise flows through `getRadioBrowserBase()` which does
  // SRV-record lookup + caching, with a hardcoded fallback in
  // `RADIO_BROWSER_FALLBACK_BASE`.
  radioBrowserBaseOverride: z.string().url().optional(),

  // Lyrics Configuration
  lyricsProvider: z.string().optional(),
  lrclibUserAgent: z.string().optional(),
  lrclibBase: z.string().url().default(DEFAULT_LRCLIB_BASE),

  // Playback (mpv) Configuration
  mpvPath: z.string().optional(),
  // 'raw' (default) streams the original file untouched: highest quality and
  // fully seekable. Set a codec (e.g. 'mp3', 'opus') to transcode for limited
  // bandwidth. `playbackTranscodeBitrate` then applies.
  playbackTranscodeFormat: z.string().default(DEFAULT_TRANSCODE_FORMAT),
  playbackTranscodeBitrate: z.string().default(DEFAULT_TRANSCODE_BITRATE),

  // Filter cache. When false, re-fetches tag/genre lists on every filter resolution
  // instead of using the startup snapshot. Set to false if you curate your library
  // mid-session and need newly-added genres/labels/moods to be immediately visible.
  filterCacheEnabled: z.boolean().default(true),

  // The web remote initializes only when mpv is detected. `expose` binds 0.0.0.0
  // so a phone on the LAN can reach it, and an explicit `host` wins over it.
  webui: z.object({
    enabled: z.boolean().default(true),
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(DEFAULT_WEBUI_PORT),
    expose: z.boolean().default(false),
    // Off by default so a headless MCP client launch never pops a browser tab.
    autoOpenBrowser: z.boolean().default(false),
    // Off by default so a player the MCP server spawned stops with it and nothing lingers.
    persistAfterMcpExit: z.boolean().default(false),
    // Every device viewing the player uses this theme. Null leaves each device on its own setting.
    theme: z.enum(WEBUI_THEMES).nullable().default(null),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** The pre-validation input shape (fields with defaults are optional). */
export type RawConfigInput = z.input<typeof ConfigSchema>;
