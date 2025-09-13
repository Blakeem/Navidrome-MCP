/**
 * Navidrome MCP Server - Search Filter Resolution
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

import { filterCacheManager } from '../../services/filter-cache-manager.js';

/**
 * Interface for search parameters that include filterable fields
 */
export interface FilterableSearchParams {
  genre?: string | undefined;
  mediaType?: string | undefined;
  country?: string | undefined;
  releaseType?: string | undefined;
  recordLabel?: string | undefined;
  mood?: string | undefined;
  yearFrom?: number | undefined;
  yearTo?: number | undefined;
  starred?: boolean | undefined;
}

/**
 * Result of filter resolution including both resolved IDs and applied filters for display
 */
export interface FilterResolutionResult {
  resolvedFilters: Record<string, string>;
  appliedFilters: Record<string, string>;
}

/**
 * Resolve text-based filters to IDs using FilterCacheManager
 * Converts user-friendly filter names to internal UUID-based filters
 *
 * @param params - Search parameters containing text-based filters
 * @returns Object containing both resolved filter IDs and applied filter names
 * @throws Error if a filter value is not found, with suggestions for similar values
 */
export function resolveTextFilters(params: FilterableSearchParams): FilterResolutionResult {
  // Data collection - gather filter parameters
  const resolvedFilters: Record<string, string> = {};
  const appliedFilters: Record<string, string> = {};

  // Process each filter type
  // Genre filter resolution
  if (params.genre !== undefined && params.genre !== '') {
    const genreId = filterCacheManager.resolve('genres', params.genre);
    if (genreId !== null && genreId !== '') {
      resolvedFilters['genre_id'] = genreId;
      appliedFilters['genre'] = params.genre;
    } else {
      const similar = filterCacheManager.findSimilar('genres', params.genre);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Genre '${params.genre}' not found.${suggestion}`);
    }
  }

  // Media type filter resolution
  if (params.mediaType !== undefined && params.mediaType !== '') {
    const mediaId = filterCacheManager.resolve('mediaTypes', params.mediaType);
    if (mediaId !== null && mediaId !== '') {
      resolvedFilters['media_id'] = mediaId;
      appliedFilters['mediaType'] = params.mediaType;
    } else {
      const similar = filterCacheManager.findSimilar('mediaTypes', params.mediaType);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Media type '${params.mediaType}' not found.${suggestion}`);
    }
  }

  // Country filter resolution
  if (params.country !== undefined && params.country !== '') {
    const countryId = filterCacheManager.resolve('countries', params.country);
    if (countryId !== null && countryId !== '') {
      resolvedFilters['releasecountry_id'] = countryId;
      appliedFilters['country'] = params.country;
    } else {
      const similar = filterCacheManager.findSimilar('countries', params.country);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Country '${params.country}' not found.${suggestion}`);
    }
  }

  // Release type filter resolution
  if (params.releaseType !== undefined && params.releaseType !== '') {
    const releaseTypeId = filterCacheManager.resolve('releaseTypes', params.releaseType);
    if (releaseTypeId !== null && releaseTypeId !== '') {
      resolvedFilters['releasetype_id'] = releaseTypeId;
      appliedFilters['releaseType'] = params.releaseType;
    } else {
      const similar = filterCacheManager.findSimilar('releaseTypes', params.releaseType);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Release type '${params.releaseType}' not found.${suggestion}`);
    }
  }

  // Record label filter resolution
  if (params.recordLabel !== undefined && params.recordLabel !== '') {
    const labelId = filterCacheManager.resolve('recordLabels', params.recordLabel);
    if (labelId !== null && labelId !== '') {
      resolvedFilters['recordlabel_id'] = labelId;
      appliedFilters['recordLabel'] = params.recordLabel;
    } else {
      const similar = filterCacheManager.findSimilar('recordLabels', params.recordLabel);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Record label '${params.recordLabel}' not found.${suggestion}`);
    }
  }

  // Mood filter resolution
  if (params.mood !== undefined && params.mood !== '') {
    const moodId = filterCacheManager.resolve('moods', params.mood);
    if (moodId !== null && moodId !== '') {
      resolvedFilters['mood_id'] = moodId;
      appliedFilters['mood'] = params.mood;
    } else {
      const similar = filterCacheManager.findSimilar('moods', params.mood);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
      throw new Error(`Mood '${params.mood}' not found.${suggestion}`);
    }
  }

  return {
    resolvedFilters,
    appliedFilters
  };
}

/**
 * Interface for search parameters that can be converted to URL parameters
 */
export interface SearchParameterInput extends FilterableSearchParams {
  query: string;
  limit: number;
  offset?: number;
  sort?: string | undefined;
  order?: 'ASC' | 'DESC' | undefined;
  randomSeed?: number | undefined;
}

/**
 * Result of building enhanced search parameters
 */
export interface EnhancedSearchResult {
  searchParams: string;
  appliedFilters: Record<string, string>;
}

/**
 * Build enhanced search parameters with resolved filters
 * Combines query parameters, pagination, sorting, and resolved filters into URL parameters
 *
 * @param params - Search parameters including filters and pagination options
 * @param searchField - The field name to search in (e.g., 'title', 'name')
 * @param defaultSort - Default sort field if none specified
 * @returns Object containing URL search parameters string and applied filters
 */
export function buildEnhancedSearchParams(
  params: SearchParameterInput,
  searchField: string,
  defaultSort: string
): EnhancedSearchResult {
  // Process text-based filters first
  const { resolvedFilters, appliedFilters } = resolveTextFilters(params);

  // Build URLSearchParams for API request
  const searchParams = new URLSearchParams();

  // Add pagination with offset support
  const offset = params.offset ?? 0;
  searchParams.set('_start', offset.toString());
  searchParams.set('_end', (offset + params.limit).toString());

  // Add search term as direct parameter (only if not empty)
  if (params.query && params.query.trim() !== '') {
    searchParams.set(searchField, params.query);
  }

  // Add sorting parameters
  const sortField = params.sort ?? defaultSort;
  searchParams.set('_sort', sortField);
  searchParams.set('_order', params.order ?? 'ASC');

  // Add random seed if using random sort
  if (sortField === 'random' && params.randomSeed !== undefined) {
    searchParams.set('seed', params.randomSeed.toString());
  }

  // Add all resolved filters to URL parameters
  Object.entries(resolvedFilters).forEach(([key, value]) => {
    searchParams.set(key, value);
  });

  // Add boolean filters
  if (params.starred !== undefined) {
    searchParams.set('starred', params.starred.toString());
  }

  // Add year filtering for time-based searches
  if (params.yearFrom !== undefined) {
    searchParams.set('year_from', params.yearFrom.toString());
  }
  if (params.yearTo !== undefined) {
    searchParams.set('year_to', params.yearTo.toString());
  }

  return {
    searchParams: searchParams.toString(),
    appliedFilters
  };
}