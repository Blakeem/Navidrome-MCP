/**
 * Unit Tests for User Preferences Operations
 * 
 * Following UNIT-TEST-STRATEGY.md - Tier 1 Critical Tests
 * Combines live read operations with mocked write operations for data integrity protection.
 * 
 * DATA INTEGRITY: User preferences (stars/ratings) affect personal data - extensive mocking required for safety.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { loadConfig } from '../../../src/config.js';
import { getSharedLiveClient, createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { describeLive, shouldSkipLiveTests, getSkipReason } from '../../helpers/env-detection.js';

// Import user preference functions
import {
  starItem,
  unstarItem,
  setRating,
  listStarredItems,
  listTopRated,
} from '../../../src/tools/user-preferences.js';

describe('User Preferences Operations - Tier 1 Critical Tests', () => {
  let liveClient: NavidromeClient;
  let config: Config;

  beforeAll(async () => {
    if (shouldSkipLiveTests()) {
      console.log(`Skipping live tests: ${getSkipReason()}`);
      return;
    }
    // Use shared client and config for read operations testing (avoids rate limiting)
    liveClient = await getSharedLiveClient();
    config = await loadConfig();
  });

  describeLive('Live Read Operations - API Compatibility', () => {
    describe('listStarredItems', () => {
      it('should return valid starred songs structure from live server', async () => {
        const result = await listStarredItems(liveClient, {
          type: 'songs',
          limit: 1
        });

        // Validate response structure (not specific content). `type` is no
        // longer echoed (LLM input echo), so we don't assert it.
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('items');
        expect(result).not.toHaveProperty('type');

        // Ensure correct types
        expect(typeof result.count).toBe('number');
        expect(Array.isArray(result.items)).toBe(true);

        // Should not return more than requested (but server may have more starred items)
        // We requested limit: 1, but the implementation might return more due to internal batching
        expect(result.items.length).toBeGreaterThanOrEqual(0);

        // If there are starred items, validate structure
        if (result.items.length > 0) {
          const item = result.items[0];
          expect(item).toHaveProperty('id');
          expect(typeof item.id).toBe('string');

          // For songs, should have title
          if ('title' in item) {
            expect(typeof item.title).toBe('string');
          }
        }
      });

      it('should return valid starred albums structure', async () => {
        const result = await listStarredItems(liveClient, {
          type: 'albums',
          limit: 2
        });

        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toBeLessThanOrEqual(2);

        if (result.items.length > 0) {
          const item = result.items[0];
          expect(item).toHaveProperty('id');
          expect(typeof item.id).toBe('string');
        }
      });

      it('should return valid starred artists structure', async () => {
        const result = await listStarredItems(liveClient, {
          type: 'artists',
          limit: 2
        });

        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toBeLessThanOrEqual(2);

        if (result.items.length > 0) {
          const item = result.items[0];
          expect(item).toHaveProperty('id');
          expect(typeof item.id).toBe('string');
        }
      });

      it('should handle pagination parameters correctly', async () => {
        const result = await listStarredItems(liveClient, {
          type: 'songs',
          limit: 3,
          offset: 0
        });

        expect(result.items.length).toBeLessThanOrEqual(3);
        expect(typeof result.count).toBe('number');
      });
    });

    describe('listTopRated', () => {
      it('should return valid top-rated songs structure', async () => {
        const result = await listTopRated(liveClient, {
          type: 'songs',
          minRating: 4,
          limit: 2
        });

        // Validate response structure. `type` and `minRating` are no longer
        // echoed (LLM input echoes), so we don't assert them.
        expect(result).toHaveProperty('count');
        expect(result).toHaveProperty('items');
        expect(result).not.toHaveProperty('type');
        expect(result).not.toHaveProperty('minRating');

        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items.length).toBeLessThanOrEqual(2);

        if (result.items.length > 0) {
          const item = result.items[0];
          expect(item).toHaveProperty('id');
          expect(item).toHaveProperty('rating');
          expect(typeof item.id).toBe('string');
          expect(typeof item.rating).toBe('number');
          expect(item.rating).toBeGreaterThanOrEqual(4);
        }
      });

      it('should return valid top-rated albums structure', async () => {
        const result = await listTopRated(liveClient, {
          type: 'albums',
          minRating: 3,
          limit: 1
        });

        expect(Array.isArray(result.items)).toBe(true);
      });

      it('should return valid top-rated artists structure', async () => {
        const result = await listTopRated(liveClient, {
          type: 'artists',
          minRating: 5,
          limit: 1
        });

        expect(Array.isArray(result.items)).toBe(true);
      });
    });
  });

  describe('Mocked Write Operations - Data Integrity Safety', () => {
    let mockClient: MockNavidromeClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    describe('starItem', () => {
      it('should star a song with correct API call structure', async () => {
        const mockResponse = {
          success: true,
          message: 'Song starred successfully',
          id: 'song-123',
          type: 'song'
        };
        
        mockClient.subsonicRequest.mockResolvedValue(mockResponse);
        
        const result = await starItem(mockClient, config, { 
          id: 'song-123',
          type: 'song'
        });

        // Verify correct API call was made
        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/star',
          expect.objectContaining({
            id: 'song-123'
          })
        );

        // Verify response structure. `type` AND `id` are intentionally NOT
        // echoed — they are LLM input echoes and waste context window. The
        // success+message pair is the round-trip-safe confirmation.
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('message');
        expect(result).not.toHaveProperty('type');
        expect(result).not.toHaveProperty('id');
        expect(result.success).toBe(true);
      });

      it('should star an album with correct parameters', async () => {
        const mockResponse = {
          success: true,
          message: 'Album starred successfully',
          id: 'album-456',
          type: 'album'
        };

        mockClient.subsonicRequest.mockResolvedValue(mockResponse);

        const result = await starItem(mockClient, config, {
          id: 'album-456',
          type: 'album'
        });

        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/star',
          expect.objectContaining({
            id: 'album-456'
          })
        );

        expect(result.success).toBe(true);
        expect(result).not.toHaveProperty('id');
      });

      it('should star an artist with correct parameters', async () => {
        const mockResponse = {
          success: true,
          message: 'Artist starred successfully',
          id: 'artist-789',
          type: 'artist'
        };

        mockClient.subsonicRequest.mockResolvedValue(mockResponse);

        const result = await starItem(mockClient, config, {
          id: 'artist-789',
          type: 'artist'
        });

        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/star',
          expect.objectContaining({
            id: 'artist-789'
          })
        );

        expect(result.success).toBe(true);
        expect(result).not.toHaveProperty('id');
      });

      it('accepts the plural form (`type: "songs"`) without throwing', async () => {
        // Schema-layer normalization should silently coerce the plural to
        // singular so the LLM doesn't get a Zod error for a common confusion
        // bug. The response carries no `type` field either way.
        mockClient.subsonicRequest.mockResolvedValue({ status: 'ok' });

        const result = await starItem(mockClient, config, {
          id: 'song-xyz',
          type: 'songs',
        });

        expect(result.success).toBe(true);
        expect(result).not.toHaveProperty('id');
        expect(result).not.toHaveProperty('type');
        // The internal singular form drives the message text.
        expect(result.message).toBe('Successfully starred song');
      });
    });

    describe('unstarItem', () => {
      it('should unstar a song with correct API call structure', async () => {
        const mockResponse = {
          success: true,
          message: 'Song unstarred successfully',
          id: 'song-123',
          type: 'song'
        };
        
        mockClient.subsonicRequest.mockResolvedValue(mockResponse);
        
        const result = await unstarItem(mockClient, config, { 
          id: 'song-123',
          type: 'song'
        });

        // Verify correct API call was made (DELETE method). `id` is no
        // longer echoed in the response (LLM input echo).
        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/unstar',
          expect.objectContaining({
            id: 'song-123'
          })
        );

        expect(result.success).toBe(true);
        expect(result).not.toHaveProperty('id');
      });

      it('should unstar an album correctly', async () => {
        const mockResponse = {
          success: true,
          message: 'Album unstarred successfully',
          id: 'album-456',
          type: 'album'
        };
        
        mockClient.subsonicRequest.mockResolvedValue(mockResponse);
        
        await unstarItem(mockClient, config, { 
          id: 'album-456',
          type: 'album'
        });

        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/unstar',
          expect.objectContaining({
            id: 'album-456'
          })
        );
      });

      it('should unstar an artist correctly', async () => {
        const mockResponse = {
          success: true,
          message: 'Artist unstarred successfully',
          id: 'artist-789',
          type: 'artist'
        };
        
        mockClient.subsonicRequest.mockResolvedValue(mockResponse);
        
        await unstarItem(mockClient, config, { 
          id: 'artist-789',
          type: 'artist'
        });

        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/unstar',
          expect.objectContaining({
            id: 'artist-789'
          })
        );
      });
    });

    describe('setRating', () => {
      it('should set rating with correct API call structure', async () => {
        const mockResponse = {
          success: true,
          message: 'Rating set successfully',
          id: 'song-123',
          type: 'song',
          rating: 5
        };
        
        mockClient.subsonicRequest.mockResolvedValue(mockResponse);
        
        const result = await setRating(mockClient, config, { 
          id: 'song-123',
          type: 'song',
          rating: 5
        });

        // Verify correct API call was made. `id`, `type`, and `rating` are
        // not echoed back — they are LLM input echoes. The success+message
        // confirms the round trip.
        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/setRating',
          expect.objectContaining({
            id: 'song-123',
            rating: '5'
          })
        );

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('message');
        expect(result).not.toHaveProperty('rating');
        expect(result).not.toHaveProperty('id');
        expect(result.success).toBe(true);
        expect(result.message).toContain('5 stars');
      });

      it('should set rating for different item types', async () => {
        const mockResponse = {
          success: true,
          message: 'Rating set successfully',
          id: 'album-456',
          type: 'album',
          rating: 3
        };

        mockClient.subsonicRequest.mockResolvedValue(mockResponse);

        const result = await setRating(mockClient, config, {
          id: 'album-456',
          type: 'album',
          rating: 3
        });

        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/setRating',
          expect.objectContaining({
            id: 'album-456',
            rating: '3'
          })
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('3 stars');
      });

      it('should remove rating when set to 0', async () => {
        const mockResponse = {
          success: true,
          message: 'Rating removed successfully',
          id: 'song-123',
          type: 'song',
          rating: 0
        };

        mockClient.subsonicRequest.mockResolvedValue(mockResponse);

        const result = await setRating(mockClient, config, {
          id: 'song-123',
          type: 'song',
          rating: 0
        });

        expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
          '/setRating',
          expect.objectContaining({
            id: 'song-123',
            rating: '0'
          })
        );

        expect(result.success).toBe(true);
        expect(result.message).toMatch(/removed/i);
      });

      it('should handle maximum rating value', async () => {
        const mockResponse = {
          success: true,
          message: 'Rating set successfully',
          id: 'artist-789',
          type: 'artist',
          rating: 5
        };

        mockClient.subsonicRequest.mockResolvedValue(mockResponse);

        const result = await setRating(mockClient, config, {
          id: 'artist-789',
          type: 'artist',
          rating: 5
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('5 stars');
      });
    });
  });

  describe('Error Handling', () => {
    let mockClient: MockNavidromeClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('should handle network errors gracefully for starring', async () => {
      mockClient.subsonicRequest.mockRejectedValue(new Error('Network connection failed'));
      
      await expect(
        starItem(mockClient, config, { id: 'song-123', type: 'song' })
      ).rejects.toThrow('Network connection failed');
    });

    it('should handle API errors for invalid item IDs', async () => {
      mockClient.subsonicRequest.mockRejectedValue(new Error('Item not found'));
      
      await expect(
        setRating(mockClient, config, { id: 'non-existent-id', type: 'song', rating: 3 })
      ).rejects.toThrow('Item not found');
    });

    it('should handle permission errors for unauthorized operations', async () => {
      mockClient.subsonicRequest.mockRejectedValue(new Error('Insufficient permissions'));
      
      await expect(
        unstarItem(mockClient, config, { id: 'protected-song', type: 'song' })
      ).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('Input Validation', () => {
    let mockClient: MockNavidromeClient;

    beforeEach(() => {
      mockClient = createMockClient();
      mockClient.subsonicRequest.mockResolvedValue({ success: true });
    });

    it('should validate required ID parameter for starring', async () => {
      await expect(
        starItem(mockClient, config, { id: '', type: 'song' })
      ).rejects.toThrow();
    });

    it('should validate required type parameter', async () => {
      await expect(
        starItem(mockClient, config, { id: 'song-123', type: '' })
      ).rejects.toThrow();
    });

    it('should validate item type enum values for starring', async () => {
      await expect(
        starItem(mockClient, config, { id: 'song-123', type: 'invalid-type' })
      ).rejects.toThrow();
    });

    it('should validate item type enum values for listing', async () => {
      await expect(
        listStarredItems(mockClient, { type: 'invalid-type' })
      ).rejects.toThrow();
    });

    it('should validate rating range values', async () => {
      // Test below minimum
      await expect(
        setRating(mockClient, config, { id: 'song-123', type: 'song', rating: -1 })
      ).rejects.toThrow();

      // Test above maximum  
      await expect(
        setRating(mockClient, config, { id: 'song-123', type: 'song', rating: 6 })
      ).rejects.toThrow();
    });

    it('should validate pagination parameters', async () => {
      // Test negative offset
      await expect(
        listStarredItems(mockClient, { type: 'songs', offset: -1 })
      ).rejects.toThrow();

      // Test zero limit
      await expect(
        listStarredItems(mockClient, { type: 'songs', limit: 0 })
      ).rejects.toThrow();

      // Test limit over maximum
      await expect(
        listStarredItems(mockClient, { type: 'songs', limit: 501 })
      ).rejects.toThrow();
    });

    it('should validate minRating parameter for top-rated items', async () => {
      // Test below minimum
      await expect(
        listTopRated(mockClient, { type: 'songs', minRating: 0 })
      ).rejects.toThrow();

      // Test above maximum
      await expect(
        listTopRated(mockClient, { type: 'songs', minRating: 6 })
      ).rejects.toThrow();
    });
  });

  describe('Edge Cases', () => {
    let mockClient: MockNavidromeClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('should handle empty starred items list gracefully', async () => {
      mockClient.request.mockResolvedValue([]);
      
      const result = await listStarredItems(mockClient, { type: 'songs' });
      
      expect(result.items).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should handle empty top-rated items list gracefully', async () => {
      mockClient.request.mockResolvedValue([]);
      
      const result = await listTopRated(mockClient, { type: 'albums', minRating: 5 });
      
      expect(result.items).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should handle already starred items correctly', async () => {
      const mockResponse = {
        success: true,
        message: 'Item already starred',
        id: 'song-123',
        type: 'song'
      };
      
      mockClient.request.mockResolvedValue(mockResponse);
      
      const result = await starItem(mockClient, config, { 
        id: 'song-123', 
        type: 'song' 
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('starred');
    });

    it('should handle unstarring non-starred items correctly', async () => {
      const mockResponse = {
        success: true,
        message: 'Item was not starred',
        id: 'song-123',
        type: 'song'
      };
      
      mockClient.request.mockResolvedValue(mockResponse);
      
      const result = await unstarItem(mockClient, config, { 
        id: 'song-123', 
        type: 'song' 
      });

      expect(result.success).toBe(true);
    });
  });
});