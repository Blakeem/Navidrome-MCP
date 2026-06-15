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
import { FilterOptionsSchema } from '../schemas/index.js';

// Source of truth for the valid filter types within this module: the FilterType
// union and the runtime list from getFilterTypes() both derive from it.
// NOTE: the input-validation enum in FilterOptionsSchema (schemas/validation.ts)
// is a SEPARATE, manually-kept-in-sync copy of these literals — it cannot import
// from here without a schemas↔services cycle. Keep the two lists in agreement;
// the unit tests assert the get_filter_options surface matches.
const FILTER_TYPES = ['genres', 'mediaTypes', 'countries', 'releaseTypes', 'recordLabels', 'moods'] as const;

export type FilterType = (typeof FILTER_TYPES)[number];

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
 *
 * When filterCacheEnabled=false the Maps are still used as a working buffer, but
 * ensureFresh() re-fetches all tag/genre data before every resolve operation so
 * newly-added values are always visible.
 */
class FilterCacheManager {
  private static instance: FilterCacheManager | null = null;

  private readonly genres = new Map<string, string>();           // "Rock" → "uuid-123"
  private readonly mediaTypes = new Map<string, string>();      // "CD" → "uuid-456"
  private readonly countries = new Map<string, string>();       // "US" → "uuid-789"
  private readonly releaseTypes = new Map<string, string>();    // "Album" → "uuid-abc"
  private readonly recordLabels = new Map<string, string>();    // "Columbia" → "uuid-def"
  private readonly moods = new Map<string, string>();           // "Energetic" → "uuid-ghi"

  // Store original case mappings for clean retrieval (lowercase → original)
  private readonly genresOriginal = new Map<string, string>();
  private readonly mediaTypesOriginal = new Map<string, string>();
  private readonly countriesOriginal = new Map<string, string>();
  private readonly releaseTypesOriginal = new Map<string, string>();
  private readonly recordLabelsOriginal = new Map<string, string>();
  private readonly moodsOriginal = new Map<string, string>();

