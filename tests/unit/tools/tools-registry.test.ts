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
import { buildToolRegistry, type ToolRegistry } from '../../../src/tools/handlers/registry.js';
import { makeTestConfig } from '../../helpers/test-config.js';

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
  'list_tag_values',
  'get_tag_distribution',
  'get_filter_options',

  // Lyrics category (local file lyrics need no LRCLIB, so get_lyrics is core)
  'get_lyrics',
];

// Conditional tools based on feature flags
const EXPECTED_LASTFM_TOOLS = [
  'get_similar_artists',
  'get_similar_tracks',
  'get_artist_info',
  'get_top_tracks_by_artist',
  'get_trending_music',
  'get_artist_albums',
  'get_album_info',
];

// LRCLIB-gated half of the lyrics category
const EXPECTED_LYRICS_TOOLS = [
  'search_lyrics',
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
  'play_playlist',
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
  'play_queue_index',
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

  function withFeatures(features: Partial<Config['features']>): Config {
    return { ...config, features: { ...config.features, ...features } };
  }

  function toolNamesOf(registry: ToolRegistry): string[] {
    return registry.getAllTools().map(tool => tool.name);
  }

  describe('Tool Registration', () => {
    it('should register exactly the expected tools for current configuration', () => {
      const registry = buildToolRegistry(liveClient, config);

      const allTools = registry.getAllTools();
      const actualToolNames = allTools.map(t => t.name).sort();
      const expectedToolNames = getExpectedToolList(config);

      // Find missing and unexpected tools for detailed error reporting
      const missingTools = expectedToolNames.filter(name => !actualToolNames.includes(name));
      const unexpectedTools = actualToolNames.filter(name => !expectedToolNames.includes(name));

      // Log detailed comparison for debugging
      if (missingTools.length > 0 || unexpectedTools.length > 0) {
        console.error(`\nTool registration mismatch:`);
        console.error(`Features: lastfm=${config.features.lastfm}, lyrics=${config.features.lyrics}, radioBrowser=${config.features.radioBrowser}`);
        console.error(`Expected ${expectedToolNames.length} tools, got ${actualToolNames.length}`);

        if (missingTools.length > 0) {
          console.error(`Missing tools (${missingTools.length}):`, missingTools);
        }
        if (unexpectedTools.length > 0) {
          console.error(`Unexpected tools (${unexpectedTools.length}):`, unexpectedTools);
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
        expect(tool.description!.length).toBeGreaterThan(0);
      });
    });

    it('should register all core tools regardless of feature flags', () => {
      const coreOnly = withFeatures({ lastfm: false, radioBrowser: false, lyrics: false, playback: false });
      const actualToolNames = toolNamesOf(buildToolRegistry(liveClient, coreOnly));

      // Every core tool should be present
      const missingCoreTools = EXPECTED_CORE_TOOLS.filter(toolName => !actualToolNames.includes(toolName));

      if (missingCoreTools.length > 0) {
        console.error('Missing core tools:', missingCoreTools);
        console.error('Actual tools:', actualToolNames.sort());
      }

      expect(missingCoreTools).toEqual([]);
      expect(actualToolNames.sort()).toEqual(getExpectedToolList(coreOnly));
    });

    it.each([true, false])('should include Last.fm tools only when features.lastfm is %s', (lastfm) => {
      const actualToolNames = toolNamesOf(buildToolRegistry(liveClient, withFeatures({ lastfm })));

      // Validate Last.fm tools presence based on feature flag
      const actualLastFmTools = actualToolNames.filter(name => EXPECTED_LASTFM_TOOLS.includes(name));

      expect(actualLastFmTools).toEqual(lastfm ? EXPECTED_LASTFM_TOOLS : []);
    });

    it('should conditionally include lyrics tools based on feature flag', () => {
      const actualToolNames = toolNamesOf(buildToolRegistry(liveClient, config));

      // Validate LRCLIB-gated lyrics tools presence based on feature flag
      const actualLyricsTools = actualToolNames.filter(name => EXPECTED_LYRICS_TOOLS.includes(name));

      if (config.features.lyrics) {
        // When enabled, all LRCLIB-gated lyrics tools should be present
        expect(actualLyricsTools).toEqual(EXPECTED_LYRICS_TOOLS);
      } else {
        // When disabled, only the LRCLIB-gated tools drop out
        expect(actualLyricsTools).toEqual([]);
      }

      // get_lyrics reads the lyrics stored in the audio file, so it is present
      // either way.
      expect(actualToolNames).toContain('get_lyrics');
    });

    it('should register the lyrics category when LRCLIB is disabled', () => {
      const localOnlyConfig = makeTestConfig({
        features: { lastfm: false, radioBrowser: false, lyrics: false, playback: false },
      });

      const actualToolNames = toolNamesOf(buildToolRegistry(liveClient, localOnlyConfig));

      expect(actualToolNames).toContain('get_lyrics');
      expect(actualToolNames.filter(name => EXPECTED_LYRICS_TOOLS.includes(name))).toEqual([]);
    });

    it.each([false, true])('should have unique tool names and match expected configuration (playback %s)', (playback) => {
      const variant = withFeatures({ playback });
      const actualToolNames = toolNamesOf(buildToolRegistry(liveClient, variant));
      const uniqueNames = new Set(actualToolNames);
      const expectedToolNames = getExpectedToolList(variant);

      // All tool names should be unique (no duplicates)
      expect(uniqueNames.size).toBe(actualToolNames.length);

      // Should exactly match expected tools for current configuration
      expect(actualToolNames.sort()).toEqual(expectedToolNames);
    });

    it('rejects a category that registers an already-registered tool name', () => {
      const registry = buildToolRegistry(liveClient, config);
      const duplicate = { tools: [{ name: 'get_song', inputSchema: { type: 'object' as const } }], handleToolCall: () => Promise.resolve(null) };

      expect(() => registry.register(duplicate)).toThrow(/get_song/);
    });

  });
});