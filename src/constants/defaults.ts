/**
 * Navidrome MCP Server - Shared defaults
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Shared defaults and limits live here so every module that reads one sees the same value.
 */

export const DEFAULT_VALUES = {
  PLAYLISTS_LIMIT: 100,
  // search_all returns this many of each entity type into the LLM context, so it stays low.
  SEARCH_ALL_LIMIT: 15,
  PLAYLIST_TRACKS_LIMIT: 100,
  PLAY_QUEUE_LIMIT: 100,
  STARRED_ITEMS_LIMIT: 100,
  TOP_RATED_LIMIT: 100,
  RECENTLY_PLAYED_LIMIT: 100,
  MOST_PLAYED_LIMIT: 100,
  SIMILAR_ARTISTS_LIMIT: 100,
  SIMILAR_TRACKS_LIMIT: 100,
  TRENDING_MUSIC_LIMIT: 100,
  TAG_SEARCH_LIMIT: 100,
  TAG_DISTRIBUTION_LIMIT: 10,
  TAG_DISTRIBUTION_VALUES_LIMIT: 20,
  RADIO_DISCOVERY_LIMIT: 15,
  RADIO_DISCOVERY_PROBE_COUNT: 8, // bounds the probe fan-out, since hideBroken pre-screens the rest
} as const;

export const SUBSONIC_API_VERSION = '1.16.1';

/** The Subsonic `c` parameter. Servers attribute traffic by it, so it must not change. */
export const SUBSONIC_CLIENT_NAME = 'navidrome-mcp';

// Services attribute traffic by it and the settings form pre-fills it, so it carries no version
// that would change per release.
export const DEFAULT_USER_AGENT = 'Navidrome-MCP';

// MusicBrainz requires contact info in the User-Agent, so it carries the repo URL.
// It is unversioned for the same reason as DEFAULT_USER_AGENT.
export const DEFAULT_MUSICBRAINZ_USER_AGENT =
  'Navidrome-MCP (https://github.com/Blakeem/Navidrome-MCP)';

export const DEFAULT_LRCLIB_BASE = 'https://lrclib.net';

export const DEFAULT_TOKEN_EXPIRY_SECONDS = 86400;
export const DEFAULT_MCP_HTTP_PORT = 3000;
export const DEFAULT_WEBUI_PORT = 8808;
export const DEFAULT_TRANSCODE_FORMAT = 'raw';
export const DEFAULT_TRANSCODE_BITRATE = '192';

/** Request stride of `fetchPages`, the paging loop behind every queue read. It is not a row cap. */
export const QUEUE_READ_PAGE_SIZE = 500;

/**
 * Safety cap on the pages one `fetchPages` walk follows, against an inflated X-Total-Count.
 * An album-set read runs one walk per album chunk, so its total rows can exceed the cap.
 */
export const MAX_QUEUE_READ_PAGES = 20;

/** With no theme set, each device follows its own light or dark preference. */
export const WEBUI_THEMES = ['light', 'dark'] as const;
export type WebuiTheme = (typeof WEBUI_THEMES)[number];

// A hand-edited or unknown value reads as unset, so it never voids the settings store.
export function parseWebuiTheme(value: unknown): WebuiTheme | null {
  return WEBUI_THEMES.find((theme) => theme === value) ?? null;
}

/**
 * The web player probes and links 127.0.0.1, so only a bind that answers 127.0.0.1 works. localhost
 * and ::1 bind IPv6 loopback under Node's DNS order, and a specific interface skips loopback.
 */
export const WEBUI_BIND_HOSTS: readonly string[] = ['127.0.0.1', '0.0.0.0', '::'];

/**
 * `none` keeps the open remote. `password` puts every route behind an admin session. `jukebox` adds
 * guests, who join with a jukebox code and can only add songs.
 */
export const WEBUI_AUTH_MODES = ['none', 'password', 'jukebox'] as const;
export type WebuiAuthMode = (typeof WEBUI_AUTH_MODES)[number];

/** The request sources whose admin session the web player honors, from narrowest to widest. */
export const WEBUI_ADMIN_ACCESS_LEVELS = ['localhost', 'lan', 'anywhere'] as const;
export type WebuiAdminAccess = (typeof WEBUI_ADMIN_ACCESS_LEVELS)[number];

/** The bounds a new admin password must meet, shared by the settings page and the env fallback. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

export function isAdminPasswordLengthValid(password: string): boolean {
  return password.length >= ADMIN_PASSWORD_MIN_LENGTH && password.length <= ADMIN_PASSWORD_MAX_LENGTH;
}

/** 90 days, the longest jukebox code lifetime the admin can pick. It also sets the guest cookie lifetime. */
export const JUKEBOX_CODE_MAX_LIFETIME_HOURS = 2160;

/** How many unplayed songs one guest may hold in the queue at a time. The host sets it in the Guests dialog. */
export const DEFAULT_GUEST_QUEUE_LIMIT = 3;
export const GUEST_QUEUE_LIMIT_MIN = 1;
export const GUEST_QUEUE_LIMIT_MAX = 20;

/** Which join link the Jukebox dialog's QR shows. */
export const JUKEBOX_SHARE_LINKS = ['lan', 'internet'] as const;
export type JukeboxShareLink = (typeof JUKEBOX_SHARE_LINKS)[number];

/** An internet link reaches a guest on the home Wi-Fi only through router NAT loopback. */
export const DEFAULT_JUKEBOX_SHARE_LINK: JukeboxShareLink = 'lan';

// A hand-edited or unknown value reads as the default, so it never voids the settings store.
export function parseJukeboxShareLink(value: unknown): JukeboxShareLink {
  return JUKEBOX_SHARE_LINKS.find((link) => link === value) ?? DEFAULT_JUKEBOX_SHARE_LINK;
}
