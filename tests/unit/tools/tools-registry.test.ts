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

// Import category factory functions to count tools directly
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

// EXPECTED TOOL COUNT - Update this when adding new tools
// Current count: 57 tools (as of schema consolidation completion)
// This includes all tools when all features are enabled:
// - Core tools: test, library, playlist, search, user preferences, queue, radio, tags
// - Conditional tools: lastfm (when LASTFM_API_KEY provided), lyrics (when LYRICS_PROVIDER provided)
const EXPECTED_TOOL_COUNT_ALL_FEATURES = 57;

// Expected count with minimal features (no external APIs) - CI environment  
const EXPECTED_TOOL_COUNT_MINIMAL = 46; // Core tools only (no Last.fm, lyrics, or radio browser discovery)

// Expected count with standard local environment (.env with some features)
const EXPECTED_TOOL_COUNT_STANDARD = 51; // Some features enabled

describe('Tools Registry - Tool Count Verification', () => {
  let liveClient: NavidromeClient;
  let config: Config;

  beforeAll(async () => {
    // Load config for registry testing
    config = await loadConfig();
    
    if (shouldSkipLiveTests()) {
      console.log(`Skipping live tests: ${getSkipReason()}`);
      // Create a mock client for tool registration in CI
      const { createMockClient } = await import('../../factories/mock-client.js');
      liveClient = createMockClient() as any; // Tool registry only needs client interface for creation
      return;
    }
    // Use shared client for live testing
    liveClient = await getSharedLiveClient();
  });

  describe('Tool Registration', () => {
    it('should register expected number of tools with current configuration', async () => {
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

      // Calculate expected count dynamically based on actual feature configuration
      let expectedCount = EXPECTED_TOOL_COUNT_MINIMAL; // Base core tools (46)
      
      if (config.features.lastfm) {
        expectedCount += 7; // Last.fm tools: get_similar_artists, get_similar_tracks, get_artist_info, get_top_tracks_by_artist, get_trending_music
      }
      
      if (config.features.lyrics) {
        expectedCount += 1; // Lyrics tool: get_lyrics
      }

      if (config.features.radioBrowser) {
        expectedCount += 3; // Radio Browser discovery tools (discover, validate, get_filters)
      }

      // Log actual vs expected for debugging
      if (allTools.length !== expectedCount) {
        console.log(`Tool count mismatch: expected ${expectedCount}, got ${allTools.length}`);
        console.log(`Features: lastfm=${config.features.lastfm}, lyrics=${config.features.lyrics}, radioBrowser=${config.features.radioBrowser}`);
        console.log('Available tools:', allTools.map(t => t.name).sort());
      }

      expect(allTools.length).toBe(expectedCount);

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

    it('should register core tools regardless of feature flags', async () => {
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
      const toolNames = allTools.map(tool => tool.name);

      // Core tools that should always be present
      const coreToolPatterns = [
        'test_connection',        // Test category
        'list_songs',             // Library category
        'list_playlists',         // Playlist category
        'search_all',             // Search category
        'star_item',              // User preferences category
        'get_queue',              // Queue category
        'list_radio_stations',    // Radio category
        'list_tags',              // Tags category
      ];

      coreToolPatterns.forEach(toolPattern => {
        expect(toolNames).toContain(toolPattern);
      });

      // Should have at least the minimum number of tools
      expect(allTools.length).toBeGreaterThanOrEqual(EXPECTED_TOOL_COUNT_MINIMAL);
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
      const toolNames = allTools.map(tool => tool.name);

      // Last.fm tools that should be present only when enabled
      const lastfmTools = [
        'get_similar_artists',
        'get_similar_tracks',
        'get_artist_info',
        'get_top_tracks_by_artist',
        'get_trending_music'
      ];

      if (config.features.lastfm) {
        lastfmTools.forEach(tool => {
          expect(toolNames).toContain(tool);
        });
      } else {
        lastfmTools.forEach(tool => {
          expect(toolNames).not.toContain(tool);
        });
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
      const toolNames = allTools.map(tool => tool.name);

      // Lyrics tools
      const lyricsTools = ['get_lyrics'];

      if (config.features.lyrics) {
        lyricsTools.forEach(tool => {
          expect(toolNames).toContain(tool);
        });
      } else {
        lyricsTools.forEach(tool => {
          expect(toolNames).not.toContain(tool);
        });
      }
    });

    it('should have unique tool names', async () => {
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
      const toolNames = allTools.map(tool => tool.name);
      const uniqueNames = new Set(toolNames);

      // All tool names should be unique
      expect(uniqueNames.size).toBe(toolNames.length);
      
      // Should have expected count for current configuration  
      let expectedCount = EXPECTED_TOOL_COUNT_MINIMAL; // Base core tools (46)
      if (config.features.lastfm) expectedCount += 7;
      if (config.features.lyrics) expectedCount += 1;
      if (config.features.radioBrowser) expectedCount += 3;
      
      expect(toolNames.length).toBe(expectedCount);
    });

    it('should report configuration state for debugging', async () => {
      // This test helps with debugging when tool counts don't match expectations
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
      console.log(`Total tools registered: ${allTools.length}`);
      
      // This test always passes - it's for informational purposes
      expect(allTools.length).toBeGreaterThan(0);
    });
  });
});