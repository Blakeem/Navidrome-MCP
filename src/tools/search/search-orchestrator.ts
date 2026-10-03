/**
 * Navidrome MCP Server - Search Orchestration
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
 * Search songs, albums and artists in parallel with one shared set of filters. `transformOptions` lets a
 * non-MCP caller such as the web remote force-keep a field like the numeric duration.
 */
export async function searchAll(client: NavidromeClient, args: unknown, transformOptions: TransformOptions = {}): Promise<{
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  totalArtists: number;
  totalAlbums: number;
  totalSongs: number;
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
    // An unfiltered artist page would be reported as matches for a tag or year filter.
    const fetchArtists = params.artistCount > 0 && !hasArtistUnsupportedFilter(appliedFilters);

    logger.debug('Enhanced search parameters:', {
      songParams: contentTypeParams.songParams,
      albumParams: contentTypeParams.albumParams,
      artistParams: contentTypeParams.artistParams,
      offset: params.offset,
      appliedFilters,
    });

    // A zero count skips its fetch because `_start=N&_end=N` with N > 0 is a SQL error in Navidrome.
    const empty = (): { data: unknown[]; total: null } => ({ data: [], total: null });
    const [songs, albums, artists] = await Promise.all([
      params.songCount > 0
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/song?${contentTypeParams.songParams}`)
        : Promise.resolve(empty()),
      params.albumCount > 0
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/album?${contentTypeParams.albumParams}`)
        : Promise.resolve(empty()),
      fetchArtists
        ? client.requestWithLibraryFilterAndMeta<unknown[]>(`/artist?${contentTypeParams.artistParams}&role=maincredit`)
        : Promise.resolve(empty()),
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
