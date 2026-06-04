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
interface FilterableSearchParams {
  genre?: string | undefined;
  mediaType?: string | undefined;
  country?: string | undefined;
  releaseType?: string | undefined;
  recordLabel?: string | undefined;
  mood?: string | undefined;
  // Single-year filter — Navidrome's REST API has no range filter.
  year?: number | undefined;
  starred?: boolean | undefined;
}

/**
 * Result of filter resolution including both resolved IDs and applied filters for display
 */
interface FilterResolutionResult {
  resolvedFilters: Record<string, string>;
  appliedFilters: Record<string, string>;
}

/**
 * Resolve text-based filters to IDs using FilterCacheManager.
 * When the filter cache is disabled, re-fetches tag/genre data before resolving
 * so that newly-added values are immediately visible.
 *
 * @param params - Search parameters containing text-based filters
 * @returns Object containing both resolved filter IDs and applied filter names
 * @throws Error if a filter value is not found, with suggestions for similar values
 */
export async function resolveTextFilters(params: FilterableSearchParams): Promise<FilterResolutionResult> {
  // Refresh filter data from Navidrome when cache is disabled (no-op when enabled)
  await filterCacheManager.ensureFresh();

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
interface SearchParameterInput extends FilterableSearchParams {
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
interface EnhancedSearchResult {
  searchParams: string;
  appliedFilters: Record<string, string>;
}

/**
 * Which Navidrome endpoint we're building params for. Used to apply
 * endpoint-specific sort-field aliases.
 */
export type SearchEndpoint = 'song' | 'album' | 'artist';

/**
 * Tag/year filters that `/api/artist` silently ignores (no such columns on the
 * artist table). Empirically confirmed against the live server: appending any
 * of these to `/api/artist` leaves X-Total-Count unchanged, so they are no-ops.
 * We use this set to (a) avoid sending dead params to `/api/artist` and (b)
 * avoid reporting them in `appliedFilters` over an unfiltered artist set.
 *
 * The values are the *resolved* URL keys (`genre_id`, …) plus `year`; the
 * matching `appliedFilters` display keys (`genre`, …) are handled separately
 * via {@link ARTIST_UNSUPPORTED_APPLIED_KEYS}.
 */
const ARTIST_UNSUPPORTED_RESOLVED_KEYS: ReadonlySet<string> = new Set([
  'genre_id',
  'media_id',
  'releasecountry_id',
  'releasetype_id',
  'recordlabel_id',
  'mood_id',
  'year',
]);

/**
 * `appliedFilters` display keys that correspond to filters `/api/artist`
 * ignores — the human-readable counterparts of {@link ARTIST_UNSUPPORTED_RESOLVED_KEYS}.
 */
const ARTIST_UNSUPPORTED_APPLIED_KEYS: ReadonlySet<string> = new Set([
  'genre',
  'mediaType',
  'country',
  'releaseType',
  'recordLabel',
  'mood',
  'year',
]);

/**
 * Drop filter keys that the target endpoint silently ignores. Today only
 * `/api/artist` needs this (it honors none of the tag/year filters); song and
 * album pass through unchanged. Returns a new object — the input is not mutated.
 *
 * @param filters - Resolved URL params (`genre_id` → uuid) or applied display
 *   names (`genre` → 'Rock'); pass the matching `applied` flag so the correct
 *   key set is used.
 * @param endpoint - Target Navidrome endpoint.
 * @param applied - `true` when filtering an `appliedFilters` (display-name)
 *   map, `false` when filtering a `resolvedFilters` (URL-param) map.
 */
export function stripUnsupportedFilters(
  filters: Record<string, string>,
  endpoint: SearchEndpoint,
  applied: boolean
): Record<string, string> {
  if (endpoint !== 'artist') return filters;
  const unsupported = applied ? ARTIST_UNSUPPORTED_APPLIED_KEYS : ARTIST_UNSUPPORTED_RESOLVED_KEYS;
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!unsupported.has(key)) kept[key] = value;
  }
  return kept;
}

/**
 * Map a user-facing sort key to the column name Navidrome actually
 * sorts on for the given endpoint. Navidrome's `/api/album` does not
 * have a `year` column (it has `maxYear`/`minYear`), so `_sort=year`
 * is silently ignored there; map it to `maxYear` instead.
 */
export function mapSortField(sort: string, endpoint: SearchEndpoint): string {
  if (endpoint === 'album' && sort === 'year') return 'maxYear';
  return sort;
}

/**
 * Build enhanced search parameters with resolved filters.
 * Combines query parameters, pagination, sorting, and resolved filters into URL parameters.
 *
 * @param params - Search parameters including filters and pagination options
 * @param searchField - The field name to search in (e.g., 'title', 'name')
 * @param defaultSort - Default sort field if none specified
 * @param endpoint - Target Navidrome endpoint (drives sort-field aliasing)
 * @returns Object containing URL search parameters string and applied filters
 */
export async function buildEnhancedSearchParams(
  params: SearchParameterInput,
  searchField: string,
  defaultSort: string,
  endpoint: SearchEndpoint
): Promise<EnhancedSearchResult> {
  // Process text-based filters first (may refresh from Navidrome when cache is disabled)
  const { resolvedFilters: rawResolved, appliedFilters: rawApplied } = await resolveTextFilters(params);

  // Drop filters the endpoint silently ignores (today: tag/year on /api/artist).
  // This stops both sending dead params AND reporting them as applied over an
  // unfiltered result set — see stripUnsupportedFilters.
  const resolvedFilters = stripUnsupportedFilters(rawResolved, endpoint, false);
  const appliedFilters = stripUnsupportedFilters(rawApplied, endpoint, true);

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
  const sortField = mapSortField(params.sort ?? defaultSort, endpoint);
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

  // Single-year filter. Navidrome's /api/album?year=N matches albums whose
  // [minYear, maxYear] contains N; /api/song?year=N matches the exact year
  // column; /api/artist silently ignores it, so don't send it there (and it is
  // already omitted from SearchArtistsSchema).
  if (params.year !== undefined && endpoint !== 'artist') {
    searchParams.set('year', params.year.toString());
  }

  return {
    searchParams: searchParams.toString(),
    appliedFilters
  };
}