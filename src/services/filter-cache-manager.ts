/**
 * Navidrome MCP Server - Filter Cache Manager Service
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

export type FilterType = 'genres' | 'mediaTypes' | 'countries' | 'releaseTypes' | 'recordLabels' | 'moods';

interface GenreResponse {
  id: string;
  name: string;
}

interface TagResponse {
  id: string;
  tagName: string;
  tagValue: string;
}

/**
 * Singleton service for managing filter option caches for enhanced search functionality.
 * Caches small, well-defined filter sets for text-based filtering.
 */
class FilterCacheManager {
  private static instance: FilterCacheManager | null = null;
  
  private readonly genres = new Map<string, string>();           // "Rock" → "uuid-123"
  private readonly mediaTypes = new Map<string, string>();      // "CD" → "uuid-456" 
  private readonly countries = new Map<string, string>();       // "US" → "uuid-789"
  private readonly releaseTypes = new Map<string, string>();    // "Album" → "uuid-abc"
  private readonly recordLabels = new Map<string, string>();    // "Columbia" → "uuid-def"
  private readonly moods = new Map<string, string>();           // "Energetic" → "uuid-ghi"
  
  private initialized = false;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): FilterCacheManager {
    FilterCacheManager.instance ??= new FilterCacheManager();
    return FilterCacheManager.instance;
  }

  /**
   * Initialize the filter cache manager by loading all filter options
   */
  async initialize(client: NavidromeClient, _config: Config): Promise<void> {
    if (this.initialized) {
      logger.debug('FilterCacheManager already initialized');
      return;
    }

    try {
      await Promise.all([
        this.loadGenres(client),
        this.loadTagsByType(client, 'media'),
        this.loadTagsByType(client, 'releasecountry'),
        this.loadTagsByType(client, 'releasetype'),
        this.loadTagsByType(client, 'recordlabel'),
        this.loadTagsByType(client, 'mood')
      ]);
      
      this.initialized = true;
      
      const totalFilters = this.genres.size + this.mediaTypes.size + this.countries.size + 
                          this.releaseTypes.size + this.recordLabels.size + this.moods.size;
      
      logger.info(`FilterCacheManager initialized with ${totalFilters} filter options across 6 types`);
      logger.debug(`Filter counts: genres=${this.genres.size}, media=${this.mediaTypes.size}, countries=${this.countries.size}, releaseTypes=${this.releaseTypes.size}, labels=${this.recordLabels.size}, moods=${this.moods.size}`);
    } catch (error) {
      throw new Error(ErrorFormatter.toolExecution('FilterCacheManager.initialize', error));
    }
  }

  /**
   * Load genres from the /api/genre endpoint
   */
  private async loadGenres(client: NavidromeClient): Promise<void> {
    try {
      const genres = await client.requestWithLibraryFilter<GenreResponse[]>('/genre');
      
      if (!Array.isArray(genres)) {
        logger.warn('Invalid genres response, skipping genre cache');
        return;
      }

      this.genres.clear();
      for (const genre of genres) {
        if (genre.id && genre.name) {
          // Store both exact case and lowercase for case-insensitive lookup
          this.genres.set(genre.name, genre.id);
          this.genres.set(genre.name.toLowerCase(), genre.id);
        }
      }
      
      logger.debug(`Loaded ${Math.floor(this.genres.size / 2)} genres for filtering`);
    } catch (error) {
      logger.error('Failed to load genres:', ErrorFormatter.toolExecution('loadGenres', error));
      // Don't throw - continue with other filter types
    }
  }

  /**
   * Load tags of a specific type from the /api/tag endpoint
   */
  private async loadTagsByType(client: NavidromeClient, tagType: string): Promise<void> {
    try {
      // Get all tags and filter by tagName
      const allTags = await client.requestWithLibraryFilter<TagResponse[]>('/tag');
      
      if (!Array.isArray(allTags)) {
        logger.warn(`Invalid tags response for ${tagType}, skipping`);
        return;
      }

      const targetCache = this.getCacheForTagType(tagType);
      if (!targetCache) {
        logger.warn(`Unknown tag type: ${tagType}`);
        return;
      }

      targetCache.clear();
      const filteredTags = allTags.filter(tag => tag.tagName === tagType);
      
      for (const tag of filteredTags) {
        if (tag.id && tag.tagValue) {
          // Store both exact case and lowercase for case-insensitive lookup
          targetCache.set(tag.tagValue, tag.id);
          targetCache.set(tag.tagValue.toLowerCase(), tag.id);
        }
      }
      
      logger.debug(`Loaded ${Math.floor(targetCache.size / 2)} ${tagType} tags for filtering`);
    } catch (error) {
      logger.error(`Failed to load ${tagType} tags:`, ErrorFormatter.toolExecution(`loadTagsByType(${tagType})`, error));
      // Don't throw - continue with other filter types
    }
  }

  /**
   * Get the appropriate cache Map for a tag type
   */
  private getCacheForTagType(tagType: string): Map<string, string> | null {
    switch (tagType) {
      case 'media': return this.mediaTypes;
      case 'releasecountry': return this.countries;
      case 'releasetype': return this.releaseTypes;
      case 'recordlabel': return this.recordLabels;
      case 'mood': return this.moods;
      default: return null;
    }
  }

  /**
   * Get the appropriate cache Map for a filter type
   */
  private getCacheForType(type: FilterType): Map<string, string> {
    switch (type) {
      case 'genres': return this.genres;
      case 'mediaTypes': return this.mediaTypes;
      case 'countries': return this.countries;
      case 'releaseTypes': return this.releaseTypes;
      case 'recordLabels': return this.recordLabels;
      case 'moods': return this.moods;
      default: throw new Error(`Unknown filter type: ${type}`);
    }
  }

  /**
   * Resolve a filter name to its ID, with case-insensitive fallback
   */
  resolve(type: FilterType, name: string): string | null {
    if (!this.initialized) {
      throw new Error('FilterCacheManager not initialized');
    }

    const cache = this.getCacheForType(type);
    
    // Try exact match first, then case-insensitive
    return cache.get(name) ?? cache.get(name.toLowerCase()) ?? null;
  }

  /**
   * Get all available options for a filter type
   */
  getAvailableOptions(type: FilterType): string[] {
    if (!this.initialized) {
      throw new Error('FilterCacheManager not initialized');
    }

    const cache = this.getCacheForType(type);
    
    // Return only the original case versions (skip lowercase duplicates)
    const options: string[] = [];
    for (const [name] of cache.entries()) {
      // Only add if this is the original case (not lowercase version)
      if (name === name.toLowerCase()) {
        // This is the lowercase version, check if we have an original case version
        const originalCaseExists = Array.from(cache.keys()).some(key => 
          key !== name && key.toLowerCase() === name
        );
        if (!originalCaseExists) {
          // No original case version exists, so this lowercase one is the original
          options.push(name);
        }
      } else {
        // This is not all lowercase, so it's an original case version
        options.push(name);
      }
    }
    
    return options.sort();
  }

  /**
   * Get all available filter types
   */
  getFilterTypes(): FilterType[] {
    return ['genres', 'mediaTypes', 'countries', 'releaseTypes', 'recordLabels', 'moods'];
  }

  /**
   * Find similar filter names (for "did you mean?" suggestions)
   */
  findSimilar(type: FilterType, name: string, maxResults = 3): string[] {
    if (!this.initialized) {
      throw new Error('FilterCacheManager not initialized');
    }

    const options = this.getAvailableOptions(type);
    const lowerName = name.toLowerCase();
    
    // Simple similarity matching
    const similar = options
      .filter(option => {
        const lowerOption = option.toLowerCase();
        return lowerOption.includes(lowerName) || lowerName.includes(lowerOption);
      })
      .slice(0, maxResults);
    
    return similar;
  }

  /**
   * Check if filter cache manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): Record<FilterType, number> {
    return {
      genres: Math.floor(this.genres.size / 2),
      mediaTypes: Math.floor(this.mediaTypes.size / 2),
      countries: Math.floor(this.countries.size / 2),
      releaseTypes: Math.floor(this.releaseTypes.size / 2),
      recordLabels: Math.floor(this.recordLabels.size / 2),
      moods: Math.floor(this.moods.size / 2),
    };
  }

  /**
   * Get available filter options for enhanced search functionality
   * Uses FilterCacheManager to provide text-based filter discovery
   */
  getFilterOptions(args: unknown): {
    filterType: FilterType;
    available: string[];
    total: number;
    cacheStats: Record<FilterType, number>;
  } {
    // Basic validation for required filterType
    if (typeof args !== 'object' || args === null) {
      throw new Error('Invalid arguments: expected object');
    }

    const params = args as Record<string, unknown>;

    if (typeof params['filterType'] !== 'string') {
      throw new Error('filterType is required and must be a string');
    }

    const filterType = params['filterType'] as FilterType;
    const limit = typeof params['limit'] === 'number' ? params['limit'] : 50;

    // Validate filterType
    const validTypes: FilterType[] = ['genres', 'mediaTypes', 'countries', 'releaseTypes', 'recordLabels', 'moods'];
    if (!validTypes.includes(filterType)) {
      throw new Error(`Invalid filterType '${filterType}'. Must be one of: ${validTypes.join(', ')}`);
    }

    try {
      if (!this.isInitialized()) {
        throw new Error('Filter cache manager not initialized. Please wait for server startup to complete.');
      }

      // Get available options for the requested filter type
      const allOptions = this.getAvailableOptions(filterType);
      const limitedOptions = allOptions.slice(0, limit);

      // Get cache statistics for debugging
      const cacheStats = this.getStats();

      logger.debug(`Retrieved ${limitedOptions.length} ${filterType} options (of ${allOptions.length} total)`);

      return {
        filterType,
        available: limitedOptions,
        total: allOptions.length,
        cacheStats
      };
    } catch (error) {
      throw new Error(ErrorFormatter.toolExecution('getFilterOptions', error));
    }
  }

  /**
   * Reset the filter cache manager (for testing)
   */
  reset(): void {
    this.genres.clear();
    this.mediaTypes.clear();
    this.countries.clear();
    this.releaseTypes.clear();
    this.recordLabels.clear();
    this.moods.clear();
    this.initialized = false;
    FilterCacheManager.instance = null;
  }
}

// Export singleton instance getter for convenience
export const filterCacheManager = FilterCacheManager.getInstance();