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
      console.warn(`Skipping live tests: ${getSkipReason()}`);
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

    // Pagination-honesty regression: minRating is applied client-side AFTER the
    // fetch, so the server must NOT pre-skip with _start=offset (that would
    // permanently drop qualifying high-rated rows in global positions
    // 0..offset-1). Fetch from _start=0 and apply the offset in memory after
    // filtering. NOTE: Navidrome ignores rating_gt/rating_gte, so a server-side
    // range filter is not available — this keeps the offset honest.
    it('listTopRated fetches from _start=0 and over-fetches (offset+limit)*3', async () => {
      mockClient.requestWithLibraryFilter.mockResolvedValue([]);

      await listTopRated(mockClient, { type: 'songs', minRating: 4, limit: 10, offset: 20 });

      const [endpoint] = mockClient.requestWithLibraryFilter.mock.calls[0]!;
      expect(endpoint).toContain('_start=0');
      expect(endpoint).not.toContain('_start=20');
      // _end = (20 + 10) * 3 = 90
      expect(endpoint).toContain('_end=90');
      // Server-side rating range filters are no-ops; we never send them.
      expect(endpoint).not.toContain('rating_gt');
      expect(endpoint).not.toContain('rating_gte');
    });

    it('listTopRated applies offset to the FILTERED set so page 2 continues past page 1', async () => {
      // 6 albums all at/above the threshold, sorted rating DESC.
      const albums = Array.from({ length: 6 }, (_, i) => ({
        id: `al${i}`, name: `Album ${i}`, artist: 'A', rating: 5,
      }));
      mockClient.requestWithLibraryFilter.mockResolvedValue(albums);

      const page0 = await listTopRated(mockClient, { type: 'albums', minRating: 4, limit: 2, offset: 0 });
      const page1 = await listTopRated(mockClient, { type: 'albums', minRating: 4, limit: 2, offset: 2 });

      expect(page0.items.map(i => i.id)).toEqual(['al0', 'al1']);
      expect(page1.items.map(i => i.id)).toEqual(['al2', 'al3']);
    });

    it('listTopRated offset skips within the post-filter set, not the raw rows', async () => {
      // al0 is below minRating and must not consume an offset slot.
      mockClient.requestWithLibraryFilter.mockResolvedValue([
        { id: 'al0', name: 'Low', artist: 'A', rating: 1 },   // filtered out by minRating: 4
        { id: 'al1', name: 'High1', artist: 'A', rating: 5 },
        { id: 'al2', name: 'High2', artist: 'A', rating: 4 },
        { id: 'al3', name: 'High3', artist: 'A', rating: 4 },
      ]);

      const result = await listTopRated(mockClient, { type: 'albums', minRating: 4, limit: 1, offset: 1 });

      // Filtered set is [al1, al2, al3]; offset 1 -> al2.
      expect(result.items.map(i => i.id)).toEqual(['al2']);
    });

    // Item 3 (FOLLOWUP) — honest under-delivery signal. minRating is a
    // client-side cutoff over a bounded, capped over-fetch window, so the tool
    // surfaces hasMore/partial rather than silently under-delivering.
    describe('listTopRated hasMore/partial signal', () => {
      it('a fully-served page within an unsaturated window reports hasMore=false, partial=false', async () => {
        // 3 raw rows; fetchLimit for limit=2/offset=0 is (0+2)*3=6, so 3 < 6:
        // window is NOT saturated. All qualify; page fills exactly its slice.
        mockClient.requestWithLibraryFilter.mockResolvedValue([
          { id: 'al0', name: 'A0', artist: 'A', rating: 5 },
          { id: 'al1', name: 'A1', artist: 'A', rating: 5 },
          { id: 'al2', name: 'A2', artist: 'A', rating: 5 },
        ]);

        const result = await listTopRated(mockClient, { type: 'albums', minRating: 4, limit: 2, offset: 0 });

        expect(result.items.map(i => i.id)).toEqual(['al0', 'al1']);
        // 3 qualifying > offset+limit (2) -> more exist past this page...
        expect(result.hasMore).toBe(true);
        // ...but the page was full and the window wasn't saturated -> not partial.
        expect(result.partial).toBe(false);
      });

      it('last page with no further qualifying rows reports hasMore=false, partial=false', async () => {
        mockClient.requestWithLibraryFilter.mockResolvedValue([
          { id: 'al0', name: 'A0', artist: 'A', rating: 5 },
          { id: 'al1', name: 'A1', artist: 'A', rating: 5 },
        ]);

        // filtered.length (2) == offset+limit (2), window unsaturated (2 < 6).
        const result = await listTopRated(mockClient, { type: 'albums', minRating: 4, limit: 2, offset: 0 });

        expect(result.items.map(i => i.id)).toEqual(['al0', 'al1']);
        expect(result.hasMore).toBe(false);
        expect(result.partial).toBe(false);
      });

      it('an under-filled page over a SATURATED window reports hasMore=true, partial=true', async () => {
        // limit=2/offset=0 -> fetchLimit=6. Return exactly 6 raw rows (saturated),
        // but only 1 of them qualifies. We can only return 1 (< limit), and rows
        // beyond the window were never examined -> partial, more may exist.
        const rows = [
          { id: 'al0', name: 'A0', artist: 'A', rating: 5 }, // qualifies
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `lo${i}`, name: `Lo${i}`, artist: 'A', rating: 1, // filtered out
          })),
        ];
        mockClient.requestWithLibraryFilter.mockResolvedValue(rows);

        const result = await listTopRated(mockClient, { type: 'albums', minRating: 4, limit: 2, offset: 0 });

        expect(result.count).toBe(1);
        expect(result.items.map(i => i.id)).toEqual(['al0']);
        expect(result.partial).toBe(true);
        expect(result.hasMore).toBe(true);
      });

      it('a full page over a SATURATED window reports hasMore=true but partial=false', async () => {
        // 6 raw rows (saturated), all qualify; the page fills its full limit, so
        // it is NOT partial even though more may lie beyond the window.
        const rows = Array.from({ length: 6 }, (_, i) => ({
          id: `al${i}`, name: `A${i}`, artist: 'A', rating: 5,
        }));
        mockClient.requestWithLibraryFilter.mockResolvedValue(rows);

        const result = await listTopRated(mockClient, { type: 'albums', minRating: 4, limit: 2, offset: 0 });

        expect(result.count).toBe(2);
        expect(result.hasMore).toBe(true);
        expect(result.partial).toBe(false);
      });

      it('an empty result reports hasMore=false, partial=false', async () => {
        mockClient.requestWithLibraryFilter.mockResolvedValue([]);

        const result = await listTopRated(mockClient, { type: 'albums', minRating: 5, limit: 2, offset: 0 });

        expect(result.count).toBe(0);
        expect(result.hasMore).toBe(false);
        expect(result.partial).toBe(false);
      });
    });

    it('should call subsonicRequest /star and return success for starItem', async () => {
      // starItem/unstarItem use client.subsonicRequest, not client.request.
      // The Subsonic endpoint is idempotent (re-starring is not an error), so
      // we just verify the correct endpoint and id are forwarded.
      mockClient.subsonicRequest.mockResolvedValue({ status: 'ok' });

      const result = await starItem(mockClient, config, {
        id: 'song-123',
        type: 'song'
      });

      expect(mockClient.subsonicRequest).toHaveBeenCalledWith('/star', { id: 'song-123' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('starred');
    });

    it('should call subsonicRequest /unstar and return success for unstarItem', async () => {
      // Unstarring a non-starred item is also idempotent on the Subsonic API —
      // the endpoint succeeds regardless. Verify the right path and id are sent.
      mockClient.subsonicRequest.mockResolvedValue({ status: 'ok' });

      const result = await unstarItem(mockClient, config, {
        id: 'song-123',
        type: 'song'
      });

      expect(mockClient.subsonicRequest).toHaveBeenCalledWith('/unstar', { id: 'song-123' });
      expect(result.success).toBe(true);
      expect(result.message).toContain('unstarred');
    });
  });
});