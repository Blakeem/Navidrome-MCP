/**
 * Unit Tests for Tools Registry - Tool Count Verification
 * 
 * Following UNIT-TEST-STRATEGY.md - tests tool registry to ensure
 * no tools go missing and all expected tools are registered.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { logger } from '../../../src/utils/logger.js';
import { ToolRegistry } from '../../../src/tools/handlers/registry.js';
import { makeTestConfig } from '../../helpers/test-config.js';

// Import category factory functions for comprehensive tool validation
import { createTestToolCategory } from '../../../src/tools/test.js';
import { createLibraryToolCategory } from '../../../src/tools/library.js';
import { createPlaylistToolCategory } from '../../../src/tools/handlers/playlist-handlers.js';
import { createSearchToolCategory } from '../../../src/tools/handlers/search-handlers.js';
import { createUserPreferencesToolCategory } from '../../../src/tools/handlers/user-preferences-handlers.js';
import { createQueueToolCategory } from '../../../src/tools/handlers/queue-handlers.js';
import { createRadioToolCategory } from '../../../src/tools/handlers/radio-handlers.js';
import { createLastFmToolCategory } from '../../../src/tools/handlers/lastfm-handlers.js';
import { createLyricsToolCategory } from '../../../src/tools/handlers/lyrics-handlers.js';
import { createTagsToolCategory } from '../../../src/tools/handlers/tag-handlers.js';
import { createPlaybackToolCategory } from '../../../src/tools/handlers/playback-handlers.js';

// COMPREHENSIVE EXPECTED TOOL LIST - Update this when adding/removing tools
// This replaces count-based testing with explicit validation

// Core tools that should ALWAYS be present (regardless of feature flags)
const EXPECTED_CORE_TOOLS = [
  // Test category
  'test_connection',

  // Library category
  'get_song',
  'get_album',
  'get_artist',
  'get_song_playlists',
  'get_user_details',
  'set_active_libraries',

  // Playlist category
  'list_playlists',
  'get_playlist',
  'create_playlist',
  'update_playlist',
  'delete_playlist',
  'get_playlist_tracks',
  'add_tracks_to_playlist',
  'remove_tracks_from_playlist',
  'reorder_playlist_track',

  // Search category
  'search_all',
  'search_songs',
  'search_albums',
  'search_artists',

  // User preferences category
  'star_item',
  'unstar_item',
  'set_rating',
  'list_starred_items',
  'list_top_rated',

  // Queue category (saved queue = Navidrome cross-device sync)
  'get_saved_queue',
  'save_queue',
  'clear_saved_queue',
  'list_recently_played',
  'list_most_played',

  // Radio category (core radio management) - UPDATED: removed batch_create_radio_stations after consolidation
  // play_radio_station is gated on playback (mpv) feature — see EXPECTED_PLAYBACK_TOOLS
  'list_radio_stations',
  'create_radio_station',
  'delete_radio_station',
  'get_radio_station',
  'validate_radio_stream',

  // Tags category
  'search_by_tags',
  'get_tag_distribution',
  'get_filter_options',
];

// Conditional tools based on feature flags
const EXPECTED_LASTFM_TOOLS = [
  'get_similar_artists',
  'get_similar_tracks',
  'get_artist_info',
  'get_top_tracks_by_artist',
  'get_trending_music',
];

const EXPECTED_LYRICS_TOOLS = [
  'get_lyrics',
];

const EXPECTED_RADIO_BROWSER_TOOLS = [
  'discover_radio_stations',
  'get_radio_filters',
  'get_station_by_uuid',
  'click_station',
  'vote_station',
];

const EXPECTED_PLAYBACK_TOOLS = [
  'pause',
  'resume',
  'set_volume',
  'playback_status',
  'play_songs',
  'play_albums',
  'play_albums_search',
  'play_songs_search',
  'play_radio_station',
  'next',
  'previous',
  'seek',
  'now_playing',
  'get_play_queue',
  'clear_play_queue',
  'shuffle_play_queue',
  'move_in_play_queue',
  'remove_from_play_queue',
];

describe('Tools Registry - Tool Count Verification', () => {
  let liveClient: NavidromeClient;
  let config: Config;

  beforeAll(async () => {
    // Build a deterministic Config directly (no store/env resolution) so this
    // test is independent of the developer's real settings and of whether mpv
    // is installed. Mirrors the original intent: optional discovery features
    // enabled, playback disabled (the playback tool set is exercised by the
    // playback integration suite).
    config = makeTestConfig({
      features: { lastfm: true, radioBrowser: true, lyrics: true, playback: false },
      lastFmApiKey: 'test-lastfm-key',
      radioBrowserUserAgent: 'Test-Agent/1.0',
      lyricsProvider: 'lrclib',
      lrclibUserAgent: 'Test-Agent/1.0',
    });

    // Always use mock client for deterministic tool registry testing
    // since we're using a fake URL for consistency
    const { createMockClient } = await import('../../factories/mock-client.js');
    liveClient = createMockClient() as any; // Tool registry only needs client interface for creation

    logger.debug(`Using deterministic configuration - Features: lastfm=${config.features.lastfm}, lyrics=${config.features.lyrics}, radioBrowser=${config.features.radioBrowser}, playback=${config.features.playback}`);
  });

  // Helper function to build expected tool list based on feature configuration
  function getExpectedToolList(config: Config): string[] {
    const expectedTools = [...EXPECTED_CORE_TOOLS];

    if (config.features.lastfm) {
      expectedTools.push(...EXPECTED_LASTFM_TOOLS);
    }

    if (config.features.lyrics) {
      expectedTools.push(...EXPECTED_LYRICS_TOOLS);
    }

    if (config.features.radioBrowser) {
      expectedTools.push(...EXPECTED_RADIO_BROWSER_TOOLS);
    }

    if (config.features.playback) {
      expectedTools.push(...EXPECTED_PLAYBACK_TOOLS);
    }

    return expectedTools.sort();
  }

  describe('Tool Registration', () => {
    it('should register exactly the expected tools for current configuration', async () => {
      // Create registry and register all categories
      const registry = new ToolRegistry();

      // Register core categories (always present)
      registry.register('test', createTestToolCategory(liveClient, config));
      registry.register('library', createLibraryToolCategory(liveClient, config));
      registry.register('playlist-management', createPlaylistToolCategory(liveClient, config));
      registry.register('search', createSearchToolCategory(liveClient, config));
      registry.register('user-preferences', createUserPreferencesToolCategory(liveClient, config));
      registry.register('queue-management', createQueueToolCategory(liveClient, config));
      registry.register('radio', createRadioToolCategory(liveClient, config));
      registry.register('tags', createTagsToolCategory(liveClient, config));

      // Add conditional tools based on configuration
      if (config.features.lastfm) {
        registry.register('lastfm-discovery', createLastFmToolCategory(liveClient, config));
      }

      if (config.features.lyrics) {
        registry.register('lyrics', createLyricsToolCategory(liveClient, config));
      }

      if (config.features.playback) {
        registry.register('playback', createPlaybackToolCategory(liveClient, config));
      }

      const allTools = registry.getAllTools();
      const actualToolNames = allTools.map(t => t.name).sort();
      const expectedToolNames = getExpectedToolList(config);

      // Find missing and unexpected tools for detailed error reporting
      const missingTools = expectedToolNames.filter(name => !actualToolNames.includes(name));
      const unexpectedTools = actualToolNames.filter(name => !expectedToolNames.includes(name));

      // Log detailed comparison for debugging
      if (missingTools.length > 0 || unexpectedTools.length > 0) {
        console.log(`\nTool registration mismatch:`);
        console.log(`Features: lastfm=${config.features.lastfm}, lyrics=${config.features.lyrics}, radioBrowser=${config.features.radioBrowser}`);
        console.log(`Expected ${expectedToolNames.length} tools, got ${actualToolNames.length}`);

        if (missingTools.length > 0) {
          console.log(`Missing tools (${missingTools.length}):`, missingTools);
        }
        if (unexpectedTools.length > 0) {
          console.log(`Unexpected tools (${unexpectedTools.length}):`, unexpectedTools);
        }
      }

      // Assert exact match - no missing tools, no unexpected tools
      expect(missingTools).toEqual([]);
      expect(unexpectedTools).toEqual([]);
      expect(actualToolNames).toEqual(expectedToolNames);

      // Verify all tools have required properties
      allTools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
      });
    });

    it('should register all core tools regardless of feature flags', async () => {
      // Create registry with only core categories (no conditional features)
      const registry = new ToolRegistry();

      registry.register('test', createTestToolCategory(liveClient, config));
      registry.register('library', createLibraryToolCategory(liveClient, config));
      registry.register('playlist-management', createPlaylistToolCategory(liveClient, config));
      registry.register('search', createSearchToolCategory(liveClient, config));
      registry.register('user-preferences', createUserPreferencesToolCategory(liveClient, config));
      registry.register('queue-management', createQueueToolCategory(liveClient, config));
      registry.register('radio', createRadioToolCategory(liveClient, config));
      registry.register('tags', createTagsToolCategory(liveClient, config));

      const allTools = registry.getAllTools();
      const actualToolNames = allTools.map(tool => tool.name);

      // Every core tool should be present
      const missingCoreTools = EXPECTED_CORE_TOOLS.filter(toolName => !actualToolNames.includes(toolName));

      if (missingCoreTools.length > 0) {
        console.log('Missing core tools:', missingCoreTools);
        console.log('Actual tools:', actualToolNames.sort());
      }

      expect(missingCoreTools).toEqual([]);

      // Should have at least all core tools (may have conditional tools if feature flags are enabled)
      expect(actualToolNames.length).toBeGreaterThanOrEqual(EXPECTED_CORE_TOOLS.length);
    });

    it('should conditionally include Last.fm tools based on feature flag', async () => {
      const registry = new ToolRegistry();

      // Register core categories
      registry.register('test', createTestToolCategory(liveClient, config));
      registry.register('library', createLibraryToolCategory(liveClient, config));
      registry.register('playlist-management', createPlaylistToolCategory(liveClient, config));
      registry.register('search', createSearchToolCategory(liveClient, config));
      registry.register('user-preferences', createUserPreferencesToolCategory(liveClient, config));
      registry.register('queue-management', createQueueToolCategory(liveClient, config));
      registry.register('radio', createRadioToolCategory(liveClient, config));
      registry.register('tags', createTagsToolCategory(liveClient, config));

      // Conditionally add Last.fm based on config
      if (config.features.lastfm) {
        registry.register('lastfm-discovery', createLastFmToolCategory(liveClient, config));
      }

      const allTools = registry.getAllTools();
      const actualToolNames = allTools.map(tool => tool.name);

      // Validate Last.fm tools presence based on feature flag
      const actualLastFmTools = actualToolNames.filter(name => EXPECTED_LASTFM_TOOLS.includes(name));
      const missingLastFmTools = EXPECTED_LASTFM_TOOLS.filter(name => !actualToolNames.includes(name));
      const unexpectedLastFmTools = actualLastFmTools.filter(name => !EXPECTED_LASTFM_TOOLS.includes(name));

      if (config.features.lastfm) {
        // When enabled, all Last.fm tools should be present
        expect(missingLastFmTools).toEqual([]);
        expect(actualLastFmTools).toEqual(EXPECTED_LASTFM_TOOLS);
      } else {
        // When disabled, no Last.fm tools should be present
        expect(actualLastFmTools).toEqual([]);
      }
    });

    it('should conditionally include lyrics tools based on feature flag', async () => {
      const registry = new ToolRegistry();

      // Register core categories
      registry.register('test', createTestToolCategory(liveClient, config));
      registry.register('library', createLibraryToolCategory(liveClient, config));
      registry.register('playlist-management', createPlaylistToolCategory(liveClient, config));
      registry.register('search', createSearchToolCategory(liveClient, config));
      registry.register('user-preferences', createUserPreferencesToolCategory(liveClient, config));
      registry.register('queue-management', createQueueToolCategory(liveClient, config));
      registry.register('radio', createRadioToolCategory(liveClient, config));
      registry.register('tags', createTagsToolCategory(liveClient, config));

      // Conditionally add lyrics based on config
      if (config.features.lyrics) {
        registry.register('lyrics', createLyricsToolCategory(liveClient, config));
      }

      if (config.features.playback) {
        registry.register('playback', createPlaybackToolCategory(liveClient, config));
      }

      const allTools = registry.getAllTools();
      const actualToolNames = allTools.map(tool => tool.name);

      // Validate lyrics tools presence based on feature flag
      const actualLyricsTools = actualToolNames.filter(name => EXPECTED_LYRICS_TOOLS.includes(name));

      if (config.features.lyrics) {
        // When enabled, all lyrics tools should be present
        expect(actualLyricsTools).toEqual(EXPECTED_LYRICS_TOOLS);
      } else {
        // When disabled, no lyrics tools should be present
        expect(actualLyricsTools).toEqual([]);
      }
    });

    it('should have unique tool names and match expected configuration', async () => {
      // Create registry with all possible tools
      const registry = new ToolRegistry();

      registry.register('test', createTestToolCategory(liveClient, config));
      registry.register('library', createLibraryToolCategory(liveClient, config));
      registry.register('playlist-management', createPlaylistToolCategory(liveClient, config));
      registry.register('search', createSearchToolCategory(liveClient, config));
      registry.register('user-preferences', createUserPreferencesToolCategory(liveClient, config));
      registry.register('queue-management', createQueueToolCategory(liveClient, config));
      registry.register('radio', createRadioToolCategory(liveClient, config));
      registry.register('tags', createTagsToolCategory(liveClient, config));

      if (config.features.lastfm) {
        registry.register('lastfm-discovery', createLastFmToolCategory(liveClient, config));
      }

      if (config.features.lyrics) {
        registry.register('lyrics', createLyricsToolCategory(liveClient, config));
      }

      if (config.features.playback) {
        registry.register('playback', createPlaybackToolCategory(liveClient, config));
      }

      const allTools = registry.getAllTools();
      const actualToolNames = allTools.map(tool => tool.name);
      const uniqueNames = new Set(actualToolNames);
      const expectedToolNames = getExpectedToolList(config);

      // All tool names should be unique (no duplicates)
      expect(uniqueNames.size).toBe(actualToolNames.length);

      // Should exactly match expected tools for current configuration
      expect(actualToolNames.sort()).toEqual(expectedToolNames);
    });

  });
});