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
import { WEBUI_THEMES } from '../constants/defaults.js';

/**
 * The canonical runtime configuration shape. This is a *flat* projection of the
 * nested `settings.json` store (see `src/config/store.ts`), kept flat because
 * `NavidromeClient`, the playback engine, the managers, and every tool category
 * read fields like `config.navidromeUrl` / `config.features.*` directly.
 */
export const ConfigSchema = z.object({
  navidromeUrl: z.url({ protocol: /^https?$/, error: 'Navidrome URL must be a valid URL starting with http:// or https://' }),
  navidromeUsername: z.string().min(1, 'Navidrome username is required'),
  navidromePassword: z.string().min(1, 'Navidrome password is required'),
  debug: z.boolean(),
  tokenExpiry: z.number().positive(),

  // 'http' serves Streamable HTTP at `/mcp` so the server can run long-lived without an external bridge.
  // Only an unauthenticated loopback bind auto-allowlists loopback Hosts, since a bearer token already defeats DNS rebinding.
  transport: z.object({
    type: z.enum(['stdio', 'http']),
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    expose: z.boolean(),
    authToken: z.string().optional(),
    allowedHosts: z.array(z.string()).optional(),
    allowedOrigins: z.array(z.string()).optional(),
  }),

  defaultLibraryIds: z.array(z.number()).optional(),

  features: z.object({
    lastfm: z.boolean(),
    radioBrowser: z.boolean(),
    lyrics: z.boolean(),
    playback: z.boolean(),
  }),

  lastFmApiKey: z.string().optional(),
  // MusicBrainz requires a meaningful User-Agent (https://musicbrainz.org/doc/MusicBrainz_API).
  musicBrainzUserAgent: z.string().optional(),
  radioBrowserUserAgent: z.string().optional(),
  // An explicit base pins one mirror and bypasses SRV resolution.
  radioBrowserBaseOverride: z.url({ protocol: /^https?$/ }).optional(),

  lyricsProvider: z.string().optional(),
  lrclibUserAgent: z.string().optional(),
  lrclibBase: z.url({ protocol: /^https?$/ }),

  mpvPath: z.string().optional(),
  // 'raw' streams the original file untouched, at the highest quality and fully seekable.
  // A codec such as 'mp3' or 'opus' transcodes for limited bandwidth at `playbackTranscodeBitrate`.
  playbackTranscodeFormat: z.string(),
  playbackTranscodeBitrate: z.string(),

  // Off re-fetches tag lists on each filter resolution so mid-session library edits show at once.
  filterCacheEnabled: z.boolean(),

  // The web remote initializes only when mpv is detected. `expose` binds 0.0.0.0
  // so a phone on the LAN can reach it, and an explicit `host` wins over it.
  webui: z.object({
    enabled: z.boolean(),
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    expose: z.boolean(),
    // Off by default so a headless MCP client launch never pops a browser tab.
    autoOpenBrowser: z.boolean(),
    // Off by default so an MCP-launched player stops with the last MCP server using it and nothing lingers.
    persistAfterMcpExit: z.boolean(),
    // Every device viewing the player uses this theme. Null leaves each device on its own setting.
    theme: z.enum(WEBUI_THEMES).nullable(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** The pre-validation input shape. No field has a schema default, so the compiler flags a mapper that omits one. */
export type RawConfigInput = z.input<typeof ConfigSchema>;
