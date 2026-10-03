/**
 * Navidrome MCP Server - Tag Management Tools
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
import type {
  TagDTO,
  TagDistributionResponse,
  TagDistribution
} from '../types/index.js';
import {
  FilterOptionsSchema,
  ListTagValuesSchema,
  TagDistributionSchema,
} from '../schemas/index.js';
import { filterCacheManager, type FilterType } from '../services/filter-cache-manager.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

interface ListTagValuesResult {
  matches: TagDTO[];
  total: number;
}

interface GetFilterOptionsResult {
  filterType: FilterType;
  available: string[];
  total: number;
}

type GetTagDistributionResult = TagDistributionResponse;

/** /api/tag returns albumCount and songCount only for genre, so other tag names need a backfill. */
interface TagWithMeta {
  tag: TagDTO;
  countsProvided: boolean;
}

/**
 * Transform raw Navidrome tag data to clean DTO. Returns a `TagWithMeta` so
 * the caller knows whether the API supplied counts (genre) or whether they
 * need a backfill (everything else).
 */
function transformTagToMeta(rawTag: unknown): TagWithMeta {
  if (typeof rawTag !== 'object' || rawTag === null) {
    throw new Error('Invalid tag data received from Navidrome');
  }

  const tag = rawTag as Record<string, unknown>;
  const albumCountRaw = tag['albumCount'];
  const songCountRaw = tag['songCount'];
  const countsProvided =
    (typeof albumCountRaw === 'number' && Number.isFinite(albumCountRaw)) ||
    (typeof songCountRaw === 'number' && Number.isFinite(songCountRaw));

  const idRaw = tag['id'];
  const tagNameRaw = tag['tagName'];
  const tagValueRaw = tag['tagValue'];
  return {
    tag: {
      id: typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '',
      tagName: typeof tagNameRaw === 'string' || typeof tagNameRaw === 'number' ? String(tagNameRaw) : '',
      tagValue: typeof tagValueRaw === 'string' || typeof tagValueRaw === 'number' ? String(tagValueRaw) : '',
      albumCount: Number(albumCountRaw) || 0,
      songCount: Number(songCountRaw) || 0,
    },
    countsProvided,
  };
}

/**
 * Transform array of raw tags to TagWithMeta entries.
 */
function transformTagsToMeta(rawTags: unknown): TagWithMeta[] {
  if (!Array.isArray(rawTags)) {
    throw new Error('Expected array of tags from Navidrome');
  }

  return rawTags.map(transformTagToMeta);
}

/** Bounds outbound connections to Navidrome, since each backfilled entry issues two requests. */
const BACKFILL_CONCURRENCY = 8;