  private initialized = false;
  private cacheEnabled = true;
  private client: NavidromeClient | null = null;
  // Single-flight de-dup for the cache-disabled refresh path. Without this,
  // N concurrent searches each trigger their own fanout of /tag and /genre
  // fetches AND can read from a Map that was just cleared by a peer's
  // refresh, producing spurious "filter not found" errors. The promise is
  // shared until settled, then nulled so the next request triggers a fresh
  // fetch (the whole point of cache-disabled mode is freshness).
  private refreshPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): FilterCacheManager {
    FilterCacheManager.instance ??= new FilterCacheManager();
    return FilterCacheManager.instance;
  }

  /**
   * Initialize the filter cache manager by loading all filter options.
   *
   * When config.filterCacheEnabled is false the client reference is stored for
   * use by ensureFresh(), which re-fetches all data on every resolve call.
   * The startup fetch still runs so the first request has data immediately.
   */
  async initialize(client: NavidromeClient, config: Config): Promise<void> {
    // Store the client reference for use by ensureFresh() when cache is disabled.
    // Default to true (cache enabled) — only explicitly false disables it.
    this.client = client;
    this.cacheEnabled = config.filterCacheEnabled;

    if (this.initialized && this.cacheEnabled) {
      logger.debug('FilterCacheManager already initialized');
      return;
    }

    if (!this.cacheEnabled) {
      logger.info('FilterCacheManager cache disabled (NAVIDROME_FILTER_CACHE_ENABLED=false) — filter data will be refreshed on every resolve call');
    }

    try {
      await this.fetchAllData(client);
      this.initialized = true;
    } catch (error) {
      throw new Error(ErrorFormatter.toolExecution('FilterCacheManager.initialize', error));
    }
  }

  /**
   * Fetch all filter data from the Navidrome API into the in-memory Maps.
   * Used by initialize() and ensureFresh().
   */
  private async fetchAllData(client: NavidromeClient): Promise<void> {
    await Promise.all([
      this.loadGenres(client),
      this.loadTagsByType(client, 'media'),
      this.loadTagsByType(client, 'releasecountry'),
      this.loadTagsByType(client, 'releasetype'),
      this.loadTagsByType(client, 'recordlabel'),
      this.loadTagsByType(client, 'mood')
    ]);

    const totalFilters = this.genresOriginal.size + this.mediaTypesOriginal.size + this.countriesOriginal.size +
                        this.releaseTypesOriginal.size + this.recordLabelsOriginal.size + this.moodsOriginal.size;

    if (totalFilters === 0) {
      logger.warn('FilterCacheManager loaded 0 filter options after the startup fetch — Navidrome may have been unreachable; filter-based search will stay empty until the cache is refreshed.');
    }

    logger.info(`FilterCacheManager loaded ${totalFilters} filter options across 6 types`);
    logger.debug(`Filter counts: genres=${this.genresOriginal.size}, media=${this.mediaTypesOriginal.size}, countries=${this.countriesOriginal.size}, releaseTypes=${this.releaseTypesOriginal.size}, labels=${this.recordLabelsOriginal.size}, moods=${this.moodsOriginal.size}`);
  }

  /**
   * Re-fetch all filter data if cache is disabled. Called before every resolve operation
   * when filterCacheEnabled=false so newly-added genres/labels/moods are always visible.
   * No-op when cache is enabled.
   *
   * Concurrent callers share a single in-flight refresh — without this, two
   * parallel searches would each spawn 6 loaders (5 /tag + 1 /genre) AND
   * could see torn Map state mid-clear (`resolve()` reading from a
   * just-`.clear()`ed Map returns null, surfacing a bogus "not found").
   */
  async ensureFresh(): Promise<void> {
    if (this.cacheEnabled) {
      return;
    }
    if (this.client === null) {
      throw new Error('FilterCacheManager not initialized — call initialize() first');
    }
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }
    logger.debug('FilterCacheManager cache disabled — refreshing filter data before resolve');
    this.refreshPromise = this.fetchAllData(this.client).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
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

      // DEFERRED (accepted latent concurrency item): this clear-then-refill is
      // not atomic — a concurrent reader could observe a half-rebuilt Map. It's
      // mitigated today by the single-flight `refreshPromise` in ensureFresh(),
      // so any caller that awaits a refresh never sees a torn Map. An atomic
      // build-into-a-new-Map-then-swap is the eventual fix; left as-is per
      // maintainer decision.
      this.genres.clear();
      this.genresOriginal.clear();
      for (const genre of genres) {
        if (genre.id && genre.name) {
          // Store both exact case and lowercase for case-insensitive lookup
          this.genres.set(genre.name, genre.id);
          this.genres.set(genre.name.toLowerCase(), genre.id);
          // Store original case mapping for clean retrieval
          this.genresOriginal.set(genre.name.toLowerCase(), genre.name);
        }
      }
      
      logger.debug(`Loaded ${this.genresOriginal.size} genres for filtering`);
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
      // Fetch only the tags for this type (server filters by tag_name).
      // Pass an explicit large _end window so the full tag set is loaded —
      // without it Navidrome applies its server-side default page size and a
      // library with many tag values (labels, moods, etc.) would be silently
      // truncated. Verified /tag honors _start/_end like /album and /song.
      const tags = await client.requestWithLibraryFilter<TagResponse[]>(`/tag?tag_name=${encodeURIComponent(tagType)}&_start=0&_end=1000`);

      if (!Array.isArray(tags)) {
        logger.warn(`Invalid tags response for ${tagType}, skipping`);
        return;
      }

      const targetCache = this.getCacheForTagType(tagType);
      if (!targetCache) {
        logger.warn(`Unknown tag type: ${tagType}`);
        return;
      }

      // DEFERRED (accepted latent concurrency item): same non-atomic
      // clear-then-refill as loadGenres — a concurrent reader could see a
      // half-rebuilt Map. Mitigated by the single-flight `refreshPromise` so
      // awaited callers never observe the torn state; atomic swap left as-is
      // per maintainer decision.
      targetCache.clear();
      const targetOriginalMap = this.getOriginalCaseMapForTagType(tagType);
      targetOriginalMap?.clear();

      for (const tag of tags) {
        if (tag.id && tag.tagValue) {
          // Store both exact case and lowercase for case-insensitive lookup
          targetCache.set(tag.tagValue, tag.id);
          targetCache.set(tag.tagValue.toLowerCase(), tag.id);
          // Store original case mapping for clean retrieval
          targetOriginalMap?.set(tag.tagValue.toLowerCase(), tag.tagValue);
        }
      }
      
      logger.debug(`Loaded ${targetOriginalMap?.size ?? 0} ${tagType} tags for filtering`);
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
   * Get the appropriate original case mapping for a tag type
   */
  private getOriginalCaseMapForTagType(tagType: string): Map<string, string> | null {
    switch (tagType) {
      case 'media': return this.mediaTypesOriginal;
      case 'releasecountry': return this.countriesOriginal;
      case 'releasetype': return this.releaseTypesOriginal;
      case 'recordlabel': return this.recordLabelsOriginal;
      case 'mood': return this.moodsOriginal;
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
    }
  }

  /**
   * Get the appropriate original case mapping for a filter type
   */
  private getOriginalCaseMapForType(type: FilterType): Map<string, string> {
    switch (type) {
      case 'genres': return this.genresOriginal;
      case 'mediaTypes': return this.mediaTypesOriginal;
      case 'countries': return this.countriesOriginal;
      case 'releaseTypes': return this.releaseTypesOriginal;
      case 'recordLabels': return this.recordLabelsOriginal;
      case 'moods': return this.moodsOriginal;
    }
  }

  /**
   * Resolve a filter name to its ID, with case-insensitive fallback
   */
  resolve(type: FilterType, name: string): string | null {
    if (!this.initialized) {
      throw new Error('FilterCacheManager not initialized');
    }

    // DEFERRED (accepted latent item): when the cache is disabled, resolve()
    // does NOT itself assert freshness — it trusts that callers invoked
    // ensureFresh() first. A freshness assertion here would make staleness
    // impossible to miss, but the single-flight refresh already covers the
    // real call paths; left as-is per maintainer decision.
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

    const originalCaseMap = this.getOriginalCaseMapForType(type);

    // Return the original case values, sorted
    return Array.from(originalCaseMap.values()).sort();
  }

  /**
   * Get all available filter types
   */
  getFilterTypes(): FilterType[] {
    return [...FILTER_TYPES];
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
      genres: this.genresOriginal.size,
      mediaTypes: this.mediaTypesOriginal.size,
      countries: this.countriesOriginal.size,
      releaseTypes: this.releaseTypesOriginal.size,
      recordLabels: this.recordLabelsOriginal.size,
      moods: this.moodsOriginal.size,
    };
  }

  /**
   * Get available filter options for enhanced search functionality.
   * Uses FilterCacheManager to provide text-based filter discovery.
   * When cache is disabled, re-fetches data from Navidrome before returning results.
   */
  async getFilterOptions(args: unknown): Promise<{
    filterType: FilterType;
    available: string[];
    total: number;
  }> {
    try {
      // Validate via Zod: enforces filterType is one of the six valid values and
      // clamps limit to [1,200] with a default of 50. This also closes the
      // limit=0 → slice(0,0) → silently-empty bug (0 is now rejected as < min).
      // Parsing inside the try routes any ZodError through ErrorFormatter below.
      const { filterType, limit } = FilterOptionsSchema.parse(args);

      if (!this.isInitialized()) {
        throw new Error('Filter cache manager not initialized. Please wait for server startup to complete.');
      }

      // Re-fetch data from Navidrome if cache is disabled
      await this.ensureFresh();

      // Get available options for the requested filter type
      const allOptions = this.getAvailableOptions(filterType);
      const limitedOptions = allOptions.slice(0, limit);

      // Cache statistics are intentionally NOT included in the LLM-facing
      // response — they're an internal implementation detail (per-type Map
      // sizes). The data is still observable via DEBUG logging.
      logger.debug(`Retrieved ${limitedOptions.length} ${filterType} options (of ${allOptions.length} total); cache stats: ${JSON.stringify(this.getStats())}`);

      return {
        filterType,
        available: limitedOptions,
        total: allOptions.length,
      };
    } catch (error) {
      throw new Error(ErrorFormatter.toolExecution('get_filter_options', error));
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

    this.genresOriginal.clear();
    this.mediaTypesOriginal.clear();
    this.countriesOriginal.clear();
    this.releaseTypesOriginal.clear();
    this.recordLabelsOriginal.clear();
    this.moodsOriginal.clear();

    this.initialized = false;
    this.cacheEnabled = true;
    this.client = null;
    FilterCacheManager.instance = null;
  }
}

// Export singleton instance getter for convenience
export const filterCacheManager = FilterCacheManager.getInstance();