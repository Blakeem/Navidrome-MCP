/**
 * Unit Tests for Library Tools - Live Read Operations
 * 
 * Following UNIT-TEST-STRATEGY.md - tests live read operations against real server
 * to validate API compatibility and response structure without testing specific content.
 * 
 * Note: These tests automatically skip in CI environments without Navidrome configuration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { getSharedLiveClient } from '../../factories/mock-client.js';
import { listSongs } from '../../../src/tools/library.js';
import { describeLive, shouldSkipLiveTests, getSkipReason } from '../../helpers/env-detection.js';

describeLive('Library Tools - Live Read Operations', () => {
  let liveClient: NavidromeClient;

  beforeAll(async () => {
    if (shouldSkipLiveTests()) {
      console.log(`Skipping live tests: ${getSkipReason()}`);
      return;
    }
    // Use shared client connection for read testing (avoids rate limiting)
    liveClient = await getSharedLiveClient();
  });

  describe('listSongs', () => {
    it('should return valid song structure from live server', async () => {
      // Test with minimal parameters to avoid large responses
      const result = await listSongs(liveClient, { limit: 1 });

      // Validate response structure (not specific content)
      expect(result).toHaveProperty('songs');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('offset');
      expect(result).toHaveProperty('limit');

      // Ensure we got the expected types
      expect(Array.isArray(result.songs)).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(typeof result.offset).toBe('number');
      expect(typeof result.limit).toBe('number');

      // If we have songs, verify structure (but not specific content)
      if (result.songs.length > 0) {
        const song = result.songs[0];
        
        // Required fields from SongDTO
        expect(song).toHaveProperty('id');
        expect(song).toHaveProperty('title');
        expect(song).toHaveProperty('artist');
        expect(song).toHaveProperty('album');
        
        // Verify field types
        expect(typeof song.id).toBe('string');
        expect(typeof song.title).toBe('string');
        expect(typeof song.artist).toBe('string');
        expect(typeof song.album).toBe('string');
        
        // Optional numeric fields should be numbers if present
        if (song.year !== undefined) {
          expect(typeof song.year).toBe('number');
        }
        if (song.duration !== undefined) {
          expect(typeof song.duration).toBe('number');
        }
        if (song.track !== undefined) {
          expect(typeof song.track).toBe('number');
        }
      }

      // Verify pagination parameters were respected
      expect(result.limit).toBe(1);
      expect(result.offset).toBe(0);
    });

    it('should handle pagination parameters correctly', async () => {
      // Test with offset to ensure pagination works
      const result = await listSongs(liveClient, { limit: 2, offset: 1 });

      expect(result.limit).toBe(2);
      expect(result.offset).toBe(1);
      expect(result.songs.length).toBeLessThanOrEqual(2);
    });

    it('should respect starred filter when provided', async () => {
      // Test starred filter (should not fail regardless of content)
      const result = await listSongs(liveClient, { 
        limit: 5, 
        starred: true 
      });

      expect(result).toHaveProperty('songs');
      expect(Array.isArray(result.songs)).toBe(true);
      
      // All returned songs should have starred field (if any returned)
      result.songs.forEach(song => {
        expect(song).toHaveProperty('starred');
        expect(typeof song.starred).toBe('boolean');
      });
    });

    it('should handle different sort options', async () => {
      const result = await listSongs(liveClient, { 
        limit: 3,
        sort: 'artist',
        order: 'ASC'
      });

      expect(result).toHaveProperty('songs');
      expect(Array.isArray(result.songs)).toBe(true);
      
      // Verify structure is consistent regardless of sort
      if (result.songs.length > 0) {
        result.songs.forEach(song => {
          expect(song).toHaveProperty('artist');
          expect(typeof song.artist).toBe('string');
        });
      }
    });

    it('should return empty results gracefully when no matches', async () => {
      // This shouldn't throw even if there are no songs matching criteria
      // (though with a real server this is unlikely)
      const result = await listSongs(liveClient, { 
        limit: 1,
        starred: false  // This should still work
      });

      expect(result).toHaveProperty('songs');
      expect(Array.isArray(result.songs)).toBe(true);
      expect(typeof result.total).toBe('number');
    });
  });
});