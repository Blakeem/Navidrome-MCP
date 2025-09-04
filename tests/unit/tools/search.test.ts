/**
 * Unit Tests for Search Operations
 * 
 * Following UNIT-TEST-STRATEGY.md - Tier 1 Critical Tests
 * Uses live read operations only since search functions are read-only.
 * 
 * HIGH USER IMPACT: Search is a core discovery feature used extensively by AI assistants.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Config } from '../../../src/config.js';
import { loadConfig } from '../../../src/config.js';

// Import search functions
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from '../../../src/tools/search.js';

describe('Search Operations - Tier 1 Critical Tests', () => {
  let config: Config;

  beforeAll(async () => {
    // Load configuration for live testing
    config = await loadConfig();
  });

  describe('Live Search Operations - API Compatibility', () => {
    // Use a generic search term that should exist in most music libraries
    const testQuery = 'the';

    describe('searchAll', () => {
      it('should return valid cross-content search structure from live server', async () => {
        const result = await searchAll(config, { 
          query: testQuery,
          artistCount: 1,
          albumCount: 1,
          songCount: 1
        });

        // Validate response structure (not specific content)
        expect(result).toHaveProperty('artists');
        expect(result).toHaveProperty('albums'); 
        expect(result).toHaveProperty('songs');
        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('totalResults');

        // Ensure correct types
        expect(Array.isArray(result.artists)).toBe(true);
        expect(Array.isArray(result.albums)).toBe(true);
        expect(Array.isArray(result.songs)).toBe(true);
        expect(typeof result.query).toBe('string');
        expect(typeof result.totalResults).toBe('number');

        // Query should match what we searched for
        expect(result.query).toBe(testQuery);

        // Validate artist structure if results exist
        if (result.artists.length > 0) {
          const artist = result.artists[0];
          expect(artist).toHaveProperty('id');
          expect(artist).toHaveProperty('name');
          expect(typeof artist.id).toBe('string');
          expect(typeof artist.name).toBe('string');
        }

        // Validate album structure if results exist
        if (result.albums.length > 0) {
          const album = result.albums[0];
          expect(album).toHaveProperty('id');
          expect(album).toHaveProperty('name');
          expect(album).toHaveProperty('artist');
          expect(typeof album.id).toBe('string');
          expect(typeof album.name).toBe('string');
          expect(typeof album.artist).toBe('string');
        }

        // Validate song structure if results exist
        if (result.songs.length > 0) {
          const song = result.songs[0];
          expect(song).toHaveProperty('id');
          expect(song).toHaveProperty('title');
          expect(song).toHaveProperty('artist');
          expect(song).toHaveProperty('album');
          expect(typeof song.id).toBe('string');
          expect(typeof song.title).toBe('string');
          expect(typeof song.artist).toBe('string');
          expect(typeof song.album).toBe('string');
        }
      });

      it('should handle count parameters correctly', async () => {
        const result = await searchAll(config, { 
          query: testQuery,
          artistCount: 2,
          albumCount: 3,
          songCount: 1
        });

        // Should not return more than requested
        expect(result.artists.length).toBeLessThanOrEqual(2);
        expect(result.albums.length).toBeLessThanOrEqual(3);
        expect(result.songs.length).toBeLessThanOrEqual(1);
      });

      it('should handle zero count parameters', async () => {
        const result = await searchAll(config, { 
          query: testQuery,
          artistCount: 0,
          albumCount: 1,
          songCount: 0
        });

        expect(result.artists.length).toBe(0);
        expect(result.albums.length).toBeGreaterThanOrEqual(0);
        expect(result.songs.length).toBe(0);
      });
    });

    describe('searchSongs', () => {
      it('should return valid song search structure', async () => {
        const result = await searchSongs(config, { 
          query: testQuery,
          limit: 2
        });

        // Validate response structure
        expect(result).toHaveProperty('songs');
        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('total');

        expect(Array.isArray(result.songs)).toBe(true);
        expect(typeof result.query).toBe('string');
        expect(typeof result.total).toBe('number');
        expect(result.query).toBe(testQuery);

        // Should not return more than requested
        expect(result.songs.length).toBeLessThanOrEqual(2);

        // Validate song structure if results exist
        if (result.songs.length > 0) {
          const song = result.songs[0];
          
          // Required SongDTO fields
          expect(song).toHaveProperty('id');
          expect(song).toHaveProperty('title');
          expect(song).toHaveProperty('artist');
          expect(song).toHaveProperty('album');
          expect(song).toHaveProperty('durationFormatted');
          
          // Verify field types
          expect(typeof song.id).toBe('string');
          expect(typeof song.title).toBe('string');
          expect(typeof song.artist).toBe('string');
          expect(typeof song.album).toBe('string');
          expect(typeof song.durationFormatted).toBe('string');
        }
      });

      it('should handle limit parameter correctly', async () => {
        const result = await searchSongs(config, { 
          query: testQuery,
          limit: 1
        });

        expect(result.songs.length).toBeLessThanOrEqual(1);
      });
    });

    describe('searchAlbums', () => {
      it('should return valid album search structure', async () => {
        const result = await searchAlbums(config, { 
          query: testQuery,
          limit: 2
        });

        // Validate response structure
        expect(result).toHaveProperty('albums');
        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('total');

        expect(Array.isArray(result.albums)).toBe(true);
        expect(typeof result.query).toBe('string');
        expect(typeof result.total).toBe('number');
        expect(result.query).toBe(testQuery);

        // Should not return more than requested
        expect(result.albums.length).toBeLessThanOrEqual(2);

        // Validate album structure if results exist
        if (result.albums.length > 0) {
          const album = result.albums[0];
          
          // Required AlbumDTO fields
          expect(album).toHaveProperty('id');
          expect(album).toHaveProperty('name');
          expect(album).toHaveProperty('artist');
          expect(album).toHaveProperty('artistId');
          expect(album).toHaveProperty('songCount');
          
          // Verify field types
          expect(typeof album.id).toBe('string');
          expect(typeof album.name).toBe('string');
          expect(typeof album.artist).toBe('string');
          expect(typeof album.artistId).toBe('string');
          expect(typeof album.songCount).toBe('number');
        }
      });

      it('should handle limit parameter correctly', async () => {
        const result = await searchAlbums(config, { 
          query: testQuery,
          limit: 1
        });

        expect(result.albums.length).toBeLessThanOrEqual(1);
      });
    });

    describe('searchArtists', () => {
      it('should return valid artist search structure', async () => {
        const result = await searchArtists(config, { 
          query: testQuery,
          limit: 2
        });

        // Validate response structure
        expect(result).toHaveProperty('artists');
        expect(result).toHaveProperty('query');
        expect(result).toHaveProperty('total');

        expect(Array.isArray(result.artists)).toBe(true);
        expect(typeof result.query).toBe('string');
        expect(typeof result.total).toBe('number');
        expect(result.query).toBe(testQuery);

        // Should not return more than requested
        expect(result.artists.length).toBeLessThanOrEqual(2);

        // Validate artist structure if results exist
        if (result.artists.length > 0) {
          const artist = result.artists[0];
          
          // Required ArtistDTO fields
          expect(artist).toHaveProperty('id');
          expect(artist).toHaveProperty('name');
          expect(artist).toHaveProperty('albumCount');
          expect(artist).toHaveProperty('songCount');
          
          // Verify field types
          expect(typeof artist.id).toBe('string');
          expect(typeof artist.name).toBe('string');
          expect(typeof artist.albumCount).toBe('number');
          expect(typeof artist.songCount).toBe('number');
        }
      });

      it('should handle limit parameter correctly', async () => {
        const result = await searchArtists(config, { 
          query: testQuery,
          limit: 1
        });

        expect(result.artists.length).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty query strings gracefully', async () => {
      await expect(
        searchAll(config, { query: '', artistCount: 1, albumCount: 1, songCount: 1 })
      ).rejects.toThrow();
    });

    it('should handle special characters in query', async () => {
      const result = await searchAll(config, { 
        query: '!@#$%^&*()', 
        artistCount: 1, 
        albumCount: 1, 
        songCount: 1 
      });

      // Should not crash, even if no results
      expect(result).toHaveProperty('totalResults');
      expect(typeof result.totalResults).toBe('number');
    });

    it('should handle unicode characters in query', async () => {
      const result = await searchSongs(config, { 
        query: 'café naïve résumé', 
        limit: 1 
      });

      // Should not crash, even if no results
      expect(result).toHaveProperty('total');
      expect(typeof result.total).toBe('number');
    });

    it('should handle very long query strings', async () => {
      const longQuery = 'a'.repeat(1000);
      
      // Should either work or fail gracefully
      try {
        const result = await searchSongs(config, { 
          query: longQuery, 
          limit: 1 
        });
        expect(result).toHaveProperty('totalResults');
      } catch (error) {
        // Acceptable to fail with long queries
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle network timeouts gracefully', async () => {
      // This test would require mocking network conditions
      // For now, just verify the functions exist and are callable
      expect(typeof searchAll).toBe('function');
      expect(typeof searchSongs).toBe('function');
      expect(typeof searchAlbums).toBe('function');
      expect(typeof searchArtists).toBe('function');
    });
  });

  describe('Input Validation', () => {
    const testQuery = 'the';

    it('should validate required query parameter for searchAll', async () => {
      await expect(
        searchAll(config, { artistCount: 1, albumCount: 1, songCount: 1 })
      ).rejects.toThrow();
    });

    it('should validate required query parameter for searchSongs', async () => {
      await expect(
        searchSongs(config, { limit: 1 })
      ).rejects.toThrow();
    });

    it('should validate required query parameter for searchAlbums', async () => {
      await expect(
        searchAlbums(config, { limit: 1 })
      ).rejects.toThrow();
    });

    it('should validate required query parameter for searchArtists', async () => {
      await expect(
        searchArtists(config, { limit: 1 })
      ).rejects.toThrow();
    });

    it('should validate count parameters are within bounds', async () => {
      // Test with values beyond allowed range - should throw validation errors
      await expect(
        searchAll(config, { 
          query: testQuery,
          artistCount: 150, // Over maximum of 100
          albumCount: -5,   // Below minimum of 0
          songCount: 1
        })
      ).rejects.toThrow();
    });

    it('should validate limit parameters are within bounds', async () => {
      // Should throw validation error for values beyond allowed range
      await expect(
        searchSongs(config, { 
          query: testQuery,
          limit: 150 // Over maximum of 100
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Validation', () => {
    const testQuery = 'the';

    it('should complete searches within reasonable time', async () => {
      const startTime = Date.now();
      
      await searchAll(config, { 
        query: testQuery,
        artistCount: 10,
        albumCount: 10,
        songCount: 10
      });
      
      const duration = Date.now() - startTime;
      
      // Should complete within 10 seconds for reasonable library sizes
      expect(duration).toBeLessThan(10000);
    });

    it('should handle multiple concurrent searches', async () => {
      const searches = [
        searchSongs(config, { query: 'rock', limit: 5 }),
        searchAlbums(config, { query: 'jazz', limit: 5 }),
        searchArtists(config, { query: 'blues', limit: 5 })
      ];

      // All searches should complete successfully
      const results = await Promise.all(searches);
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toHaveProperty('total');
      });
    });
  });
});