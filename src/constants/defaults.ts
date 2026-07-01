/**
 * Default record counts for MCP server endpoints
 * 
 * Centralized configuration for default result limits to make them easy to adjust.
 * Higher defaults (100 instead of 20) help prevent missing results when building playlists or searching.
 */

export const DEFAULT_VALUES = {
  // Core list endpoints - increased from 20 to 100 to avoid missing results
  SONGS_LIMIT: 100,
  ALBUMS_LIMIT: 100,
  PLAYLISTS_LIMIT: 100,
  
  // Search endpoints - increased from 20 to 100 for better search coverage
  SEARCH_LIMIT: 100,
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
  TOP_TRACKS_BY_ARTIST_LIMIT: 100,
  TRENDING_MUSIC_LIMIT: 100,
  
  // Tag management
  TAGS_LIMIT: 100,
  TAG_SEARCH_LIMIT: 100,
  TAG_DISTRIBUTION_LIMIT: 10, // for analysis, keep reasonable
  TAG_DISTRIBUTION_VALUES_LIMIT: 20, // max values per tag
  UNIQUE_TAGS_LIMIT: 100,
  
  // Radio discovery
  RADIO_DISCOVERY_LIMIT: 15, // optimal for discovery without overwhelming
} as const;

/**
 * Upper cap on how many tag values `getTagDistribution` fetches per tag name
 * (the `_end` of the per-`tagName` `/tag` query). The response only surfaces
 * the top `distributionLimit` values, so fetching far more is wasted work —
 * we derive `_end` from `distributionLimit` and clamp it to this ceiling so a
 * pathological `distributionLimit` can't request an unbounded page.
 */
export const TAG_DISTRIBUTION_FETCH_CAP = 200;

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
 * as the pre-filled default in the settings form — so it shouldn't churn (or
 * need re-typing) on every release.
 */
export const DEFAULT_USER_AGENT = 'Navidrome-MCP';

/**
 * Default User-Agent for MusicBrainz calls when `musicBrainzUserAgent` is not
 * configured. MusicBrainz *requires* a meaningful User-Agent with contact info
 * (https://musicbrainz.org/doc/MusicBrainz_API — generic agents may be
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

/**
 * Per-page size when expanding `play_albums` / `play_albums_search` requests.
 * `fetchAlbumTrackIds` paginates with this page size and follows X-Total-Count
 * until the full track list is fetched, so multi-disc boxsets play through
 * completely instead of truncating at the first 500 tracks.
 */
export const MAX_ALBUM_TRACKS = 500;

/**
 * Safety cap on the number of pages `fetchAlbumTrackIds` will follow before
 * giving up and returning what it has. Protects against an inconsistent
 * X-Total-Count loop. 20 × 500 = 10000 tracks per album is well past any
 * realistic release, including the "complete works" boxsets the original
 * 500-track ceiling used to silently truncate.
 */
export const MAX_ALBUM_PAGES = 20;