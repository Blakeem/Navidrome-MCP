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