/**
 * Unit Tests for Tools Registry - Tool Count Verification
 * 
 * Following UNIT-TEST-STRATEGY.md - tests tool registry to ensure
 * no tools go missing and all expected tools are registered.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { getSharedLiveClient } from '../../factories/mock-client.js';
import { loadConfig } from '../../../src/config.js';
import { ToolRegistry } from '../../../src/tools/handlers/registry.js';
import { shouldSkipLiveTests, getSkipReason } from '../../helpers/env-detection.js';

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
  'batch_add_tracks_to_playlist',

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

  // Queue category
  'get_queue',
  'set_queue',
  'clear_queue',
  'list_recently_played',
  'list_most_played',

  // Radio category (core radio management)
  'list_radio_stations',
  'create_radio_station',
  'delete_radio_station',
  'get_radio_station',
  'play_radio_station',
  'get_current_radio_info',
  'batch_create_radio_stations',
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

describe('Tools Registry - Tool Count Verification', () => {
  let liveClient: NavidromeClient;
  let config: Config;

  beforeAll(async () => {
    // For deterministic testing, always use a consistent configuration
    // This ensures we get consistent tool registration regardless of environment
    const originalEnv = { ...process.env };
    
    // Set deterministic environment for tool registry testing
    process.env.NAVIDROME_URL = 'http://deterministic-test:4533';
    process.env.NAVIDROME_USERNAME = 'test-user';
    process.env.NAVIDROME_PASSWORD = 'test-password';
    process.env.LASTFM_API_KEY = 'test-lastfm-key';
    process.env.RADIO_BROWSER_USER_AGENT = 'Test-Agent/1.0';
    process.env.LYRICS_PROVIDER = 'lrclib';
    
    try {
      // Load config with deterministic environment
      config = await loadConfig();
      
      // Always use mock client for deterministic tool registry testing
      // since we're using a fake URL for consistency
      const { createMockClient } = await import('../../factories/mock-client.js');
      liveClient = createMockClient() as any; // Tool registry only needs client interface for creation
      
      console.log(`Using deterministic configuration - Features: lastfm=${config.features.lastfm}, lyrics=${config.features.lyrics}, radioBrowser=${config.features.radioBrowser}`);
    } finally {
      // Restore original environment (except for variables we want to keep for consistency)
      Object.keys(originalEnv).forEach(key => {
        if (!['NAVIDROME_URL', 'NAVIDROME_USERNAME', 'NAVIDROME_PASSWORD', 'LASTFM_API_KEY', 'RADIO_BROWSER_USER_AGENT', 'LYRICS_PROVIDER'].includes(key)) {
          process.env[key] = originalEnv[key];
        }
      });
    }
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

      const allTools = registry.getAllTools();
      const actualToolNames = allTools.map(tool => tool.name);
      const uniqueNames = new Set(actualToolNames);
      const expectedToolNames = getExpectedToolList(config);

      // All tool names should be unique (no duplicates)
      expect(uniqueNames.size).toBe(actualToolNames.length);

      // Should exactly match expected tools for current configuration
      expect(actualToolNames.sort()).toEqual(expectedToolNames);
    });

    it('should report configuration state for debugging', async () => {
      // This test helps with debugging when tool registration doesn't match expectations
      console.log('Current feature configuration:');
      console.log(`- Last.fm enabled: ${config.features.lastfm}`);
      console.log(`- Radio Browser enabled: ${config.features.radioBrowser}`);
      console.log(`- Lyrics enabled: ${config.features.lyrics}`);

      const registry = new ToolRegistry();

      // Register all categories
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

      const allTools = registry.getAllTools();
      const expectedTools = getExpectedToolList(config);

      console.log(`Total tools registered: ${allTools.length}`);
      console.log(`Expected tools: ${expectedTools.length}`);
      console.log(`Core tools: ${EXPECTED_CORE_TOOLS.length}`);
      console.log(`Last.fm tools: ${config.features.lastfm ? EXPECTED_LASTFM_TOOLS.length : 0}`);
      console.log(`Lyrics tools: ${config.features.lyrics ? EXPECTED_LYRICS_TOOLS.length : 0}`);
      console.log(`Radio Browser tools: ${config.features.radioBrowser ? EXPECTED_RADIO_BROWSER_TOOLS.length : 0}`);

      // This test always passes - it's for informational purposes
      expect(allTools.length).toBeGreaterThan(0);
      expect(expectedTools.length).toBeGreaterThan(0);
    });
  });
});