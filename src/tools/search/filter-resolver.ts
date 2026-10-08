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

import { filterCacheManager, type FilterType } from '../../services/filter-cache-manager.js';

interface FilterableSearchParams {
  genre?: string | undefined;
  mediaType?: string | undefined;
  country?: string | undefined;
  releaseType?: string | undefined;
  recordLabel?: string | undefined;
  mood?: string | undefined;
  year?: number | undefined;
  starred?: boolean | undefined;
}

interface FilterResolutionResult {
  resolvedFilters: Record<string, string>;
  appliedFilters: Record<string, string>;
}

type TagFilterParam = 'genre' | 'mediaType' | 'country' | 'releaseType' | 'recordLabel' | 'mood';

interface TagFilter {
  param: TagFilterParam;
  cacheCategory: FilterType;
  urlKey: string;
  displayKey: string;
  label: string;
  artistSupported: boolean;
  // Replaces the "Did you mean" suggestion where substring matching misleads.
  notFoundHint?: string;
}

// Navidrome filters non-genre tags only by the bare tag name. It ignores `media_id`-style keys.
const TAG_FILTERS: readonly TagFilter[] = [
  { param: 'genre', cacheCategory: 'genres', urlKey: 'genre_id', displayKey: 'genre', label: 'Genre', artistSupported: false },
  { param: 'mediaType', cacheCategory: 'mediaTypes', urlKey: 'media', displayKey: 'mediaType', label: 'Media type', artistSupported: false },
  {
    param: 'country',
    cacheCategory: 'countries',
    urlKey: 'releasecountry',
    displayKey: 'country',
    label: 'Country',
    artistSupported: false,
    // Country names contain unrelated two-letter codes, so a substring suggestion points at the wrong country.
    notFoundHint: 'Use an ISO 3166-1 alpha-2 code such as US, GB or DE. Call get_filter_options with filterType "countries" to list the codes in this library.',
  },
  { param: 'releaseType', cacheCategory: 'releaseTypes', urlKey: 'releasetype', displayKey: 'releaseType', label: 'Release type', artistSupported: false },
  { param: 'recordLabel', cacheCategory: 'recordLabels', urlKey: 'recordlabel', displayKey: 'recordLabel', label: 'Record label', artistSupported: false },
  { param: 'mood', cacheCategory: 'moods', urlKey: 'mood', displayKey: 'mood', label: 'Mood', artistSupported: false },
];

// /api/artist has no tag or year columns and ignores those params, so they are neither sent nor reported there.
const ARTIST_UNSUPPORTED_URL_KEYS: ReadonlySet<string> = new Set(
  TAG_FILTERS.filter(filter => !filter.artistSupported).map(filter => filter.urlKey),
);
const ARTIST_UNSUPPORTED_APPLIED_KEYS: ReadonlySet<string> = new Set([
  ...TAG_FILTERS.filter(filter => !filter.artistSupported).map(filter => filter.displayKey),
  'year',
]);

function describeNotFound(filter: TagFilter, value: string): string {
  if (filter.notFoundHint !== undefined) {
    return ` ${filter.notFoundHint}`;
  }
  const similar = filterCacheManager.findSimilar(filter.cacheCategory, value);
  const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
  return `${suggestion} Call get_filter_options with filterType "${filter.cacheCategory}" to list the values in this library.`;
}

function resolveTagFilter(filter: TagFilter, value: string): string {
  const id = filterCacheManager.resolve(filter.cacheCategory, value);
  if (id !== null && id !== '') {
    return id;
  }
  throw new Error(`${filter.label} '${value}' not found.${describeNotFound(filter, value)}`);
}

/**
 * Resolve text filters to Navidrome tag IDs and collect every requested filter for display.
 * @throws Error naming the filter value when it is absent from the active libraries
 */
export async function resolveTextFilters(params: FilterableSearchParams): Promise<FilterResolutionResult> {
  const resolvedFilters: Record<string, string> = {};
  const appliedFilters: Record<string, string> = {};
  const requestedTags = TAG_FILTERS.flatMap((filter) => {
    const value = params[filter.param];
    return value === undefined || value === '' ? [] : [{ filter, value }];
  });

  // Only a tag filter reads the tag maps, so a search without one skips the refresh.
  if (requestedTags.length > 0) {
    await filterCacheManager.ensureFresh();
  }
  for (const { filter, value } of requestedTags) {
    resolvedFilters[filter.urlKey] = resolveTagFilter(filter, value);
    appliedFilters[filter.displayKey] = value;
  }
  if (params.year !== undefined) {
    appliedFilters['year'] = String(params.year);
  }
  if (params.starred !== undefined) {
    appliedFilters['starred'] = String(params.starred);
  }

  return { resolvedFilters, appliedFilters };
}

