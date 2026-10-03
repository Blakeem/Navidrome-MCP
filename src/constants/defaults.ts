/** Shared defaults and limits live here so every module that reads one sees the same value. */

export const DEFAULT_VALUES = {
  // Core list endpoints
  PLAYLISTS_LIMIT: 100,

  // Search endpoints
  SEARCH_ALL_LIMIT: 15, // for artistCount, albumCount, songCount in search_all - optimized for LLM context
  
  // Playlist endpoints
  PLAYLIST_TRACKS_LIMIT: 100,
  
  // Ratings and favorites
  STARRED_ITEMS_LIMIT: 100,
  TOP_RATED_LIMIT: 100,
  
  // Activity tracking
  RECENTLY_PLAYED_LIMIT: 100,
  MOST_PLAYED_LIMIT: 100,
  
  // External API integrations
  SIMILAR_ARTISTS_LIMIT: 100,
  SIMILAR_TRACKS_LIMIT: 100,
  TRENDING_MUSIC_LIMIT: 100,
  
  // Tag management
  TAG_SEARCH_LIMIT: 100,
  TAG_DISTRIBUTION_LIMIT: 10, // for analysis, keep reasonable
  TAG_DISTRIBUTION_VALUES_LIMIT: 20, // max values per tag
  
  // Radio discovery
  RADIO_DISCOVERY_LIMIT: 15, // optimal for discovery without overwhelming
  RADIO_DISCOVERY_PROBE_COUNT: 8, // bounds the probe fan-out, since hideBroken pre-screens the rest
} as const;

/**
 * Subsonic API protocol version we report when calling Subsonic-compatible endpoints.
 * Bump together across every Subsonic call site by editing this single constant.
 */
export const SUBSONIC_API_VERSION = '1.16.1';

/**
 * Subsonic API client identifier (the `c` parameter). Servers and access logs
 * use this to attribute traffic; keep it stable across releases.
 */
export const SUBSONIC_CLIENT_NAME = 'navidrome-mcp';

/**
 * Default User-Agent string used for outbound HTTP calls when no
 * service-specific override is configured (Radio Browser, LRCLIB, etc.).
 *
 * Intentionally carries NO version suffix: the value is a stable identifier
 * these services log to attribute traffic, not a build marker, and it doubles
 * as the pre-filled default in the settings form, so it shouldn't churn (or
 * need re-typing) on every release.
 */
export const DEFAULT_USER_AGENT = 'Navidrome-MCP';

/**
 * Default User-Agent for MusicBrainz calls when `musicBrainzUserAgent` is not
 * configured. MusicBrainz *requires* a meaningful User-Agent with contact info
 * (https://musicbrainz.org/doc/MusicBrainz_API, generic agents may be
 * blocked), hence the repo URL suffix that the plain DEFAULT_USER_AGENT lacks.
 * Like DEFAULT_USER_AGENT, intentionally unversioned: it doubles as the
 * settings-form suggestion and shouldn't churn on every release.
 */
export const DEFAULT_MUSICBRAINZ_USER_AGENT =
  'Navidrome-MCP (https://github.com/Blakeem/Navidrome-MCP)';

/**
 * Canonical LRCLIB endpoint. The single source for the lyrics base URL: the
 * settings-form default, the runtime schema default, and the blank-fallthrough
 * in map-config all resolve here.
 */
export const DEFAULT_LRCLIB_BASE = 'https://lrclib.net';

/** Config defaults shared by the runtime schema, the store projection and the form seed. */
export const DEFAULT_CACHE_TTL_SECONDS = 300;
export const DEFAULT_TOKEN_EXPIRY_SECONDS = 86400;
export const DEFAULT_MCP_HTTP_PORT = 3000;
export const DEFAULT_WEBUI_PORT = 8808;
export const DEFAULT_TRANSCODE_FORMAT = 'raw';
export const DEFAULT_TRANSCODE_BITRATE = '192';

/**
 * Per-request page size when `fetchPages` expands an album. It is a request
 * stride, not a track cap: pages repeat until X-Total-Count is reached.
 */
export const ALBUM_TRACKS_PAGE_SIZE = 500;

/**
 * Safety cap on the pages `fetchPages` follows before returning what it has.
 * It guards against an inconsistent X-Total-Count loop.
 */
export const MAX_ALBUM_PAGES = 20;
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
