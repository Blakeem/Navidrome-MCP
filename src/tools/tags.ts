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

import { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { 
  TagDTO, 
  ListTagsResponse, 
  TagDistributionResponse, 
  TagDistribution 
} from '../types/dto.js';

const ListTagsSchema = z.object({
  limit: z.number().min(1).max(500).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  sort: z.enum(['tagName', 'tagValue', 'albumCount', 'songCount']).optional().default('tagName'),
  order: z.enum(['ASC', 'DESC']).optional().default('ASC'),
  tagName: z.string().optional(),
});

const GetTagSchema = z.object({
  id: z.string().min(1),
});

const SearchByTagsSchema = z.object({
  tagName: z.string().min(1),
  tagValue: z.string().optional(),
  limit: z.number().min(1).max(100).optional().default(20),
});

const GetTagDistributionSchema = z.object({
  tagNames: z.array(z.string()).optional(),
  limit: z.number().min(1).max(50).optional().default(10),
  distributionLimit: z.number().min(1).max(100).optional().default(20),
});;

const ListUniqueTagsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  minUsage: z.number().min(1).optional().default(1),
});

export type ListTagsResult = ListTagsResponse;

export interface GetTagResult {
  tag: TagDTO;
}

export interface SearchByTagsResult {
  tagName: string;
  tagValue: string | undefined;
  matches: TagDTO[];
  total: number;
}

export type GetTagDistributionResult = TagDistributionResponse;

export interface ListUniqueTagsResult {
  tagNames: Array<{
    name: string;
    totalValues: number;
    totalSongs: number;
    totalAlbums: number;
    topValues: TagDTO[];
  }>;
  total: number;
}

/**
 * Transform raw Navidrome tag data to clean DTO
 */
