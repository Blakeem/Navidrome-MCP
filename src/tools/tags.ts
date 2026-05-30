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
  SearchByTagsSchema,
  TagDistributionSchema,
} from '../schemas/index.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

interface SearchByTagsResult {
  matches: TagDTO[];
  total: number;
}

type GetTagDistributionResult = TagDistributionResponse;

/**
 * Result of transforming a raw tag, plus a flag indicating whether the
 * API supplied the count fields. The Navidrome `/api/tag` endpoint only
 * returns `albumCount`/`songCount` for `genre` tags — for every other tag
 * name (releasetype, media, releasecountry, recordlabel, mood, ...) the
 * counts are missing, which earlier code turned into a misleading `0`.
 *
 * We track which tags need enrichment so the caller can backfill counts
 * via per-tag-value `/api/album?{tagName}=...` + `/api/song?{tagName}=...`
 * lookups (reading `X-Total-Count` from the headers). The fallback path is
 * N×2 requests so we only run it when truly needed.
 */
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

/**
 * Backfill `albumCount` / `songCount` for tag values whose `/api/tag` row
 * didn't include them (everything except `genre`). For each missing entry
 * we issue parallel `_end=1` queries to `/api/album` and `/api/song`
 * filtered by the tag value and read `X-Total-Count` from the response
 * headers via `requestWithLibraryFilterAndMeta`. Failures default the
 * affected counts to 0 so a single broken sub-query doesn't sink the
 * whole response.
 *
 * NOTE: filter parameter names are lowercased tag names (e.g.
 * `releasetype=ep`, `media=CD`, `recordlabel=Sony`). This matches what
 * Navidrome's frontend sends and what we verified live during testing.
 */
async function backfillTagCounts(
  client: NavidromeClient,
  entries: TagWithMeta[],
): Promise<void> {
  const needsBackfill = entries.filter((entry) => !entry.countsProvided);
  if (needsBackfill.length === 0) {
    return;
  }

  await Promise.all(
    needsBackfill.map(async (entry) => {
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


/**
 * Search for tags by tag name and optionally tag value
 * Uses server-side filtering with tag_name parameter for optimal performance
 */
export async function searchByTags(client: NavidromeClient, args: unknown): Promise<SearchByTagsResult> {
  const params = SearchByTagsSchema.parse(args);
  logger.debug('Tool searchByTags called with args:', params);

  try {
    // Build query parameters for server-side filtering
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: 'tagValue', // Sort by tag value for consistent ordering
      _order: 'ASC',
      tag_name: params.tagName, // Server-side filter by tag name
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

    // Sort by song count descending for most relevant results (after getting from server)
    allTags.sort((a, b) => b.songCount - a.songCount);

    return {
      matches: allTags,
      total: total ?? allTags.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('search_by_tags', error));
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
        const queryParams = new URLSearchParams({
          _start: '0',
          _end: '1000', // Get enough to analyze distribution
          _sort: 'tagValue',
          _order: 'ASC',
          tag_name: tagName,
        });

        try {
          const rawTags = await client.requestWithLibraryFilter<unknown>(`/tag?${queryParams.toString()}`);
          const tagMeta = transformTagsToMeta(rawTags);

          if (tagMeta.length === 0) {
            return null;
          }

          // Cap the backfill window to `distributionLimit` so per-tag-value
          // count enrichment doesn't explode for tag names with many values
          // (e.g. 100+ record labels). The distribution surfaced to the LLM
          // is already capped at this same value below, so anything past
          // the cap would be invisible anyway.
          //
          // Sort first so the "kept" slice is the highest-songCount tags as
          // reported by the API (relevant for `genre` which has counts;
          // for the others all entries arrive with `songCount: 0` and the
          // initial slice is arbitrary — backfill will reorder later).
          tagMeta.sort((a, b) => b.tag.songCount - a.tag.songCount);
          const toEnrich = tagMeta.slice(0, params.distributionLimit);
          await backfillTagCounts(client, toEnrich);

          const tags = tagMeta.map((entry) => entry.tag);

          // Sort by usage for most relevant results
          const sortedTags = tags.sort((a, b) => b.songCount - a.songCount);
          const mostCommon = sortedTags[0];

          if (!mostCommon) {
            return null;
          }

          return {
            tagName,
            uniqueValues: tags.length,
            totalSongs: tags.reduce((sum, tag) => sum + tag.songCount, 0),
            totalAlbums: tags.reduce((sum, tag) => sum + tag.albumCount, 0),
            mostCommon,
            // Limit distribution to prevent massive output
            distribution: sortedTags.slice(0, params.distributionLimit),
          };
        } catch (error) {
          // Skip tag types that don't exist in this library (e.g. 404), but log for observability
          logger.debug(`getTagDistribution: skipping tag name "${tagName}" due to error:`, error);
          return null;
        }
      })
    );

    // Collect non-null results in order
    for (const result of tagResults) {
      if (result !== null) {
        distributions.push(result);
      }
    }

    return {
      distributions: distributions.filter((dist) => dist.uniqueValues > 0),
      totalTagNames: distributions.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_tag_distribution', error));
  }
}