interface SearchParameterInput extends FilterableSearchParams {
  query: string;
  limit: number;
  offset?: number;
  sort?: string | undefined;
  order?: 'ASC' | 'DESC' | undefined;
  randomSeed?: number | undefined;
}

interface EnhancedSearchResult {
  searchParams: string;
  appliedFilters: Record<string, string>;
}

export type SearchEndpoint = 'song' | 'album' | 'artist';

function withoutArtistUnsupported(
  filters: Record<string, string>,
  endpoint: SearchEndpoint,
  unsupported: ReadonlySet<string>,
): Record<string, string> {
  if (endpoint !== 'artist') {
    return { ...filters };
  }
  return Object.fromEntries(Object.entries(filters).filter(([key]) => !unsupported.has(key)));
}

/** Copy of resolved URL params without the ones the endpoint ignores. */
export function stripUnsupportedUrlParams(filters: Record<string, string>, endpoint: SearchEndpoint): Record<string, string> {
  return withoutArtistUnsupported(filters, endpoint, ARTIST_UNSUPPORTED_URL_KEYS);
}

/** Copy of an appliedFilters map without the filters the endpoint ignores. */
export function stripUnsupportedAppliedFilters(filters: Record<string, string>, endpoint: SearchEndpoint): Record<string, string> {
  return withoutArtistUnsupported(filters, endpoint, ARTIST_UNSUPPORTED_APPLIED_KEYS);
}

export function hasArtistUnsupportedFilter(appliedFilters: Record<string, string>): boolean {
  return Object.keys(appliedFilters).some(key => ARTIST_UNSUPPORTED_APPLIED_KEYS.has(key));
}

/** /api/album has no `year` column and ignores `_sort=year`, so it sorts on `maxYear`. */
export function mapSortField(sort: string, endpoint: SearchEndpoint): string {
  if (endpoint === 'album' && sort === 'year') return 'maxYear';
  return sort;
}

interface SearchUrlInput {
  endpoint: SearchEndpoint;
  searchField: string;
  query: string;
  offset: number;
  limit: number;
  sortField: string;
  order?: 'ASC' | 'DESC' | undefined;
  randomSeed?: number | undefined;
  resolvedFilters: Record<string, string>;
  starred?: boolean | undefined;
  year?: number | undefined;
}

export function buildSearchUrlParams(input: SearchUrlInput): string {
  const searchParams = new URLSearchParams();

  searchParams.set('_start', input.offset.toString());
  searchParams.set('_end', (input.offset + input.limit).toString());
  if (input.query.trim() !== '') {
    searchParams.set(input.searchField, input.query);
  }
  searchParams.set('_sort', input.sortField);
  searchParams.set('_order', input.order ?? 'ASC');
  if (input.sortField === 'random' && input.randomSeed !== undefined) {
    searchParams.set('seed', input.randomSeed.toString());
  }
  for (const [key, value] of Object.entries(stripUnsupportedUrlParams(input.resolvedFilters, input.endpoint))) {
    searchParams.set(key, value);
  }
  if (input.starred !== undefined) {
    searchParams.set('starred', input.starred.toString());
  }
  // Songs match the exact year. Albums match when [minYear, maxYear] contains it.
  if (input.year !== undefined && input.endpoint !== 'artist') {
    searchParams.set('year', input.year.toString());
  }

  return searchParams.toString();
}

export async function buildEnhancedSearchParams(
  params: SearchParameterInput,
  searchField: string,
  defaultSort: string,
  endpoint: SearchEndpoint
): Promise<EnhancedSearchResult> {
  const { resolvedFilters, appliedFilters } = await resolveTextFilters(params);

  const searchParams = buildSearchUrlParams({
    endpoint,
    searchField,
    query: params.query,
    offset: params.offset ?? 0,
    limit: params.limit,
    sortField: mapSortField(params.sort ?? defaultSort, endpoint),
    order: params.order,
    randomSeed: params.randomSeed,
    resolvedFilters,
    starred: params.starred,
    year: params.year,
  });

  return {
    searchParams,
    appliedFilters: stripUnsupportedAppliedFilters(appliedFilters, endpoint),
  };
}
