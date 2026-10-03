/**
 * Navidrome MCP Server - artist filter-strip tests
 * Copyright (C) 2025
 *
 * /api/artist ignores tag and year filters. These tests pin that:
 *  - searchAll never sends them to the artist sub-fetch, and skips that fetch when one is set.
 *  - search_artists rejects them at parse instead of returning unfiltered artists.
 *  - appliedFilters only claims the filters each slice honored.
 *
 * These are pure / module-mocked tests. No live server, no real cache.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the filter cache manager so resolveTextFilters resolves text filters to
// deterministic IDs without touching Navidrome.
const { resolveMock } = vi.hoisted(() => ({
  resolveMock: vi.fn((type: string): string | null => {
    // Return a stable fake UUID per filter type.
    const map: Record<string, string> = {
      genres: 'genre-uuid',
      moods: 'mood-uuid',
      countries: 'country-uuid',
      releaseTypes: 'releasetype-uuid',
      recordLabels: 'recordlabel-uuid',
      mediaTypes: 'media-uuid',
    };
    return map[type] ?? null;
  }),
}));

vi.mock('../../../src/services/filter-cache-manager.js', () => ({
  filterCacheManager: {
    ensureFresh: vi.fn().mockResolvedValue(undefined),
    resolve: resolveMock,
    findSimilar: vi.fn(() => ['IT', 'AT', 'ES']),
  },
}));

import {
  aggregateSearchResults,
  buildContentTypeParams,
  type ParallelSearchResponses,
  type ParallelSearchTotals,
} from '../../../src/tools/search/result-aggregator.js';
import {
  buildEnhancedSearchParams,
  resolveTextFilters,
  stripUnsupportedAppliedFilters,
  stripUnsupportedUrlParams,
} from '../../../src/tools/search/filter-resolver.js';
import { searchAll } from '../../../src/tools/search/search-orchestrator.js';
import { searchArtists } from '../../../src/tools/search/single-type-search.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

describe('stripUnsupportedUrlParams / stripUnsupportedAppliedFilters', () => {
  it('drops tag keys for the artist endpoint (URL params)', () => {
    const resolved = {
      genre_id: 'g', mood: 'm', releasecountry: 'c',
      releasetype: 'rt', recordlabel: 'rl', media: 'md',
      starred: 'true',
    };
    expect(stripUnsupportedUrlParams(resolved, 'artist')).toEqual({ starred: 'true' });
  });

  it('drops tag and year keys for the artist endpoint (applied display keys)', () => {
    const applied = {
      genre: 'Rock', mood: 'Happy', country: 'US',
      releaseType: 'album', recordLabel: 'Label', mediaType: 'Digital',
      year: '2000', starred: 'true',
    };
    expect(stripUnsupportedAppliedFilters(applied, 'artist')).toEqual({ starred: 'true' });
  });

  it('returns an equal copy, never the input, for song/album endpoints', () => {
    const resolved = { genre_id: 'g' };
    const applied = { genre: 'Rock', year: '2000' };

    for (const endpoint of ['song', 'album'] as const) {
      const urlOut = stripUnsupportedUrlParams(resolved, endpoint);
      const appliedOut = stripUnsupportedAppliedFilters(applied, endpoint);
      expect(urlOut).toEqual(resolved);
      expect(urlOut).not.toBe(resolved);
      expect(appliedOut).toEqual(applied);
      expect(appliedOut).not.toBe(applied);
    }
  });
});

describe('buildContentTypeParams (searchAll) - artist params', () => {
  it('omits resolved tag filters and year from the artist sub-fetch only', () => {
    const { songParams, albumParams, artistParams } = buildContentTypeParams({
      artistCount: 5,
      albumCount: 5,
      songCount: 5,
      query: '',
      offset: 0,
      resolvedFilters: { genre_id: 'genre-uuid', mood: 'mood-uuid' },
      year: 2000,
    });

    expect(songParams).toContain('genre_id=genre-uuid');
    expect(songParams).toContain('year=2000');
    expect(albumParams).toContain('genre_id=genre-uuid');
    expect(albumParams).toContain('year=2000');

    expect(artistParams).not.toContain('genre_id');
    expect(artistParams).not.toContain('mood=');
    expect(artistParams).not.toContain('year=2000');
  });
});

describe('buildContentTypeParams (searchAll) - cross-type sort field mapping', () => {
  const sortParams = (sort: string): ReturnType<typeof buildContentTypeParams> => buildContentTypeParams({
    artistCount: 5,
    albumCount: 5,
    songCount: 5,
    query: '',
    offset: 0,
    resolvedFilters: {},
    sort,
  });

  it("maps sort:'title' to _sort=name for album/artist and _sort=title for song", () => {
    const { songParams, albumParams, artistParams } = sortParams('title');
    expect(songParams).toContain('_sort=title');
    expect(albumParams).toContain('_sort=name');
    expect(artistParams).toContain('_sort=name');
  });

  it("maps sort:'album' to _sort=name for album/artist and _sort=album for song", () => {
    const { songParams, albumParams, artistParams } = sortParams('album');
    expect(songParams).toContain('_sort=album');
    expect(albumParams).toContain('_sort=name');
    expect(artistParams).toContain('_sort=name');
  });

  it("maps sort:'year' to _sort=maxYear for album and _sort=year for song", () => {
    const { songParams, albumParams } = sortParams('year');
    expect(songParams).toContain('_sort=year');
    expect(albumParams).toContain('_sort=maxYear');
  });

  it.each(['year', 'duration', 'artist', 'recently_added'])(
    "falls back to _sort=name on the artist endpoint for sort:'%s'",
    (sort) => {
      const { artistParams } = sortParams(sort);
      expect(artistParams).toContain('_sort=name');
    },
  );

  it('keeps artist-supported sort keys on the artist endpoint', () => {
    expect(sortParams('playCount').artistParams).toContain('_sort=playCount');
  });
});

describe('aggregateSearchResults (searchAll) - per-type appliedFilters truthfulness', () => {
  const emptyResponses: ParallelSearchResponses = {
    songsResponse: [],
    albumsResponse: [],
    artistsResponse: [],
  };
  const totals: ParallelSearchTotals = { songsTotal: 0, albumsTotal: 0, artistsTotal: 0 };

  it('reports tag/year on songs+albums but NOT on artists', () => {
    const result = aggregateSearchResults(emptyResponses, totals, {
      genre: 'Rock',
      mood: 'Happy',
      year: '2000',
    });

    expect(result.appliedFilters).toEqual({
      songs: { genre: 'Rock', mood: 'Happy', year: '2000' },
      albums: { genre: 'Rock', mood: 'Happy', year: '2000' },
    });
    expect(result.appliedFilters?.artists).toBeUndefined();
  });

  it('reports a shared artist-honored filter (starred) on all three slices', () => {
    const result = aggregateSearchResults(emptyResponses, totals, {
      genre: 'Rock',
      starred: 'true',
    });

    expect(result.appliedFilters).toEqual({
      songs: { genre: 'Rock', starred: 'true' },
      albums: { genre: 'Rock', starred: 'true' },
      artists: { starred: 'true' },
    });
  });

  it('omits appliedFilters entirely when nothing was applied', () => {
    const result = aggregateSearchResults(emptyResponses, totals, {});
    expect(result.appliedFilters).toBeUndefined();
  });

  it('gives each slice its own appliedFilters object', () => {
    const result = aggregateSearchResults(emptyResponses, totals, { starred: 'true' });
    expect(result.appliedFilters?.songs).not.toBe(result.appliedFilters?.albums);
    expect(result.appliedFilters?.songs).not.toBe(result.appliedFilters?.artists);
  });
});

describe('searchAll - artist slice under tag/year filters', () => {
  let requestMock: ReturnType<typeof vi.fn>;
  let client: NavidromeClient;

  beforeEach(() => {
    requestMock = vi.fn().mockResolvedValue({ data: [], total: 7 });
    client = { requestWithLibraryFilterAndMeta: requestMock } as unknown as NavidromeClient;
  });

  const requestedPaths = (): string[] => requestMock.mock.calls.map(call => String(call[0]));

  it('folds year+starred into the per-type appliedFilters map', async () => {
    const result = await searchAll(client, { query: '', year: 2000, starred: true });

    expect(result.appliedFilters).toEqual({
      songs: { year: '2000', starred: 'true' },
      albums: { year: '2000', starred: 'true' },
      artists: { starred: 'true' },
    });
  });

  it.each([
    ['genre', { genre: 'Rock' }],
    ['year', { year: 2000 }],
  ])('skips the artist fetch and counts no artists when a %s filter is set', async (_label, filter) => {
    const result = await searchAll(client, { query: '', ...filter });

    expect(requestedPaths().some(path => path.startsWith('/artist'))).toBe(false);
    expect(result.artists).toEqual([]);
    expect(result.totalArtists).toBe(0);
    expect(result.totalResults).toBe(14);
  });

  it('still fetches artists when only artist-honored filters are set', async () => {
    const result = await searchAll(client, { query: '', starred: true });

    expect(requestedPaths().some(path => path.startsWith('/artist'))).toBe(true);
    expect(result.totalArtists).toBe(7);
  });

  it('names search_all in a wrapped failure', async () => {
    requestMock.mockRejectedValue(new Error('boom'));
    await expect(searchAll(client, { query: '' })).rejects.toThrow(/search_all/);
  });
});

describe('search_artists - tag and year filters are rejected', () => {
  const client = {
    requestWithLibraryFilterAndMeta: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as NavidromeClient;

  it.each([
    ['genre', 'Rock'],
    ['mediaType', 'CD'],
    ['country', 'US'],
    ['releaseType', 'album'],
    ['recordLabel', 'Label'],
    ['mood', 'Happy'],
    ['year', 2000],
  ])('rejects %s with a pointer to the tag-filtered tools', async (field, value) => {
    await expect(searchArtists(client, { [field]: value }))
      .rejects.toThrow(/search_artists.*search_albums or search_songs.*list_tag_values/s);
  });

  it('still accepts starred', async () => {
    await expect(searchArtists(client, { starred: true })).resolves.toHaveProperty('artists');
  });
});

describe('buildEnhancedSearchParams - endpoint-specific filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not send tag filters to /api/artist and does not report them as applied', async () => {
    const { searchParams, appliedFilters } = await buildEnhancedSearchParams(
      { query: '', limit: 10, genre: 'Rock', mood: 'Happy' },
      'name',
      'name',
      'artist'
    );

    expect(searchParams).not.toContain('genre_id');
    expect(searchParams).not.toContain('mood=');
    expect(appliedFilters).toEqual({});
  });

  it('still resolves + reports tag filters for the song/album endpoints', async () => {
    const { searchParams, appliedFilters } = await buildEnhancedSearchParams(
      { query: '', limit: 10, genre: 'Rock' },
      'name',
      'name',
      'album'
    );

    expect(searchParams).toContain('genre_id=genre-uuid');
    expect(appliedFilters).toEqual({ genre: 'Rock' });
  });

  it('sends non-genre tag UUIDs under the bare tag name, the only form /api/album and /api/song filter on', async () => {
    const { searchParams } = await buildEnhancedSearchParams(
      { query: '', limit: 10, mediaType: 'CD', country: 'US', releaseType: 'ep', recordLabel: 'Label', mood: 'Happy' },
      'name',
      'name',
      'album'
    );
    const params = new URLSearchParams(searchParams);

    expect(params.get('media')).toBe('media-uuid');
    expect(params.get('releasecountry')).toBe('country-uuid');
    expect(params.get('releasetype')).toBe('releasetype-uuid');
    expect(params.get('recordlabel')).toBe('recordlabel-uuid');
    expect(params.get('mood')).toBe('mood-uuid');
    expect(searchParams).not.toMatch(/(media|releasecountry|releasetype|recordlabel|mood)_id=/);
  });

  it('reports year and starred for a single-type song search, as search_all does', async () => {
    const { searchParams, appliedFilters } = await buildEnhancedSearchParams(
      { query: '', limit: 10, year: 1999, starred: true },
      'title',
      'title',
      'song'
    );

    expect(searchParams).toContain('year=1999');
    expect(searchParams).toContain('starred=true');
    expect(appliedFilters).toEqual({ year: '1999', starred: 'true' });
  });
});

describe('resolveTextFilters - not-found messages', () => {
  it('asks for an ISO code instead of suggesting substring matches for an unknown country', async () => {
    resolveMock.mockReturnValueOnce(null);

    const failure = resolveTextFilters({ country: 'United States' });

    await expect(failure).rejects.toThrow(
      "Country 'United States' not found. Use an ISO 3166-1 alpha-2 code such as US, GB or DE. Call get_filter_options with filterType \"countries\" to list the codes in this library.",
    );
  });

  it('keeps the did-you-mean suggestion for other filters', async () => {
    resolveMock.mockReturnValueOnce(null);

    await expect(resolveTextFilters({ genre: 'Rok' })).rejects.toThrow("Genre 'Rok' not found. Did you mean: IT, AT, ES?");
  });
});
