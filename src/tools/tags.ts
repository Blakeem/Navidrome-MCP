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
import { transformTagsToMeta, type TagWithMeta } from '../transformers/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

interface ListTagValuesResult {
  tagName: string;
  matches: TagDTO[];
  total: number;
  countsIncomplete?: boolean;
}

interface GetFilterOptionsResult {
  filterType: FilterType;
  available: string[];
  total: number;
}

type GetTagDistributionResult = TagDistributionResponse;

interface TagNamePage {
  tagName: string;
  entries: TagWithMeta[];
  total: number | null;
}

/** Bounds outbound connections to Navidrome, since each backfilled entry issues two requests. */
const BACKFILL_CONCURRENCY = 8;

/** Filter keys are lowercased tag names with the row id (releasetype=<tag id>), the form Navidrome's frontend sends. */
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
        const filterName = entry.tagName.toLowerCase();
        // An empty id would match every row, so its counts stay 0.
        if (entry.id.length === 0 || filterName.length === 0) {
          return;
        }
        const idParam = encodeURIComponent(entry.id);
        const nameParam = encodeURIComponent(filterName);
        const baseQuery = `_start=0&_end=1&${nameParam}=${idParam}`;

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
          entry.backfillFailed = true;
          logger.debug(
            `backfillTagCounts: failed for ${entry.tagName}=${entry.tag.tagValue}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  }
}

function hasFailedBackfill(entries: TagWithMeta[]): boolean {
  return entries.some((entry) => entry.backfillFailed);
}

export async function listTagValues(client: NavidromeClient, args: unknown): Promise<ListTagValuesResult> {
  const params = ListTagValuesSchema.parse(args);
  logger.debug('listTagValues called with args:', params);

  try {
    const isGenre = params.tagName === 'genre';
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: isGenre ? 'songCount' : 'tagValue',
      _order: isGenre ? 'DESC' : 'ASC',
      tag_name: params.tagName,
    });

    if (params.tagValue !== undefined && params.tagValue !== '') {
      queryParams.append('tag_value', params.tagValue);
    }

    // X-Total-Count gives the matching value count beyond this page.
    const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown>(`/tag?${queryParams.toString()}`);
    const tagMeta = transformTagsToMeta(data);

    // Only this page is backfilled, so the cost is bounded by `limit`.
    await backfillTagCounts(client, tagMeta);

    const matches = tagMeta.map((entry) => entry.tag);
    const result: ListTagValuesResult = {
      tagName: params.tagName,
      matches,
      total: total ?? matches.length,
    };
    if (hasFailedBackfill(tagMeta)) {
      result.countsIncomplete = true;
    }
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_tag_values', error));
  }
}

async function fetchTagNamePage(
  client: NavidromeClient,
  tagName: string,
  distributionLimit: number,
): Promise<TagNamePage> {
  const isGenre = tagName === 'genre';
  const queryParams = new URLSearchParams({
    _start: '0',
    _end: String(distributionLimit),
    _sort: isGenre ? 'songCount' : 'tagValue',
    _order: isGenre ? 'DESC' : 'ASC',
    tag_name: tagName,
  });

  // X-Total-Count gives the library-wide distinct count without fetching every value.
  const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown>(`/tag?${queryParams.toString()}`);
  return { tagName, entries: transformTagsToMeta(data), total };
}

function buildDistribution(page: TagNamePage): TagDistribution | null {
  const distribution = page.entries.map((entry) => entry.tag).sort((a, b) => b.songCount - a.songCount);
  const uniqueValues = page.total ?? distribution.length;
  if (distribution.length === 0 || uniqueValues === 0) {
    return null;
  }

  const dist: TagDistribution = {
    tagName: page.tagName,
    uniqueValues,
    totalSongs: distribution.reduce((sum, tag) => sum + tag.songCount, 0),
    totalAlbums: distribution.reduce((sum, tag) => sum + tag.albumCount, 0),
    distribution,
  };
  const pageIsPartial = page.total === null || page.total > distribution.length;
  if (page.tagName !== 'genre' && pageIsPartial) {
    dist.sampled = true;
  }
  if (hasFailedBackfill(page.entries)) {
    dist.countsIncomplete = true;
  }
  return dist;
}

export async function getTagDistribution(client: NavidromeClient, args: unknown): Promise<GetTagDistributionResult> {
  const params = TagDistributionSchema.parse(args);
  logger.debug('Tool getTagDistribution called with args:', params);

  try {
    const tagNamesToAnalyze = params.tagNames ?? [
      'genre', 'releasetype', 'media', 'releasecountry', 'recordlabel',
      'mood'
    ];
    const tagNamesToFetch = tagNamesToAnalyze.slice(0, params.limit);

    const pages = await Promise.all(
      tagNamesToFetch.map((tagName) => fetchTagNamePage(client, tagName, params.distributionLimit)),
    );
    // One backfill across every page, so BACKFILL_CONCURRENCY bounds the whole tool call.
    await backfillTagCounts(client, pages.flatMap((page) => page.entries));

    const distributions: TagDistribution[] = [];
    const emptyTagNames: string[] = [];
    for (const page of pages) {
      const dist = buildDistribution(page);
      if (dist === null) emptyTagNames.push(page.tagName);
      else distributions.push(dist);
    }
    const result: GetTagDistributionResult = { distributions };
    if (emptyTagNames.length > 0) result.emptyTagNames = emptyTagNames;
    return result;
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
