/**
 * Navidrome MCP Server - Filter Cache Manager Service
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { FilterOptionsSchema } from '../schemas/index.js';
import { transformTagsToMeta } from '../transformers/index.js';

const FILTER_TYPES = FilterOptionsSchema.shape.filterType.options;

export type FilterType = (typeof FILTER_TYPES)[number];

// Case-insensitive, so "Accession Records" sorts beside "ATO Records", not after every capital.
const FILTER_OPTION_ORDER = new Intl.Collator(undefined, { sensitivity: 'base' });

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

/** Resolves text filter values, such as a genre name, to the tag UUIDs Navidrome filters by. */
class FilterCacheManager {
  private static instance: FilterCacheManager | null = null;

  private readonly filterSets = createFilterSets();

  private initialized = false;
  private cacheEnabled = true;
  private client: NavidromeClient | null = null;
  // Shared by concurrent callers, so a burst of resolves triggers one fetch.
  private refreshPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): FilterCacheManager {
    FilterCacheManager.instance ??= new FilterCacheManager();
    return FilterCacheManager.instance;
  }

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
   * With filterCacheEnabled=false it re-fetches, so newly added tag values are visible.
   * Every caller waits for an in-flight refresh, such as one started by reload().
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

  /** The maps hold only the values of the libraries active when they loaded. */
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

  /** A failed or invalid fetch keeps the previous values and never blocks another filter type. */
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

    return Array.from(this.filterSets[type].originals.values()).sort((a, b) => FILTER_OPTION_ORDER.compare(a, b));
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
