/**
 * Navidrome MCP Server - Configuration Schema
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod';
import {
  GUEST_QUEUE_LIMIT_MAX,
  GUEST_QUEUE_LIMIT_MIN,
  JUKEBOX_SHARE_LINKS,
  WEBUI_ADMIN_ACCESS_LEVELS,
  WEBUI_AUTH_MODES,
  WEBUI_THEMES,
} from '../constants/defaults.js';

const GUEST_QUEUE_LIMIT_ERROR =
  `Must be a whole number from ${String(GUEST_QUEUE_LIMIT_MIN)} to ${String(GUEST_QUEUE_LIMIT_MAX)}`;

/** The jukebox join links append `/guest` to this base, so a path, query or credential would break them. */
function isWebuiPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

interface WebuiPublicUrlInput {
  publicUrl: string | null;
  tls: { certPath: string | null };
}

/**
 * A guest browser opens the join link with the URL's scheme, so it must match what the listener serves.
 * Zod runs this even after the field check failed, so an unparseable URL is left to that check.
 */
function publicUrlMatchesTls(webui: WebuiPublicUrlInput): boolean {
  if (webui.publicUrl === null || !URL.canParse(webui.publicUrl)) return true;
  const servesHttps = webui.tls.certPath !== null;
  return (new URL(webui.publicUrl).protocol === 'https:') === servesHttps;
}

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
    // The address guests reach from the internet, such as a DDNS name behind a router port forward.
    // Its host passes the LAN-bind host gate, and the Jukebox dialog offers a join link for it.
    publicUrl: z.string().refine(isWebuiPublicUrl, {
      message: 'Must be an http:// or https:// URL with no path, such as https://jukebox.example.org:8808',
    }).nullable(),
    // Off by default so a headless MCP client launch never pops a browser tab.
    autoOpenBrowser: z.boolean(),
    // Off by default, so an MCP-launched player stops with the last MCP server using it.
    persistAfterMcpExit: z.boolean(),
    // Every device viewing the player uses this theme. Null leaves each device on its own setting.
    theme: z.enum(WEBUI_THEMES).nullable(),
    // Off also removes the mpv analysis filter, which uses about 2.5% of one core during playback.
    visualizer: z.boolean(),
    // The web player serves HTTPS with this PEM pair, and plain HTTP when both paths are null.
    tls: z.object({
      certPath: z.string().nullable(),
      keyPath: z.string().nullable(),
    }).refine((tls) => (tls.certPath === null) === (tls.keyPath === null), {
      message: 'Set both certPath and keyPath to serve HTTPS, or neither to serve HTTP.',
    }),
    // A null hash in a mode with a login is valid, since the env fallback supplies the password apart
    // from the store and the login route answers 503 while neither source holds one.
    auth: z.object({
      mode: z.enum(WEBUI_AUTH_MODES),
      adminPasswordHash: z.string().nullable(),
      adminAccess: z.enum(WEBUI_ADMIN_ACCESS_LEVELS),
    }),
  }).refine(publicUrlMatchesTls, {
    path: ['publicUrl'],
    message: 'Must start with https:// when the HTTPS certificate and key are set, and with http:// when they are not.',
  }),

  // The web player reads these at startup, and the admin's jukebox dialogs change them while the player runs.
  jukebox: z.object({
    guestQueueLimit: z.number()
      .int({ error: GUEST_QUEUE_LIMIT_ERROR })
      .min(GUEST_QUEUE_LIMIT_MIN, { error: GUEST_QUEUE_LIMIT_ERROR })
      .max(GUEST_QUEUE_LIMIT_MAX, { error: GUEST_QUEUE_LIMIT_ERROR }),
    shareLink: z.enum(JUKEBOX_SHARE_LINKS),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** No field has a schema default, so the compiler flags a mapper that omits one. */
export type RawConfigInput = z.input<typeof ConfigSchema>;