/** Filter keys are lowercased tag names (releasetype=ep), the form Navidrome's frontend sends. */
async function backfillTagCounts(
  client: NavidromeClient,
  entries: TagWithMeta[],
): Promise<void> {
  const needsBackfill = entries.filter((entry) => !entry.countsProvided);
  if (needsBackfill.length === 0) {
    return;
  }

  for (let i = 0; i < needsBackfill.length; i += BACKFILL_CONCURRENCY) {
    const chunk = needsBackfill.slice(i, i + BACKFILL_CONCURRENCY);
    await Promise.all(
      chunk.map(async (entry) => {
        const filterName = entry.tag.tagName.toLowerCase();
        // Empty tag values are meaningless to filter on; leave the zeroed
        // defaults rather than make a request that would match everything.
        if (entry.tag.tagValue.length === 0 || filterName.length === 0) {
          return;
        }
        const valueParam = encodeURIComponent(entry.tag.tagValue);
        const nameParam = encodeURIComponent(filterName);
        const baseQuery = `_start=0&_end=1&${nameParam}=${valueParam}`;

        try {
          const [albumResult, songResult] = await Promise.all([
            client.requestWithLibraryFilterAndMeta<unknown>(`/album?${baseQuery}`),
            client.requestWithLibraryFilterAndMeta<unknown>(`/song?${baseQuery}`),
          ]);
          if (typeof albumResult.total === 'number') {
            entry.tag.albumCount = albumResult.total;
          }
          if (typeof songResult.total === 'number') {
            entry.tag.songCount = songResult.total;
          }
        } catch (error) {
          logger.debug(
            `backfillTagCounts: failed for ${entry.tag.tagName}=${entry.tag.tagValue}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  }
}


export async function listTagValues(client: NavidromeClient, args: unknown): Promise<ListTagValuesResult> {
  const params = ListTagValuesSchema.parse(args);
  logger.debug('listTagValues called with args:', params);

  try {
    // Only genre rows carry server-side counts to sort by.
    const isGenre = params.tagName === 'genre';
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: isGenre ? 'songCount' : 'tagValue',
      _order: isGenre ? 'DESC' : 'ASC',
      tag_name: params.tagName,
    });

    // Add tag_value filter if specified
    if (params.tagValue !== undefined && params.tagValue !== '') {
      queryParams.append('tag_value', params.tagValue);
    }

    // Use server-side filtering for optimal performance; capture X-Total-Count
    // so the LLM sees how many tag values exist matching the filter, not just
    // the slice we returned.
    const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown>(`/tag?${queryParams.toString()}`);
    const tagMeta = transformTagsToMeta(data);

    // Navidrome's /api/tag only returns counts for `genre`. For everything
    // else we issue parallel /album + /song lookups per tag value and read
    // X-Total-Count. Capped to the page we're returning, so the cost is
    // bounded by `limit` rather than the full library tag set.
    await backfillTagCounts(client, tagMeta);

    const allTags = tagMeta.map((entry) => entry.tag);

    return {
      matches: allTags,
      total: total ?? allTags.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_tag_values', error));
  }
}

/**
 * Get distribution analysis of tags, using server-side filtering for efficiency
 */
export async function getTagDistribution(client: NavidromeClient, args: unknown): Promise<GetTagDistributionResult> {
  const params = TagDistributionSchema.parse(args);
  logger.debug('Tool getTagDistribution called with args:', params);

  try {
    const distributions: TagDistribution[] = [];

    // If specific tag names provided, analyze those; otherwise analyze common tag types
    const tagNamesToAnalyze = params.tagNames ?? [
      'genre', 'releasetype', 'media', 'releasecountry', 'recordlabel',
      'mood'
    ];

    // Fetch and analyze all tag names in parallel for better performance
    const tagNamesToFetch = tagNamesToAnalyze.slice(0, params.limit);

    const tagResults = await Promise.all(
      tagNamesToFetch.map(async (tagName): Promise<TagDistribution | null> => {
        // Only genre rows carry server-side counts, so every other tag name is an alphabetical sample.
        const isGenre = tagName === 'genre';
        const queryParams = new URLSearchParams({
          _start: '0',
          _end: String(params.distributionLimit),
          _sort: isGenre ? 'songCount' : 'tagValue',
          _order: isGenre ? 'DESC' : 'ASC',
          tag_name: tagName,
        });

        // X-Total-Count gives the library-wide distinct count without fetching every value.
        const { data: rawTags, total } = await client.requestWithLibraryFilterAndMeta<unknown>(
          `/tag?${queryParams.toString()}`,
        );
        const tagMeta = transformTagsToMeta(rawTags);

        if (tagMeta.length === 0) {
          return null;
        }

        await backfillTagCounts(client, tagMeta);

        const surfacedTags = tagMeta.map((entry) => entry.tag);
        const sortedTags = surfacedTags.sort((a, b) => b.songCount - a.songCount);
        const mostCommon = sortedTags[0];

        if (!mostCommon) {
          return null;
        }

        const dist: TagDistribution = {
          tagName,
          uniqueValues: total ?? surfacedTags.length,
          totalSongs: surfacedTags.reduce((sum, tag) => sum + tag.songCount, 0),
          totalAlbums: surfacedTags.reduce((sum, tag) => sum + tag.albumCount, 0),
          mostCommon,
          distribution: sortedTags,
        };
        // For non-genre names the fetched slice is an alphabetical sample, not
        // the true top-N by count (no server-side counts to sort by). Flag it
        // so callers don't treat an arbitrary slice as the definitive
        // distribution. `genre` is sorted by songCount server-side, so it's a
        // true top-N and stays unflagged.
        if (!isGenre) {
          dist.sampled = true;
        }
        return dist;
      })
    );

    // Collect non-null results in order
    for (const result of tagResults) {
      if (result !== null) {
        distributions.push(result);
      }
    }

    const filteredDistributions = distributions.filter((dist) => dist.uniqueValues > 0);
    return {
      distributions: filteredDistributions,
      totalTagNames: filteredDistributions.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_tag_distribution', error));
  }
}

/**
 * List the cached values of one search filter type, so agents can pick exact filter values.
 */
export async function getFilterOptions(args: unknown): Promise<GetFilterOptionsResult> {
  try {
    const { filterType, limit, offset } = FilterOptionsSchema.parse(args);

    if (!filterCacheManager.isInitialized()) {
      throw new Error('Filter cache manager not initialized. Please wait for server startup to complete.');
    }

    await filterCacheManager.ensureFresh();

    const allOptions = filterCacheManager.getAvailableOptions(filterType);
    const available = allOptions.slice(offset, offset + limit);

    logger.debug(`Retrieved ${available.length} ${filterType} options (of ${allOptions.length} total) from offset ${offset}`);

    return {
      filterType,
      available,
      total: allOptions.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_filter_options', error));
  }
}
