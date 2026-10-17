import { describe, it, expect, beforeAll } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { createMockClient, getSharedLiveClient } from '../../factories/mock-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { testConnection } from '../../../src/tools/test.js';
import { loadConfig } from '../../../src/config.js';
import { shouldSkipLiveTests, getSkipReason } from '../../helpers/env-detection.js';

describe('Test Connection Tool - Live Connection Testing', () => {
  let liveClient: NavidromeClient;
  let config: Config;

  beforeAll(async () => {
    if (shouldSkipLiveTests()) {
      console.warn(`Skipping live tests: ${getSkipReason()}`);
      return;
    }
    // The shared client authenticates once, since Navidrome rate-limits concurrent logins.
    config = await loadConfig();
    liveClient = await getSharedLiveClient();
  });

  describe('testConnection', () => {
    it.skipIf(shouldSkipLiveTests())('should successfully connect to live Navidrome server', async () => {
      const result = await testConnection(liveClient, config, { includeServerInfo: false });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');

      expect(result.success).toBe(true);
      expect(typeof result.message).toBe('string');
      expect(result.message).toMatch(/successfully connected/i);
    });

    it.skipIf(shouldSkipLiveTests())('should return detailed server info when requested', async () => {
      const result = await testConnection(liveClient, config, { includeServerInfo: true });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('serverInfo');

      expect(result.success).toBe(true);
      expect(typeof result.message).toBe('string');

      const serverInfo = result.serverInfo!;
      expect(serverInfo).toHaveProperty('url');
      expect(serverInfo).toHaveProperty('authenticated');
      expect(serverInfo).toHaveProperty('timestamp');
      expect(serverInfo).toHaveProperty('mcpServerVersion');
      expect(serverInfo).toHaveProperty('features');

      expect(typeof serverInfo.url).toBe('string');
      expect(serverInfo.url.length).toBeGreaterThan(0);

      expect(typeof serverInfo.authenticated).toBe('boolean');
      expect(serverInfo.authenticated).toBe(true);

      expect(typeof serverInfo.mcpServerVersion).toBe('string');
      expect(serverInfo.mcpServerVersion.length).toBeGreaterThan(0);
      expect(serverInfo.mcpServerVersion).toMatch(/^\d+\.\d+\.\d+$/);

      const features = serverInfo.features!;
      expect(typeof features).toBe('object');
      expect(features).not.toBeNull();

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

      expect(typeof serverInfo.timestamp).toBe('string');
      expect(() => new Date(serverInfo.timestamp)).not.toThrow();

      expect(Array.isArray(features.lastfm.tools)).toBe(true);
      expect(Array.isArray(features.radioBrowser.tools)).toBe(true);
      expect(Array.isArray(features.lyrics.tools)).toBe(true);
    });

    it.skipIf(shouldSkipLiveTests())('should detect enabled features correctly based on environment', async () => {
      const result = await testConnection(liveClient, config, { includeServerInfo: true });
      
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('serverInfo');
      
      const features = result.serverInfo!.features!;

      if (config.features.lastfm) {
        expect(features.lastfm.enabled).toBe(true);
        expect(features.lastfm.tools.length).toBeGreaterThan(0);
      } else {
        expect(features.lastfm.enabled).toBe(false);
        expect(features.lastfm.tools.length).toBe(0);
      }

      if (config.features.radioBrowser) {
        expect(features.radioBrowser.enabled).toBe(true);
        expect(features.radioBrowser.tools.length).toBeGreaterThan(0);
      } else {
        expect(features.radioBrowser.enabled).toBe(false);
        expect(features.radioBrowser.tools.length).toBe(0);
      }

      if (config.features.lyrics) {
        expect(features.lyrics.enabled).toBe(true);
        expect(features.lyrics.tools.length).toBeGreaterThan(0);
      } else {
        expect(features.lyrics.enabled).toBe(false);
        expect(features.lyrics.tools.length).toBe(0);
      }
    });

    it.skipIf(shouldSkipLiveTests())('should handle connection with default parameters', async () => {
      const result = await testConnection(liveClient, config, {});

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('message');
      expect(result.success).toBe(true);

      expect(result.serverInfo).toBeUndefined();
    });

    it.skipIf(shouldSkipLiveTests())('should provide consistent response format', async () => {
      const basicResult = await testConnection(liveClient, config, { includeServerInfo: false });
      const detailedResult = await testConnection(liveClient, config, { includeServerInfo: true });

      expect(basicResult).toHaveProperty('success');
      expect(basicResult).toHaveProperty('message');
      expect(detailedResult).toHaveProperty('success');
      expect(detailedResult).toHaveProperty('message');

      expect(basicResult.success).toBe(true);
      expect(detailedResult.success).toBe(true);

      expect(basicResult.serverInfo).toBeUndefined();
      expect(detailedResult.serverInfo).toBeDefined();
    });
  });
});

describe('Test Connection Tool - feature inventory', () => {
  it('lists every tool each enabled feature registers', async () => {
    const client = createMockClient();
    client.request.mockResolvedValue([]);
    const config = makeTestConfig({ features: { lastfm: true, radioBrowser: true, lyrics: true, playback: true } });

    const result = await testConnection(client as unknown as NavidromeClient, config, { includeServerInfo: true });
    const features = result.serverInfo?.features;

    expect(features?.lastfm.tools).toEqual(expect.arrayContaining(['get_artist_albums', 'get_album_info']));
    expect(features?.radioBrowser.tools).toContain('discover_radio_stations');
    expect(features?.lyrics.tools).toEqual(['search_lyrics']);
    expect(features?.playback.enabled).toBe(true);
    expect(features?.playback.tools).toEqual(expect.arrayContaining(['play_songs', 'play_radio_station']));
  });

  it('reports playback disabled with no tools when mpv is absent', async () => {
    const client = createMockClient();
    client.request.mockResolvedValue([]);

    const result = await testConnection(client as unknown as NavidromeClient, makeTestConfig(), { includeServerInfo: true });

    expect(result.serverInfo?.features?.playback).toMatchObject({ enabled: false, tools: [] });
  });
});
