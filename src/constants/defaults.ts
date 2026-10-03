/** Shared defaults and limits live here so every module that reads one sees the same value. */

export const DEFAULT_VALUES = {
  PLAYLISTS_LIMIT: 100,
  // search_all returns this many of each entity type into the LLM context.
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

/**
 * Subsonic API client identifier (the `c` parameter). Servers and access logs
 * use this to attribute traffic. Keep it stable across releases.
 */
export const SUBSONIC_CLIENT_NAME = 'navidrome-mcp';

// Unversioned because services attribute traffic by it and the settings form pre-fills it,
// so it must not churn per release.
export const DEFAULT_USER_AGENT = 'Navidrome-MCP';

// MusicBrainz requires a User-Agent with contact info (https://musicbrainz.org/doc/MusicBrainz_API),
// hence the repo URL. Unversioned for the same reason as DEFAULT_USER_AGENT.
export const DEFAULT_MUSICBRAINZ_USER_AGENT =
  'Navidrome-MCP (https://github.com/Blakeem/Navidrome-MCP)';

/**
 * Canonical LRCLIB endpoint. The single source for the lyrics base URL: the
 * settings-form default and the blank-fallthrough in map-config both resolve here.
 */
export const DEFAULT_LRCLIB_BASE = 'https://lrclib.net';

/** Config defaults shared by the store projection and the form seed. */
export const DEFAULT_TOKEN_EXPIRY_SECONDS = 86400;
export const DEFAULT_MCP_HTTP_PORT = 3000;
export const DEFAULT_WEBUI_PORT = 8808;
export const DEFAULT_TRANSCODE_FORMAT = 'raw';
export const DEFAULT_TRANSCODE_BITRATE = '192';

/**
 * Per-request page size of `fetchPages`, the paging loop behind every queue read (album, playlist,
 * starred songs, starred albums). It is a request stride, not a row cap.
 */
export const QUEUE_READ_PAGE_SIZE = 500;

/**
 * Safety cap on the pages `fetchPages` follows, against an inconsistent X-Total-Count loop.
 * It bounds each queue read at QUEUE_READ_PAGE_SIZE x MAX_QUEUE_READ_PAGES rows.
 */
export const MAX_QUEUE_READ_PAGES = 20;

/** The web remote's color themes. With none set, each device follows its own light or dark preference. */
export const WEBUI_THEMES = ['light', 'dark'] as const;
export type WebuiTheme = (typeof WEBUI_THEMES)[number];

// A hand-edited or legacy value reads as unset, so it never voids the settings store.
export function parseWebuiTheme(value: unknown): WebuiTheme | null {
  return WEBUI_THEMES.find((theme) => theme === value) ?? null;
}

/**
 * The web player probes and links 127.0.0.1, so only a bind that answers 127.0.0.1 works.
 * localhost and ::1 bind IPv6 loopback under Node's DNS order, and a specific interface skips loopback.
 */
export const WEBUI_BIND_HOSTS: readonly string[] = ['127.0.0.1', '0.0.0.0', '::'];
