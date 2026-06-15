/**
 * Navidrome MCP Server - artist filter-strip tests
 * Copyright (C) 2025
 *
 * Pins the fix for two api-contract defects:
 *  - searchAll: buildContentTypeParams must NOT append tag/year filters to the
 *    /api/artist sub-fetch (Navidrome silently ignores them; sending them is a
 *    dead no-op that also makes appliedFilters misleading for the artist slice).
 *  - searchArtists: buildEnhancedSearchParams must neither send tag filters to
 *    /api/artist nor report them in appliedFilters over an unfiltered artist set.
 *
 * These are pure / module-mocked tests — no live server, no real cache.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the filter cache manager so resolveTextFilters resolves text filters to
// deterministic IDs without touching Navidrome.
vi.mock('../../../src/services/filter-cache-manager.js', () => ({
  filterCacheManager: {
    ensureFresh: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn((type: string): string | null => {
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
    findSimilar: vi.fn(() => []),
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
  stripUnsupportedFilters,
} from '../../../src/tools/search/filter-resolver.js';

describe('stripUnsupportedFilters', () => {
  it('drops tag/year keys for the artist endpoint (resolved keys)', () => {
    const resolved = {
      genre_id: 'g', mood_id: 'm', releasecountry_id: 'c',
      releasetype_id: 'rt', recordlabel_id: 'rl', media_id: 'md',
      year: '2000', starred: 'true',
    };
    const out = stripUnsupportedFilters(resolved, 'artist', false);
    expect(out).toEqual({ starred: 'true' });
  });

  it('drops tag/year keys for the artist endpoint (applied display keys)', () => {
    const applied = {
      genre: 'Rock', mood: 'Happy', country: 'US',
      releaseType: 'album', recordLabel: 'Label', mediaType: 'Digital',
      year: '2000',
    };
    const out = stripUnsupportedFilters(applied, 'artist', true);
    expect(out).toEqual({});
  });

  it('passes everything through unchanged for song/album endpoints', () => {
    const resolved = { genre_id: 'g', year: '2000' };
    expect(stripUnsupportedFilters(resolved, 'song', false)).toEqual(resolved);
    expect(stripUnsupportedFilters(resolved, 'album', false)).toEqual(resolved);
  });
});

describe('buildContentTypeParams (searchAll) — artist params', () => {
  it('omits resolved tag filters and year from the artist sub-fetch only', () => {
    const { songParams, albumParams, artistParams } = buildContentTypeParams({
      artistCount: 5,
      albumCount: 5,
      songCount: 5,
      query: '',
      offset: 0,
      resolvedFilters: { genre_id: 'genre-uuid', mood_id: 'mood-uuid' },
      year: 2000,
    });

    // Songs + albums DO carry the filters (Navidrome honors them there).
    expect(songParams).toContain('genre_id=genre-uuid');
    expect(songParams).toContain('year=2000');
    expect(albumParams).toContain('genre_id=genre-uuid');
    expect(albumParams).toContain('year=2000');

    // Artists must NOT carry them — Navidrome ignores them, so they are dead params.
    expect(artistParams).not.toContain('genre_id');
    expect(artistParams).not.toContain('mood_id');
    expect(artistParams).not.toContain('year=2000');
  });
});

describe('buildContentTypeParams (searchAll) — cross-type sort field mapping', () => {
  it("maps sort:'title' to _sort=name for album/artist and _sort=title for song", () => {
    const { songParams, albumParams, artistParams } = buildContentTypeParams({
      artistCount: 5,
      albumCount: 5,
      songCount: 5,
      query: '',
      offset: 0,
      resolvedFilters: {},
      sort: 'title',
    });

    expect(songParams).toContain('_sort=title');
    expect(albumParams).toContain('_sort=name');
    expect(artistParams).toContain('_sort=name');
  });

  it("maps sort:'album' to _sort=name for album/artist and _sort=album for song", () => {
    const { songParams, albumParams, artistParams } = buildContentTypeParams({
      artistCount: 5,
      albumCount: 5,
      songCount: 5,
      query: '',
      offset: 0,
      resolvedFilters: {},
      sort: 'album',
    });

    expect(songParams).toContain('_sort=album');
    expect(albumParams).toContain('_sort=name');
    expect(artistParams).toContain('_sort=name');
  });

  it("maps sort:'year' to _sort=maxYear for album and _sort=year for song", () => {
    const { songParams, albumParams } = buildContentTypeParams({
      artistCount: 5,
      albumCount: 5,
      songCount: 5,
      query: '',
      offset: 0,
      resolvedFilters: {},
      sort: 'year',
    });

    expect(songParams).toContain('_sort=year');
    expect(albumParams).toContain('_sort=maxYear');
  });
});

describe('aggregateSearchResults (searchAll) — per-type appliedFilters truthfulness', () => {
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
      // No `artists` key: /api/artist honors none of these, so the slice
      // must not claim them.
    });
    expect(result.appliedFilters?.artists).toBeUndefined();
  });

  it('reports a shared artist-honored filter (starred) on all three slices', () => {
    const result = aggregateSearchResults(emptyResponses, totals, {
      genre: 'Rock',
      starred: 'true',
    });

    // genre applies to songs/albums only; starred applies everywhere.
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

  it('omits appliedFilters when only artist-unsupported filters were requested and there are no song/album filters left', () => {
    // Edge: every requested filter is artist-unsupported, but it still applies
    // to songs/albums, so those slices report it; artists is omitted.
    const result = aggregateSearchResults(emptyResponses, totals, { genre: 'Rock' });
    expect(result.appliedFilters).toEqual({
      songs: { genre: 'Rock' },
      albums: { genre: 'Rock' },
    });
    expect(result.appliedFilters?.artists).toBeUndefined();
  });
});

describe('buildEnhancedSearchParams (searchArtists) — endpoint=artist', () => {
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

    // No tag IDs in the URL the artist endpoint can't honor.
    expect(searchParams).not.toContain('genre_id');
    expect(searchParams).not.toContain('mood_id');
    // appliedFilters must not claim filters that didn't apply.
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
});
