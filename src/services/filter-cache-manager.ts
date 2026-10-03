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
import { FilterOptionsSchema } from '../schemas/index.js';
import { transformTagsToMeta } from '../transformers/index.js';

const FILTER_TYPES = FilterOptionsSchema.shape.filterType.options;

export type FilterType = (typeof FILTER_TYPES)[number];

// The /api/tag tag_name each filter type loads from.
const TAG_NAMES: Record<FilterType, string> = {
  genres: 'genre',
  mediaTypes: 'media',
  countries: 'releasecountry',
  releaseTypes: 'releasetype',
  recordLabels: 'recordlabel',
  moods: 'mood',
};

interface FilterSet {
  tagName: string;
  // Exact and lowercase value to UUID, so resolve() matches case-insensitively.
  ids: Map<string, string>;
  // Lowercase value to original case, so listings show each value once.
  originals: Map<string, string>;
}

interface FilterValue {
  id: string;
  value: string;
}

function createFilterSets(): Record<FilterType, FilterSet> {
  return Object.fromEntries(
    FILTER_TYPES.map(type => [type, { tagName: TAG_NAMES[type], ids: new Map<string, string>(), originals: new Map<string, string>() }]),
  ) as Record<FilterType, FilterSet>;
}

/**
 * Singleton service for managing filter option caches for enhanced search functionality.
 * Caches small, well-defined filter sets for text-based filtering.
 *
 * When filterCacheEnabled=false the Maps are still used as a working buffer, but
 * ensureFresh() re-fetches all tag data before every resolve operation so
 * newly-added values are always visible.
 */
class FilterCacheManager {
  private static instance: FilterCacheManager | null = null;

  private readonly filterSets = createFilterSets();

  private initialized = false;
  private cacheEnabled = true;
  private client: NavidromeClient | null = null;
  // Concurrent callers share one refresh. Loaders clear and refill the Maps non-atomically,
  // so a reader is safe only behind this single-flight.
  private refreshPromise: Promise<void> | null = null;

  private constructor() {}

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
    this.client = client;
    this.cacheEnabled = config.filterCacheEnabled;

    if (this.initialized && this.cacheEnabled) {
      logger.debug('FilterCacheManager already initialized');
      return;
    }

    if (!this.cacheEnabled) {
      logger.info('FilterCacheManager cache disabled (settings.json library.filterCacheEnabled=false, or NAVIDROME_FILTER_CACHE_ENABLED=false without a store). Filter data is refreshed on every resolve call.');
    }

    await this.fetchAllData(client);
    this.initialized = true;
  }

  private async fetchAllData(client: NavidromeClient): Promise<void> {
    await Promise.all(FILTER_TYPES.map(type => this.loadFilterSet(client, type)));

    const stats = this.getStats();
    const totalFilters = Object.values(stats).reduce((sum, count) => sum + count, 0);
    const countsSummary = Object.entries(stats).map(([type, count]) => `${type}=${count}`).join(', ');

    if (totalFilters === 0) {
      logger.warn('FilterCacheManager loaded 0 filter options. Navidrome may be unreachable or the library has no tags. With the cache enabled, filter-based search stays empty until the server restarts.');
    }

    logger.info(`FilterCacheManager loaded ${totalFilters} filter options across ${FILTER_TYPES.length} types`);
    logger.debug(`Filter counts: ${countsSummary}`);
  }

  /**
   * Called before every resolve. With filterCacheEnabled=false it re-fetches so newly
   * added genres, labels and moods are visible. Every caller waits for an in-flight refresh.
   */
  async ensureFresh(): Promise<void> {
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }
    if (this.cacheEnabled) {
      return;
    }
    const client = this.requireClient();
    logger.debug('FilterCacheManager cache disabled. Refreshing filter data before resolve.');
    return this.startRefresh(client);
  }

  /**
   * Re-fetch all filter data for the libraries active now. The maps hold only
   * the values of the libraries that were active when they loaded.
   */
  async reload(): Promise<void> {
    const client = this.requireClient();
    while (this.refreshPromise !== null) {
      await this.refreshPromise;
    }
    return this.startRefresh(client);
  }

  private requireClient(): NavidromeClient {
    if (this.client === null) {
      throw new Error('FilterCacheManager not initialized. Call initialize() first.');
    }
    return this.client;
  }

  private startRefresh(client: NavidromeClient): Promise<void> {
    this.refreshPromise = this.fetchAllData(client).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  /**
   * Load one filter type into its Maps. A failed or invalid fetch keeps the
   * previous values and never blocks the other filter types.
   */
  private async loadFilterSet(client: NavidromeClient, type: FilterType): Promise<void> {
    const set = this.filterSets[type];
    try {
      const values = await this.fetchTags(client, set.tagName);
      if (values === null) {
        return;
      }

      set.ids.clear();
      set.originals.clear();
      for (const { id, value } of values) {
        if (id && value) {
          set.ids.set(value, id);
          set.ids.set(value.toLowerCase(), id);
          set.originals.set(value.toLowerCase(), value);
        }
      }

      logger.debug(`Loaded ${set.originals.size} ${type} values for filtering`);
    } catch (error) {
      logger.error(`Failed to load ${type} filter values:`, error instanceof Error ? error.message : String(error));
    }
  }

  private async fetchTags(client: NavidromeClient, tagName: string): Promise<FilterValue[] | null> {
    // /api/tag returns the full set when no _end is given.
    const tags = await client.requestWithLibraryFilter<unknown>(`/tag?tag_name=${encodeURIComponent(tagName)}`);
    if (!Array.isArray(tags)) {
      logger.warn(`Invalid tags response for ${tagName}, skipping`);
      return null;
    }
    return transformTagsToMeta(tags).map((entry) => ({ id: entry.id, value: entry.tag.tagValue }));
  }

  resolve(type: FilterType, name: string): string | null {
    if (!this.initialized) {
      throw new Error('FilterCacheManager not initialized');
    }

    const ids = this.filterSets[type].ids;
    return ids.get(name) ?? ids.get(name.toLowerCase()) ?? null;
  }

  getAvailableOptions(type: FilterType): string[] {
    if (!this.initialized) {
      throw new Error('FilterCacheManager not initialized');
    }

    return Array.from(this.filterSets[type].originals.values()).sort();
  }

  /** Feeds "did you mean?" suggestions. */
  findSimilar(type: FilterType, name: string, maxResults = 3): string[] {
    if (!this.initialized) {
      throw new Error('FilterCacheManager not initialized');
    }

    const options = this.getAvailableOptions(type);
    const lowerName = name.toLowerCase();

    const similar = options
      .filter(option => {
        const lowerOption = option.toLowerCase();
        return lowerOption.includes(lowerName) || lowerName.includes(lowerOption);
      })
      .slice(0, maxResults);

    return similar;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getStats(): Record<FilterType, number> {
    return Object.fromEntries(
      FILTER_TYPES.map(type => [type, this.filterSets[type].originals.size]),
    ) as Record<FilterType, number>;
  }

  /** Test isolation only. */
  reset(): void {
    for (const set of Object.values(this.filterSets)) {
      set.ids.clear();
      set.originals.clear();
    }

    this.initialized = false;
    this.cacheEnabled = true;
    this.client = null;
    FilterCacheManager.instance = null;
  }
}

export const filterCacheManager = FilterCacheManager.getInstance();
