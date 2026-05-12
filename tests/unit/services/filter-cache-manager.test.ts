/**
 * Unit tests for FilterCacheManager - Simplified Implementation
 * Tests the improved logic without complex nested iteration
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { filterCacheManager, type FilterType } from '../../../src/services/filter-cache-manager.js';

// Mock data matching Navidrome API responses
const mockGenres = [
  { id: 'genre-1', name: 'Rock' },
  { id: 'genre-2', name: 'jazz' },
  { id: 'genre-3', name: 'Classical' },
  { id: 'genre-4', name: 'ELECTRONIC' },
];

const mockTags = [
  { id: 'tag-1', tagName: 'media', tagValue: 'CD' },
  { id: 'tag-2', tagName: 'media', tagValue: 'vinyl' },
  { id: 'tag-3', tagName: 'releasecountry', tagValue: 'US' },
  { id: 'tag-4', tagName: 'releasecountry', tagValue: 'uk' },
  { id: 'tag-5', tagName: 'releasetype', tagValue: 'Album' },
  { id: 'tag-6', tagName: 'releasetype', tagValue: 'single' },
  { id: 'tag-7', tagName: 'recordlabel', tagValue: 'Columbia Records' },
  { id: 'tag-8', tagName: 'recordlabel', tagValue: 'sony music' },
  { id: 'tag-9', tagName: 'mood', tagValue: 'Energetic' },
  { id: 'tag-10', tagName: 'mood', tagValue: 'relaxing' },
];

// Create mock client
const createMockClient = (): NavidromeClient => {
  const client = {
    requestWithLibraryFilter: vi.fn(),
  } as unknown as NavidromeClient;

  // Setup mock responses
  (client.requestWithLibraryFilter as any).mockImplementation((endpoint: string) => {
    if (endpoint === '/genre') {
      return Promise.resolve(mockGenres);
    }
    if (endpoint === '/tag') {
      return Promise.resolve(mockTags);
    }
    return Promise.resolve([]);
  });

  return client;
};

const mockConfig = {} as Config;

describe('FilterCacheManager - Simplified Implementation', () => {
  let client: NavidromeClient;

  beforeEach(async () => {
    // Reset singleton state for each test
    filterCacheManager.reset();

    client = createMockClient();

    // Initialize the cache manager
    await filterCacheManager.initialize(client, mockConfig);
  });

  describe('Core Functionality - Preserved Behavior', () => {
    it('should resolve exact case matches', () => {
      expect(filterCacheManager.resolve('genres', 'Rock')).toBe('genre-1');
      expect(filterCacheManager.resolve('genres', 'Classical')).toBe('genre-3');
      expect(filterCacheManager.resolve('mediaTypes', 'CD')).toBe('tag-1');
    });

    it('should resolve case-insensitive matches', () => {
      expect(filterCacheManager.resolve('genres', 'rock')).toBe('genre-1');
      expect(filterCacheManager.resolve('genres', 'ROCK')).toBe('genre-1');
      expect(filterCacheManager.resolve('genres', 'classical')).toBe('genre-3');
      expect(filterCacheManager.resolve('mediaTypes', 'cd')).toBe('tag-1');
    });

    it('should return null for non-existent entries', () => {
      expect(filterCacheManager.resolve('genres', 'NonExistent')).toBeNull();
      expect(filterCacheManager.resolve('mediaTypes', 'cassette')).toBeNull();
    });
  });

  describe('getAvailableOptions - Simplified Logic', () => {
    it('should return original case values for genres', () => {
      const options = filterCacheManager.getAvailableOptions('genres');

      // Should return original case, sorted
      expect(options).toEqual(['Classical', 'ELECTRONIC', 'Rock', 'jazz']);
      expect(options).toHaveLength(4);
    });

    it('should return original case values for media types', () => {
      const options = filterCacheManager.getAvailableOptions('mediaTypes');

      expect(options).toEqual(['CD', 'vinyl']);
      expect(options).toHaveLength(2);
    });

    it('should return original case values for countries', () => {
      const options = filterCacheManager.getAvailableOptions('countries');

      expect(options).toEqual(['US', 'uk']);
      expect(options).toHaveLength(2);
    });

    it('should return original case values for release types', () => {
      const options = filterCacheManager.getAvailableOptions('releaseTypes');

      expect(options).toEqual(['Album', 'single']);
      expect(options).toHaveLength(2);
    });

    it('should return original case values for record labels', () => {
      const options = filterCacheManager.getAvailableOptions('recordLabels');

      expect(options).toEqual(['Columbia Records', 'sony music']);
      expect(options).toHaveLength(2);
    });

    it('should return original case values for moods', () => {
      const options = filterCacheManager.getAvailableOptions('moods');

      expect(options).toEqual(['Energetic', 'relaxing']);
      expect(options).toHaveLength(2);
    });

    it('should not include lowercase duplicates', () => {
      const genreOptions = filterCacheManager.getAvailableOptions('genres');

      // Should not contain both 'Rock' and 'rock'
      expect(genreOptions.filter(opt => opt.toLowerCase() === 'rock')).toHaveLength(1);
      expect(genreOptions).toContain('Rock');
      expect(genreOptions).not.toContain('rock');
    });

    it('should preserve original case when original is lowercase', () => {
      const genreOptions = filterCacheManager.getAvailableOptions('genres');

      // 'jazz' is originally lowercase, should remain lowercase
      expect(genreOptions).toContain('jazz');
      expect(genreOptions).not.toContain('Jazz');
    });
  });

  describe('Performance - Simplified Algorithm', () => {
    it('should handle large datasets efficiently', async () => {
      // Create a larger mock dataset
      const largeGenres = Array.from({ length: 1000 }, (_, i) => ({
        id: `genre-${i}`,
        name: `Genre${i}`,
      }));

      const largeClient = {
        requestWithLibraryFilter: vi.fn().mockImplementation((endpoint: string) => {
          if (endpoint === '/genre') return Promise.resolve(largeGenres);
          if (endpoint === '/tag') return Promise.resolve([]);
          return Promise.resolve([]);
        }),
      } as unknown as NavidromeClient;

      filterCacheManager.reset();
      await filterCacheManager.initialize(largeClient, mockConfig);

      // Measure performance
      const start = performance.now();
      const options = filterCacheManager.getAvailableOptions('genres');
      const end = performance.now();

      expect(options).toHaveLength(1000);
      expect(end - start).toBeLessThan(10); // Should be very fast, < 10ms
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty filter sets', async () => {
      const emptyClient = {
        requestWithLibraryFilter: vi.fn().mockResolvedValue([]),
      } as unknown as NavidromeClient;

      filterCacheManager.reset();
      await filterCacheManager.initialize(emptyClient, mockConfig);

      expect(filterCacheManager.getAvailableOptions('genres')).toEqual([]);
      expect(filterCacheManager.getAvailableOptions('mediaTypes')).toEqual([]);
    });

    it('should handle mixed case scenarios correctly', () => {
      // Test with data that has same value in different cases
      const mixedOptions = filterCacheManager.getAvailableOptions('genres');

      // Should contain only one version of each logical value
      const lowerCaseSet = new Set(mixedOptions.map(opt => opt.toLowerCase()));
      expect(lowerCaseSet.size).toBe(mixedOptions.length);
    });

    it('should throw error when not initialized', () => {
      filterCacheManager.reset();

      expect(() => filterCacheManager.getAvailableOptions('genres'))
        .toThrow('FilterCacheManager not initialized');
    });
  });

  describe('Consistency Tests', () => {
    it('should maintain consistency between resolve and getAvailableOptions', () => {
      const types: FilterType[] = ['genres', 'mediaTypes', 'countries', 'releaseTypes', 'recordLabels', 'moods'];

      for (const type of types) {
        const options = filterCacheManager.getAvailableOptions(type);

        for (const option of options) {
          // Every available option should be resolvable
          expect(filterCacheManager.resolve(type, option)).not.toBeNull();

          // Case-insensitive resolution should also work
          expect(filterCacheManager.resolve(type, option.toLowerCase())).not.toBeNull();
          expect(filterCacheManager.resolve(type, option.toUpperCase())).not.toBeNull();
        }
      }
    });

    it('should maintain correct statistics', () => {
      const stats = filterCacheManager.getStats();

      expect(stats.genres).toBe(4);
      expect(stats.mediaTypes).toBe(2);
      expect(stats.countries).toBe(2);
      expect(stats.releaseTypes).toBe(2);
      expect(stats.recordLabels).toBe(2);
      expect(stats.moods).toBe(2);
    });
  });

  describe('findSimilar functionality', () => {
    it('should find similar filter names', () => {
      const similar = filterCacheManager.findSimilar('genres', 'roc', 3);
      expect(similar).toContain('Rock');
    });

    it('should find partial matches', () => {
      const similar = filterCacheManager.findSimilar('recordLabels', 'columbia', 3);
      expect(similar).toContain('Columbia Records');
    });
  });
});

describe('FilterCacheManager - cache disabled (filterCacheEnabled=false)', () => {
  const disabledConfig = { filterCacheEnabled: false } as Config;

  // Initial genre set returned by the first fetch
  const initialGenres = [{ id: 'genre-1', name: 'Rock' }];
  // Updated genre set returned after a new genre is added mid-session
  const updatedGenres = [
    { id: 'genre-1', name: 'Rock' },
    { id: 'genre-2', name: 'Shoegaze' },
  ];

  let fetchCount: number;
  let returnUpdated: boolean;
  let mockClient: NavidromeClient;

  beforeEach(() => {
    filterCacheManager.reset();
    fetchCount = 0;
    returnUpdated = false;

    mockClient = {
      requestWithLibraryFilter: vi.fn().mockImplementation((endpoint: string) => {
        fetchCount++;
        if (endpoint === '/genre') {
          return Promise.resolve(returnUpdated ? updatedGenres : initialGenres);
        }
        if (endpoint === '/tag') {
          return Promise.resolve(mockTags);
        }
        return Promise.resolve([]);
      }),
    } as unknown as NavidromeClient;
  });

  afterEach(() => {
    filterCacheManager.reset();
  });

  it('initializes successfully and populates cache for the first request', async () => {
    await filterCacheManager.initialize(mockClient, disabledConfig);

    expect(filterCacheManager.isInitialized()).toBe(true);
    expect(filterCacheManager.resolve('genres', 'Rock')).toBe('genre-1');
  });

  it('re-fetches data on ensureFresh() when disabled', async () => {
    await filterCacheManager.initialize(mockClient, disabledConfig);
    const fetchesAfterInit = fetchCount;

    // Simulate a new genre being added to the library
    returnUpdated = true;

    await filterCacheManager.ensureFresh();

    expect(fetchCount).toBeGreaterThan(fetchesAfterInit);
    expect(filterCacheManager.resolve('genres', 'Shoegaze')).toBe('genre-2');
  });

  it('does not re-fetch on ensureFresh() when cache is enabled (default)', async () => {
    const enabledConfig = { filterCacheEnabled: true } as Config;
    await filterCacheManager.initialize(mockClient, enabledConfig);
    const fetchesAfterInit = fetchCount;

    await filterCacheManager.ensureFresh();

    // No additional fetches should occur when cache is enabled
    expect(fetchCount).toBe(fetchesAfterInit);
  });

  it('getFilterOptions re-fetches when disabled and returns updated values', async () => {
    await filterCacheManager.initialize(mockClient, disabledConfig);

    // Simulate new genre added
    returnUpdated = true;

    const result = await filterCacheManager.getFilterOptions({ filterType: 'genres', limit: 50 });

    expect(result.available).toContain('Rock');
    expect(result.available).toContain('Shoegaze');
  });

  it('ensureFresh() resolves successfully when disabled and client is stored', async () => {
    await filterCacheManager.initialize(mockClient, disabledConfig);
    // After initialization the client reference is stored; ensureFresh() should
    // complete without error (it re-fetches and resolves).
    await expect(filterCacheManager.ensureFresh()).resolves.toBeUndefined();
  });
});