function transformTagToDTO(rawTag: unknown): TagDTO {
  if (typeof rawTag !== 'object' || rawTag === null) {
    throw new Error('Invalid tag data received from Navidrome');
  }

  const tag = rawTag as Record<string, unknown>;

  return {
    id: String(tag['id'] || ''),
    tagName: String(tag['tagName'] || ''),
    tagValue: String(tag['tagValue'] || ''),
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
 * List all tags with optional filtering and pagination
 * Note: API filtering is broken, so we use client-side filtering
 */
export async function listTags(client: NavidromeClient, args: unknown): Promise<ListTagsResult> {
  const params = ListTagsSchema.parse(args);

  try {
    // Fetch all tags since API filtering is broken
    const rawTags = await client.request<unknown>('/tag?_start=0&_end=50000');
    let allTags = transformTagsToDTO(rawTags);

    // Client-side filtering
    if (params.tagName) {
      allTags = allTags.filter(tag => tag.tagName === params.tagName);
    }

    // Client-side sorting
    allTags.sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (params.sort) {
        case 'tagName':
          aValue = a.tagName;
          bValue = b.tagName;
          break;
        case 'tagValue':
          aValue = a.tagValue;
          bValue = b.tagValue;
          break;
        case 'albumCount':
          aValue = a.albumCount;
          bValue = b.albumCount;
          break;
        case 'songCount':
          aValue = a.songCount;
          bValue = b.songCount;
          break;
        default:
          aValue = a.tagName;
          bValue = b.tagName;
      }

      if (params.order === 'DESC') {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });

    // Client-side pagination
    const total = allTags.length;
    const paginatedTags = allTags.slice(params.offset, params.offset + params.limit);

    return {
      tags: paginatedTags,
      total,
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch tags: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get a specific tag by ID
 */
export async function getTag(client: NavidromeClient, args: unknown): Promise<GetTagResult> {
  const params = GetTagSchema.parse(args);

  try {
    const rawTag = await client.request<unknown>(`/tag/${params.id}`);
    const tag = transformTagToDTO(rawTag);

    return { tag };
  } catch (error) {
    throw new Error(
      `Failed to fetch tag: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Search for tags by tag name and optionally tag value
 * Note: API filtering is broken, so we use client-side filtering
 */
export async function searchByTags(client: NavidromeClient, args: unknown): Promise<SearchByTagsResult> {
  const params = SearchByTagsSchema.parse(args);

  try {
    // Fetch all tags since API filtering is broken
    const rawTags = await client.request<unknown>('/tag?_start=0&_end=50000');
    let allTags = transformTagsToDTO(rawTags);

    // Client-side filtering by tag name
    allTags = allTags.filter(tag => tag.tagName === params.tagName);

    // Additional filtering by tag value if specified
    if (params.tagValue) {
      allTags = allTags.filter(tag => tag.tagValue === params.tagValue);
    }

    // Sort by song count descending for most relevant results
    allTags.sort((a, b) => b.songCount - a.songCount);

    // Limit results
    const matches = allTags.slice(0, params.limit);

    return {
      tagName: params.tagName,
      tagValue: params.tagValue,
      matches,
      total: allTags.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to search tags: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get distribution analysis of tags, optionally filtered by tag names
 */
export async function getTagDistribution(client: NavidromeClient, args: unknown): Promise<GetTagDistributionResult> {
  const params = GetTagDistributionSchema.parse(args);

  try {
    // Get all tags first
    const rawTags = await client.request<unknown>('/tag?_start=0&_end=10000');
    const allTags = transformTagsToDTO(rawTags);

    // Group by tag name
    const groupedTags = allTags.reduce((acc, tag) => {
      const existing = acc[tag.tagName];
      if (!existing) {
        acc[tag.tagName] = [];
      }
      const current = acc[tag.tagName];
      if (current) {
        current.push(tag);
      }
      return acc;
    }, {} as Record<string, TagDTO[]>);

    // Filter to specific tag names if provided
    const tagNamesToAnalyze = params.tagNames || Object.keys(groupedTags);

    // Analyze each tag name
    const distributions: TagDistribution[] = tagNamesToAnalyze
      .slice(0, params.limit)
      .map((tagName) => {
        const tags = groupedTags[tagName] || [];
        const sortedTags = tags.sort((a, b) => b.songCount - a.songCount);

        const mostCommon = sortedTags[0];
        if (!mostCommon) {
          return {
            tagName,
            uniqueValues: 0,
            totalSongs: 0,
            totalAlbums: 0,
            mostCommon: { id: '', tagName, tagValue: '', albumCount: 0, songCount: 0 },
            distribution: [],
          };
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
      })
      .filter((dist) => dist.uniqueValues > 0);

    return {
      distributions,
      totalTagNames: Object.keys(groupedTags).length,
    };
  } catch (error) {
    throw new Error(
      `Failed to analyze tag distribution: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * List all unique tag names with statistics
 */
export async function listUniqueTags(client: NavidromeClient, args: unknown): Promise<ListUniqueTagsResult> {
  const params = ListUniqueTagsSchema.parse(args);

  try {
    // Get all tags
    const rawTags = await client.request<unknown>('/tag?_start=0&_end=10000');
    const allTags = transformTagsToDTO(rawTags);

    // Group by tag name and calculate statistics
    const tagStats = allTags.reduce((acc, tag) => {
      const existing = acc[tag.tagName];
      if (!existing) {
        acc[tag.tagName] = {
          name: tag.tagName,
          tags: [],
          totalSongs: 0,
          totalAlbums: 0,
        };
      }

      const current = acc[tag.tagName];
      if (current) {
        current.tags.push(tag);
        current.totalSongs += tag.songCount;
        current.totalAlbums += tag.albumCount;
      }

      return acc;
    }, {} as Record<string, {
      name: string;
      tags: TagDTO[];
      totalSongs: number;
      totalAlbums: number;
    }>);

    // Filter by minimum usage and prepare results
    const tagNames = Object.values(tagStats)
      .filter((stat) => stat.totalSongs >= params.minUsage)
      .sort((a, b) => b.totalSongs - a.totalSongs)
      .slice(0, params.limit)
      .map((stat) => ({
        name: stat.name,
        totalValues: stat.tags.length,
        totalSongs: stat.totalSongs,
        totalAlbums: stat.totalAlbums,
        topValues: stat.tags
          .sort((a, b) => b.songCount - a.songCount)
          .slice(0, 5), // Top 5 values for each tag name
      }));

    return {
      tagNames,
      total: Object.keys(tagStats).length,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch unique tags: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}