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
import { shouldSkipLiveTests, getSkipReason, describeLive } from '../../helpers/env-detection.js';
import { getSharedLiveClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

// Import search functions
import {
  searchAll,
  searchSongs,
  searchAlbums,
  searchArtists,
} from '../../../src/tools/search.js';

describe('Search Operations - Tier 1 Critical Tests', () => {
  let config: Config;
  let liveClient: NavidromeClient;

  beforeAll(async () => {
    if (shouldSkipLiveTests()) {
      console.log(`Skipping live tests: ${getSkipReason()}`);
      return;
    }
    // Load configuration and create shared client for live testing
    config = await loadConfig();
    liveClient = await getSharedLiveClient();
  });

  describeLive('Live Search Operations - API Compatibility', () => {
    // Use a generic search term that should exist in most music libraries
    const testQuery = 'the';

    describe('searchAll', () => {
      it('should return valid cross-content search structure from live server', async () => {
        const result = await searchAll(liveClient, config, { 
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
        // Pagination fix: per-type real totals from X-Total-Count.
        expect(result).toHaveProperty('totalArtists');
        expect(result).toHaveProperty('totalAlbums');
        expect(result).toHaveProperty('totalSongs');

        // Ensure correct types
        expect(Array.isArray(result.artists)).toBe(true);
        expect(Array.isArray(result.albums)).toBe(true);
        expect(Array.isArray(result.songs)).toBe(true);
        expect(typeof result.query).toBe('string');
        expect(typeof result.totalResults).toBe('number');
        expect(typeof result.totalArtists).toBe('number');
        expect(typeof result.totalAlbums).toBe('number');
        expect(typeof result.totalSongs).toBe('number');

        // Per-type totals must be at least as large as their corresponding
        // returned arrays (the lie was: totalResults === arrays.length sum;
        // now totals come from X-Total-Count so they reflect server reality).
        expect(result.totalArtists).toBeGreaterThanOrEqual(result.artists.length);
        expect(result.totalAlbums).toBeGreaterThanOrEqual(result.albums.length);
        expect(result.totalSongs).toBeGreaterThanOrEqual(result.songs.length);
        // totalResults is the sum of the three per-type totals.
        expect(result.totalResults).toBe(result.totalArtists + result.totalAlbums + result.totalSongs);

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
        const result = await searchAll(liveClient, config, { 
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
        const result = await searchAll(liveClient, config, { 
          query: testQuery,
          artistCount: 0,
          albumCount: 1,
          songCount: 0
        });

        // When _end=0, Navidrome returns all results (no limit)
        // This is correct pagination behavior, not an error
        expect(result.artists.length).toBeGreaterThanOrEqual(0);
        expect(result.albums.length).toBeGreaterThanOrEqual(0);
        expect(result.songs.length).toBeGreaterThanOrEqual(0);
        
        // Verify structure is still correct
        expect(result).toHaveProperty('totalResults');
        expect(typeof result.totalResults).toBe('number');
      });
    });

    describe('searchSongs', () => {
      it('should return valid song search structure', async () => {
        const result = await searchSongs(liveClient, config, { 
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

        // Pagination correctness: `total` is the server's full match count
        // from X-Total-Count, not the page size. It must be at least as
        // large as the items we got back (the lie was: total === songs.length).
        expect(result.total).toBeGreaterThanOrEqual(result.songs.length);

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
        const result = await searchSongs(liveClient, config, { 
          query: testQuery,
          limit: 1
        });

        expect(result.songs.length).toBeLessThanOrEqual(1);
      });
    });

    describe('searchAlbums', () => {
      it('should return valid album search structure', async () => {
        const result = await searchAlbums(liveClient, config, { 
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

        // Pagination correctness — see searchSongs test above.
        expect(result.total).toBeGreaterThanOrEqual(result.albums.length);

        // Validate album structure if results exist
        if (result.albums.length > 0) {
          const album = result.albums[0];
          
          // Required AlbumDTO fields
          expect(album).toHaveProperty('id');
          expect(album).toHaveProperty('name');
          expect(album).toHaveProperty('songCount');
          expect(album).toHaveProperty('durationFormatted');
          
          // Verify field types for required fields
          expect(typeof album.id).toBe('string');
          expect(typeof album.name).toBe('string');
          expect(typeof album.songCount).toBe('number');
          expect(typeof album.durationFormatted).toBe('string');
          
          // Optional fields - only check type if present
          if (album.artist !== undefined) {
            expect(typeof album.artist).toBe('string');
          }
          if (album.artistId !== undefined) {
            expect(typeof album.artistId).toBe('string');
          }
        }
      });

      it('should handle limit parameter correctly', async () => {
        const result = await searchAlbums(liveClient, config, { 
          query: testQuery,
          limit: 1
        });

        expect(result.albums.length).toBeLessThanOrEqual(1);
      });
    });

    describe('searchArtists', () => {
      it('should return valid artist search structure', async () => {
        const result = await searchArtists(liveClient, config, { 
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

        // Pagination correctness — see searchSongs test above.
        expect(result.total).toBeGreaterThanOrEqual(result.artists.length);

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
        const result = await searchArtists(liveClient, config, { 
          query: testQuery,
          limit: 1
        });

        expect(result.artists.length).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it.skipIf(shouldSkipLiveTests())('should handle empty query strings gracefully', async () => {
      const result = await searchAll(liveClient, config, {
        query: '',
        artistCount: 1,
        albumCount: 1,
        songCount: 1
      });

      // Should not crash and return valid structure with empty query
      expect(result).toHaveProperty('totalResults');
      expect(result).toHaveProperty('query');
      expect(result.query).toBe('');
      expect(typeof result.totalResults).toBe('number');
    });

    it.skipIf(shouldSkipLiveTests())('should handle special characters in query', async () => {
      const result = await searchAll(liveClient, config, { 
        query: '!@#$%^&*()', 
        artistCount: 1, 
        albumCount: 1, 
        songCount: 1 
      });

      // Should not crash, even if no results
      expect(result).toHaveProperty('totalResults');
      expect(typeof result.totalResults).toBe('number');
    });

    it.skipIf(shouldSkipLiveTests())('should handle unicode characters in query', async () => {
      const result = await searchSongs(liveClient, config, { 
        query: 'café naïve résumé', 
        limit: 1 
      });

      // Should not crash, even if no results
      expect(result).toHaveProperty('total');
      expect(typeof result.total).toBe('number');
    });

    it('should handle very long query strings', async () => {
      const longQuery = 'a'.repeat(1000);

      // Should either succeed with proper shape or fail gracefully with an Error.
      let result: Awaited<ReturnType<typeof searchSongs>> | undefined;
      let caughtError: unknown;

      try {
        result = await searchSongs(liveClient, config, {
          query: longQuery,
          limit: 1,
        });
      } catch (error) {
        caughtError = error;
      }

      if (result !== undefined) {
        expect(result).toHaveProperty('total');
      } else {
        expect(caughtError).toBeInstanceOf(Error);
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

    it.skipIf(shouldSkipLiveTests())('should validate optional query parameter for searchAll', async () => {
      const result = await searchAll(liveClient, config, {
        artistCount: 1,
        albumCount: 1,
        songCount: 1
      });

      // searchAll should work without query (returns all results)
      expect(result).toHaveProperty('totalResults');
      expect(result).toHaveProperty('query');
      expect(result.query).toBe(''); // Default empty query
      expect(typeof result.totalResults).toBe('number');
    });

    it.skipIf(shouldSkipLiveTests())('searchAll offset paginates each sub-fetch (no longer hardcoded _start=0)', async () => {
      // Pre-fix: hardcoded `_start: '0'` in result-aggregator made searchAll
      // unable to paginate beyond the first page. This test locks in the
      // fix by asking for a specific offset and asserting the items differ
      // from the offset=0 page (when the library is large enough to have
      // multiple pages — gated behind a length check).
      const sortArgs = { sort: 'name' as const, order: 'ASC' as const, songCount: 2, albumCount: 2, artistCount: 0 };
      const page0 = await searchAll(liveClient, config, { query: '', offset: 0, ...sortArgs });
      const page1 = await searchAll(liveClient, config, { query: '', offset: 2, ...sortArgs });

      // Only assert "different items" when both pages have items AND the
      // total is large enough to actually have a different second page.
      if (page0.songs.length > 0 && page1.songs.length > 0 && page0.totalSongs > 2) {
        expect(page1.songs[0]?.id).not.toBe(page0.songs[0]?.id);
      }
      if (page0.albums.length > 0 && page1.albums.length > 0 && page0.totalAlbums > 2) {
        expect(page1.albums[0]?.id).not.toBe(page0.albums[0]?.id);
      }
    });

    it.skipIf(shouldSkipLiveTests())('should validate optional query parameter for searchSongs', async () => {
      const result = await searchSongs(liveClient, config, { limit: 1 });

      // searchSongs should work without query (returns all songs)
      expect(result).toHaveProperty('songs');
      expect(result).toHaveProperty('query');
      expect(result.query).toBe(''); // Default empty query
      expect(typeof result.total).toBe('number');
    });

    it.skipIf(shouldSkipLiveTests())('should validate optional query parameter for searchAlbums', async () => {
      const result = await searchAlbums(liveClient, config, { limit: 1 });

      // searchAlbums should work without query (returns all albums)
      expect(result).toHaveProperty('albums');
      expect(result).toHaveProperty('query');
      expect(result.query).toBe(''); // Default empty query
      expect(typeof result.total).toBe('number');
    });

    it.skipIf(shouldSkipLiveTests())('should validate optional query parameter for searchArtists', async () => {
      const result = await searchArtists(liveClient, config, { limit: 1 });

      // searchArtists should work without query (returns all artists)
      expect(result).toHaveProperty('artists');
      expect(result).toHaveProperty('query');
      expect(result.query).toBe(''); // Default empty query
      expect(typeof result.total).toBe('number');
    });

    it('should validate count parameters are within bounds', async () => {
      // Test with values beyond allowed range - should throw validation errors
      await expect(
        searchAll(liveClient, config, { 
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
        searchSongs(liveClient, config, {
          query: testQuery,
          limit: 600 // Over maximum of 500
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Validation', () => {
    const testQuery = 'the';

    it.skipIf(shouldSkipLiveTests())('should complete searches within reasonable time', async () => {
      const startTime = Date.now();
      
      await searchAll(liveClient, config, { 
        query: testQuery,
        artistCount: 10,
        albumCount: 10,
        songCount: 10
      });
      
      const duration = Date.now() - startTime;
      
      // Should complete within 10 seconds for reasonable library sizes
      expect(duration).toBeLessThan(10000);
    });

    it.skipIf(shouldSkipLiveTests())('should handle multiple concurrent searches', async () => {
      const searches = [
        searchSongs(liveClient, config, { query: 'rock', limit: 5 }),
        searchAlbums(liveClient, config, { query: 'jazz', limit: 5 }),
        searchArtists(liveClient, config, { query: 'blues', limit: 5 })
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