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

export interface SearchByTagsResult {
  tagName: string;
  tagValue: string | undefined;
  matches: TagDTO[];
  total: number;
}

export type GetTagDistributionResult = TagDistributionResponse;

/**
 * Transform raw Navidrome tag data to clean DTO
 */
function transformTagToDTO(rawTag: unknown): TagDTO {
  if (typeof rawTag !== 'object' || rawTag === null) {
    throw new Error('Invalid tag data received from Navidrome');
  }

  const tag = rawTag as Record<string, unknown>;

  return {
    id: String(tag['id'] ?? ''),
    tagName: String(tag['tagName'] ?? ''),
    tagValue: String(tag['tagValue'] ?? ''),
    albumCount: Number(tag['albumCount']) || 0,
    songCount: Number(tag['songCount']) || 0,
  };
}

/**
 * Transform array of raw tags to DTOs
 */
function transformTagsToDTO(rawTags: unknown): TagDTO[] {
  if (!Array.isArray(rawTags)) {
    throw new Error('Expected array of tags from Navidrome');
  }

  return rawTags.map(transformTagToDTO);
}


/**
 * Search for tags by tag name and optionally tag value
 * Uses server-side filtering with tag_name parameter for optimal performance
 */
export async function searchByTags(client: NavidromeClient, args: unknown): Promise<SearchByTagsResult> {
  const params = SearchByTagsSchema.parse(args);

  try {
    // Build query parameters for server-side filtering
    const queryParams = new URLSearchParams({
      _start: '0',
      _end: params.limit.toString(),
      _sort: 'tagValue', // Sort by tag value for consistent ordering
      _order: 'ASC',
      tag_name: params.tagName, // Server-side filter by tag name
    });

    // Add tag_value filter if specified
    if (params.tagValue !== null && params.tagValue !== undefined && params.tagValue !== '') {
      queryParams.append('tag_value', params.tagValue);
    }

    // Use server-side filtering for optimal performance
    const rawTags = await client.requestWithLibraryFilter<unknown>(`/tag?${queryParams.toString()}`);
    const allTags = transformTagsToDTO(rawTags);

    // Sort by song count descending for most relevant results (after getting from server)
    allTags.sort((a, b) => b.songCount - a.songCount);

    return {
      tagName: params.tagName,
      tagValue: params.tagValue,
      matches: allTags,
      total: allTags.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to search tags: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get distribution analysis of tags, using server-side filtering for efficiency
 */
export async function getTagDistribution(client: NavidromeClient, args: unknown): Promise<GetTagDistributionResult> {
  const params = TagDistributionSchema.parse(args);

  try {
    const distributions: TagDistribution[] = [];

    // If specific tag names provided, analyze those; otherwise analyze common tag types
    const tagNamesToAnalyze = params.tagNames ?? [
      'genre', 'releasetype', 'media', 'releasecountry', 'recordlabel',
      'mood', 'composer', 'producer', 'year'
    ];

    // Analyze each tag name using server-side filtering
    for (const tagName of tagNamesToAnalyze.slice(0, params.limit)) {
      const queryParams = new URLSearchParams({
        _start: '0',
        _end: '1000', // Get enough to analyze distribution
        _sort: 'tagValue',
        _order: 'ASC',
        tag_name: tagName,
      });

      try {
        const rawTags = await client.requestWithLibraryFilter<unknown>(`/tag?${queryParams.toString()}`);
        const tags = transformTagsToDTO(rawTags);

        if (tags.length > 0) {
          // Sort by usage for most relevant results
          const sortedTags = tags.sort((a, b) => b.songCount - a.songCount);
          const mostCommon = sortedTags[0];

          if (mostCommon) {
            distributions.push({
              tagName,
              uniqueValues: tags.length,
              totalSongs: tags.reduce((sum, tag) => sum + tag.songCount, 0),
              totalAlbums: tags.reduce((sum, tag) => sum + tag.albumCount, 0),
              mostCommon,
              // Limit distribution to prevent massive output
              distribution: sortedTags.slice(0, params.distributionLimit),
            });
          }
        }
      } catch {
        // Skip tag types that don't exist in this library
        continue;
      }
    }

    return {
      distributions: distributions.filter((dist) => dist.uniqueValues > 0),
      totalTagNames: distributions.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to analyze tag distribution: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

