/**
 * Unit Tests for Test Connection Tool - Live Connection Testing
 * 
 * Following UNIT-TEST-STRATEGY.md - tests live connection to validate
 * server connectivity and feature detection capabilities.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { createLiveClient } from '../../factories/mock-client.js';
import { testConnection } from '../../../src/tools/test.js';
import { loadConfig } from '../../../src/config.js';

describe('Test Connection Tool - Live Connection Testing', () => {
  let liveClient: NavidromeClient;
  let config: Config;

  beforeAll(async () => {
    // Create live client and config for connection testing
    config = await loadConfig();
    liveClient = await createLiveClient();
  });

  describe('testConnection', () => {
    it('should successfully connect to live Navidrome server', async () => {
      const result = await testConnection(liveClient, config, { includeServerInfo: false });

      // Validate basic connection response structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      
      // Connection should be successful
      expect(result.success).toBe(true);
      expect(typeof result.message).toBe('string');
      expect(result.message).toMatch(/successfully connected/i);
    });

    it('should return detailed server info when requested', async () => {
      const result = await testConnection(liveClient, config, { includeServerInfo: true });

      // Validate detailed response structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('serverInfo');
      
      // Connection should be successful
      expect(result.success).toBe(true);
      expect(typeof result.message).toBe('string');

      // Validate server info structure
      const serverInfo = result.serverInfo;
      expect(serverInfo).toHaveProperty('url');
      expect(serverInfo).toHaveProperty('authenticated');
      expect(serverInfo).toHaveProperty('timestamp');
      expect(serverInfo).toHaveProperty('features');
      
      // URL should be a string
      expect(typeof serverInfo.url).toBe('string');
      expect(serverInfo.url.length).toBeGreaterThan(0);
      
      // Authenticated should be boolean
      expect(typeof serverInfo.authenticated).toBe('boolean');
      expect(serverInfo.authenticated).toBe(true);

      // Features should be an object with detailed information
      const features = serverInfo.features;
      expect(typeof features).toBe('object');
      expect(features).not.toBeNull();
      
      // Feature detection - these should have enabled flags
      expect(features.lastfm).toHaveProperty('enabled');
      expect(features.lastfm).toHaveProperty('description');
      expect(features.lastfm).toHaveProperty('tools');
      expect(typeof features.lastfm.enabled).toBe('boolean');
      
      expect(features.radioBrowser).toHaveProperty('enabled');
      expect(features.radioBrowser).toHaveProperty('description');
      expect(features.radioBrowser).toHaveProperty('tools');
      expect(typeof features.radioBrowser.enabled).toBe('boolean');
      
      expect(features.lyrics).toHaveProperty('enabled');
      expect(features.lyrics).toHaveProperty('description');
      expect(features.lyrics).toHaveProperty('tools');
      expect(typeof features.lyrics.enabled).toBe('boolean');

      // Timestamp should be valid ISO string
      expect(typeof serverInfo.timestamp).toBe('string');
      expect(() => new Date(serverInfo.timestamp)).not.toThrow();
      
      // Tools arrays should exist and be arrays
      expect(Array.isArray(features.lastfm.tools)).toBe(true);
      expect(Array.isArray(features.radioBrowser.tools)).toBe(true);
      expect(Array.isArray(features.lyrics.tools)).toBe(true);
    });

    it('should detect enabled features correctly based on environment', async () => {
      const result = await testConnection(liveClient, config, { includeServerInfo: true });
      
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('serverInfo');
      
      const features = result.serverInfo.features;
      
      // Verify feature detection matches config
      // These should match what's actually configured in the environment
      if (process.env.LASTFM_API_KEY) {
        expect(features.lastfm.enabled).toBe(true);
        expect(features.lastfm.tools.length).toBeGreaterThan(0);
      } else {
        expect(features.lastfm.enabled).toBe(false);
        expect(features.lastfm.tools.length).toBe(0);
      }
      
      if (process.env.RADIO_BROWSER_USER_AGENT) {
        expect(features.radioBrowser.enabled).toBe(true);
        expect(features.radioBrowser.tools.length).toBeGreaterThan(0);
      } else {
        expect(features.radioBrowser.enabled).toBe(false);
        expect(features.radioBrowser.tools.length).toBe(0);
      }
      
      if (process.env.LYRICS_PROVIDER) {
        expect(features.lyrics.enabled).toBe(true);
        expect(features.lyrics.tools.length).toBeGreaterThan(0);
      } else {
        expect(features.lyrics.enabled).toBe(false);
        expect(features.lyrics.tools.length).toBe(0);
      }
    });

    it('should handle connection with default parameters', async () => {
      // Test without explicit parameters (should default to includeServerInfo: false)
      const result = await testConnection(liveClient, config, {});

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(result.success).toBe(true);
      
      // Should not include server info by default
      expect(result.serverInfo).toBeUndefined();
    });

    it('should provide consistent response format', async () => {
      const basicResult = await testConnection(liveClient, config, { includeServerInfo: false });
      const detailedResult = await testConnection(liveClient, config, { includeServerInfo: true });

      // Both should have same basic structure
      expect(basicResult).toHaveProperty('success');
      expect(basicResult).toHaveProperty('message');
      expect(detailedResult).toHaveProperty('success');
      expect(detailedResult).toHaveProperty('message');

      // Both should report success
      expect(basicResult.success).toBe(true);
      expect(detailedResult.success).toBe(true);

      // Only detailed should have serverInfo
      expect(basicResult.serverInfo).toBeUndefined();
      expect(detailedResult.serverInfo).toBeDefined();
    });
  });
});