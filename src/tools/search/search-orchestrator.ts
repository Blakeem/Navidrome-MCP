/**
 * Navidrome MCP Server - Search Orchestration
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { TransformOptions } from '../../transformers/shared-transformers.js';
import type { SongDTO, AlbumDTO, ArtistDTO } from '../../types/index.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';
import { SearchAllSchema } from '../../schemas/index.js';
import { hasArtistUnsupportedFilter, resolveTextFilters } from './filter-resolver.js';
import {
  buildContentTypeParams,
  aggregateSearchResults,
  type AppliedFiltersByType,
  type ParallelSearchResponses,
  type ParallelSearchTotals,
} from './result-aggregator.js';

/**
 * `transformOptions` lets a non-MCP caller such as the web remote force-keep a field like the
 * numeric duration.
 */
export async function searchAll(client: NavidromeClient, args: unknown, transformOptions: TransformOptions = {}): Promise<{
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  totalArtists?: number;
  totalAlbums?: number;
  totalSongs?: number;
  totalResults: number;
  appliedFilters?: AppliedFiltersByType;
}> {
  try {
    const params = SearchAllSchema.parse(args);
    logger.debug('Tool search_all called with args:', params);

    const { resolvedFilters, appliedFilters } = await resolveTextFilters(params);
    const contentTypeParams = buildContentTypeParams({
      artistCount: params.artistCount,
      albumCount: params.albumCount,
      songCount: params.songCount,
      query: params.query,
      offset: params.offset,
      sort: params.sort,
      order: params.order,
      randomSeed: params.randomSeed,
      resolvedFilters,
      year: params.year,
      starred: params.starred,
    });
    // A zero count skips its fetch. Navidrome answers `_start=N&_end=N` with a SQL error for N > 0
    // and with every row for N = 0.
    const fetchSongs = params.songCount > 0;
    const fetchAlbums = params.albumCount > 0;
    // An unfiltered artist page would be reported as matches for a tag or year filter.
    const fetchArtists = params.artistCount > 0 && !hasArtistUnsupportedFilter(appliedFilters);

    logger.debug('Enhanced search parameters:', {
      songParams: contentTypeParams.songParams,
      albumParams: contentTypeParams.albumParams,
      artistParams: contentTypeParams.artistParams,
      offset: params.offset,
      appliedFilters,
    });

    // A skipped slice has no total, which keeps it apart from a header-absent null.
    const skipped = (): { data: unknown[]; total: undefined } => ({ data: [], total: undefined });
    const [songs, albums, artists] = await Promise.all([
      fetchSongs
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/song?${contentTypeParams.songParams}`)
        : Promise.resolve(skipped()),
      fetchAlbums
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/album?${contentTypeParams.albumParams}`)
        : Promise.resolve(skipped()),
      fetchArtists
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/artist?${contentTypeParams.artistParams}&role=maincredit`)
        : Promise.resolve(skipped()),
    ]);

    const responses: ParallelSearchResponses = {
      songsResponse: songs.data,
      albumsResponse: albums.data,
      artistsResponse: artists.data,
    };
    const totals: ParallelSearchTotals = {
      songsTotal: songs.total,
      albumsTotal: albums.total,
      artistsTotal: artists.total,
    };

    return aggregateSearchResults(responses, totals, appliedFilters, { ...transformOptions, verbose: params.verbose });
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('search_all', error));
  }
}
