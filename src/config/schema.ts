/**
 * Navidrome MCP Server - Configuration Schema
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import { WEBUI_THEMES } from '../constants/defaults.js';

/**
 * A flatter projection of the nested settings.json store, since the client, engine, managers, and
 * tools read fields such as `config.navidromeUrl` directly.
 */
export const ConfigSchema = z.object({
  navidromeUrl: z.url({ protocol: /^https?$/, error: 'Navidrome URL must be a valid URL starting with http:// or https://' }),
  navidromeUsername: z.string().min(1, 'Navidrome username is required'),
  navidromePassword: z.string().min(1, 'Navidrome password is required'),
  debug: z.boolean(),
  tokenExpiry: z.number().positive(),

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
  // 'raw' streams the original file, which keeps full quality and seeking. A codec such as 'mp3'
  // or 'opus' transcodes at `playbackTranscodeBitrate` for limited bandwidth.
  playbackTranscodeFormat: z.string(),
  playbackTranscodeBitrate: z.string(),
  // Null plays to the OS default output.
  playbackAudioDevice: z.object({ id: z.string().min(1), name: z.string().nullable() }).nullable(),

  // Off re-fetches tag lists on each filter resolution so mid-session library edits show at once.
  filterCacheEnabled: z.boolean(),

  // An MCP spawns the web remote only when mpv is detected. `expose` binds 0.0.0.0 so a phone on
  // the LAN can reach it, and an explicit `host` wins over it.
  webui: z.object({
    enabled: z.boolean(),
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    expose: z.boolean(),
    // A LAN bind always accepts IP literals and this machine's names. Any other Host must be listed.
    allowedHosts: z.array(z.string()),
    // Off by default so a headless MCP client launch never pops a browser tab.
    autoOpenBrowser: z.boolean(),
    // Off by default, so an MCP-launched player stops with the last MCP server using it.
    persistAfterMcpExit: z.boolean(),
    // Every device viewing the player uses this theme. Null leaves each device on its own setting.
    theme: z.enum(WEBUI_THEMES).nullable(),
    // Off also removes the mpv analysis filter, which uses about 2.5% of one core during playback.
    visualizer: z.boolean(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** No field has a schema default, so the compiler flags a mapper that omits one. */
export type RawConfigInput = z.input<typeof ConfigSchema>;
