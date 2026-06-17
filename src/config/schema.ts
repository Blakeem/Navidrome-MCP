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
import { DEFAULT_LRCLIB_BASE } from '../constants/defaults.js';

/**
 * The canonical runtime configuration shape. This is a *flat* projection of the
 * nested `settings.json` store (see `src/config/store.ts`), kept flat because
 * `NavidromeClient`, the playback engine, the managers, and every tool category
 * read fields like `config.navidromeUrl` / `config.features.*` directly.
 *
 * Extracted into its own module (rather than living in `src/config.ts`) so that
 * `store.ts` can map the nested store into this shape without a circular import
 * back through `config.ts`.
 */
export const ConfigSchema = z.object({
  navidromeUrl: z.string().url('NAVIDROME_URL must be a valid URL'),
  navidromeUsername: z.string().min(1, 'NAVIDROME_USERNAME is required'),
  navidromePassword: z.string().min(1, 'NAVIDROME_PASSWORD is required'),
  debug: z.boolean().default(false),
  cacheTtl: z.number().positive().default(300),
  tokenExpiry: z.number().positive().default(86400), // Default 24 hours in seconds

  // MCP Transport Configuration — how the MCP server exposes itself to clients.
  // 'stdio' (default) is the classic local-process transport every desktop MCP
  // client speaks; nothing binds a socket. 'http' serves the MCP Streamable HTTP
  // transport on `host:port` so the server can run as a long-lived process
  // (e.g. a container in a cluster) that remote clients connect to over HTTP —
  // removing the need to wrap it in an external bridge like `supergateway`.
  // `host` defaults to 0.0.0.0 because choosing 'http' is itself the opt-in to
  // network exposure (the local-only default lives in 'stdio'); secure it with
  // network policy / a reverse proxy. The MCP endpoint is served at `/mcp`.
  transport: z.object({
    type: z.enum(['stdio', 'http']).default('stdio'),
    host: z.string().default('0.0.0.0'),
    port: z.number().int().min(1).max(65535).default(3000),
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
  // Optional: absent falls back to DEFAULT_MUSICBRAINZ_USER_AGENT. No feature flag —
  // MusicBrainz needs no API key, so it is always available.
  musicBrainzUserAgent: z.string().optional(),
  radioBrowserUserAgent: z.string().optional(),
  // Set only when the user explicitly provides a Radio Browser base in the
  // store — bypasses SRV resolution and pins to the chosen mirror. Production
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
  // bandwidth — `playbackTranscodeBitrate` then applies.
  playbackTranscodeFormat: z.string().default('raw'),
  playbackTranscodeBitrate: z.string().default('192'),

  // Filter cache — when false, re-fetches tag/genre lists on every filter resolution
  // instead of using the startup snapshot. Set to false if you curate your library
  // mid-session and need newly-added genres/labels/moods to be immediately visible.
  filterCacheEnabled: z.boolean().default(true),

  // Web UI Configuration — companion HTTP control panel for mpv playback.
  // The web UI is implicitly gated by the playback feature: it only ever
  // initializes when mpv is detected. Even when `enabled` is true, the
  // server does not bind a port until something has been queued.
  // `host=127.0.0.1` keeps the panel on localhost only. Setting `expose=true`
  // forces the bind to `0.0.0.0` so a phone on the same LAN can reach it;
  // explicit `host` overrides this.
  webui: z.object({
    enabled: z.boolean().default(true),
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(8808),
    expose: z.boolean().default(false),
    // When true, the player opens in the user's browser automatically when the
    // MCP server starts (the standalone `navidrome-web` bin always opens, since
    // the user ran it explicitly). Default false to avoid popping a tab on every
    // headless Claude Desktop launch.
    autoOpenBrowser: z.boolean().default(false),
    // When true, a player spawned by the MCP server keeps running (and mpv keeps
    // playing) after the MCP server closes/restarts. Default false: the spawned
    // player and mpv stop with the MCP server, so nothing lingers. A player you
    // launch yourself (`navidrome-web`) always persists regardless. Can be
    // toggled live in the player's loopback-only settings modal.
    persistAfterMcpExit: z.boolean().default(false),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** The pre-validation input shape (fields with defaults are optional). */
export type RawConfigInput = z.input<typeof ConfigSchema>;
