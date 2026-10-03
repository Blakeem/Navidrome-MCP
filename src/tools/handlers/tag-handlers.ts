/**
 * Navidrome MCP Server - Tag Tool Handlers
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

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';

// Import tool functions
import {
  listTagValues,
  getTagDistribution,
  getFilterOptions,
} from '../tags.js';
import { FilterOptionsSchema } from '../../schemas/index.js';

// Tool definitions for tags category
const tools: Tool[] = [
  {
    name: 'list_tag_values',
    description: 'List the values of one tag name (every genre, release type, media format and so on) with their album and song counts. Returns tag values, not music. To find songs or albums by tag value, use search_songs or search_albums. Defaults to genre if no tagName is specified.',
    inputSchema: {
      type: 'object',
      properties: {
        tagName: {
          type: 'string',
          description: 'Tag name whose values to list. Examples: "genre" (Rock, Jazz), "releasetype" (album, ep, single), "media" (CD, Vinyl, Digital Media), "releasecountry" (ISO codes such as US, GB, DE), "recordlabel" (Columbia Records), "mood". Composer, producer and year are not tags and return no results.',
          default: 'genre',
        },
        tagValue: {
          type: 'string',
          description: 'Optional tag value filter. Matches as a case-insensitive prefix (starts-with), not an exact or substring match. "Alternative" matches "Alternative Rock" and "Alternative Metal". "Rock" matches "Rock" and "Rock & Roll" but not "Alternative Rock". Pass the fullest leading value you can to narrow results.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching tags to return',
          minimum: 1,
          maximum: 100,
          default: 100,
        },
        offset: {
          type: 'integer',
          description: 'Pagination offset (0-based)',
          minimum: 0,
          default: 0,
        },
      },
    },
  },
  {
    name: 'get_tag_distribution',
    description: 'Analyze tag usage counts per tag name. Supports "genre", "releasetype", "media", "releasecountry", "recordlabel", "mood". For genre, distribution is the top distributionLimit values by song count. Other tag names have no server-side counts, so distribution is the first distributionLimit values in alphabetical order, the result carries sampled: true, and mostCommon, totalSongs and totalAlbums cover only that slice. uniqueValues is the library-wide count of distinct values.',
    inputSchema: {
      type: 'object',
      properties: {
        tagNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific tag names to analyze. If omitted, analyzes common types: "genre", "releasetype", "media", "releasecountry", "recordlabel", "mood"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of tag names to analyze',
          minimum: 1,
          maximum: 50,
          default: 10,
        },
        distributionLimit: {
          type: 'number',
          description: 'Maximum number of tag values to show in distribution (prevents huge output)',
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_filter_options',
    description: 'Discover available filter values for search operations. Use this FIRST to see what genres, media types, countries, etc. are available in your library before using filters in search functions. Returns dynamic values from your actual music collection.\n\nExample workflow:\n1. Call get_filter_options(filterType=\'genres\') to see available genres\n2. Use discovered genres like \'Rock\' or \'R&B\' in search_all, search_songs, etc.\n3. Repeat for other filter types (mediaTypes, countries, releaseTypes, recordLabels, moods)\n\nReturns at most limit values in sorted order. total is the full count. Page with offset.',
    inputSchema: {
      type: 'object',
      properties: {
        filterType: {
          type: 'string',
          enum: [...FilterOptionsSchema.shape.filterType.options],
          description: 'Type of metadata filter to discover options for. Valid values: "genres" (Rock, Jazz, etc.), "mediaTypes" (CD, Vinyl, etc.), "countries" (ISO 3166-1 alpha-2 codes — "US", "GB", "DE", etc.), "releaseTypes" (lowercase MusicBrainz values — "album", "ep", "single", etc.), "recordLabels" (Sony Music, etc.), "moods" (Energetic, etc.)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of options to return',
          minimum: 1,
          maximum: 200,
          default: 50,
        },
        offset: {
          type: 'integer',
          description: 'Pagination offset (0-based)',
          minimum: 0,
          default: 0,
        },
      },
      required: ['filterType'],
    },
  },
];

// Factory function for creating tags tool category with dependencies  
export function createTagsToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_tag_values':
          return await listTagValues(client, args);
        case 'get_tag_distribution':
          return await getTagDistribution(client, args);
        case 'get_filter_options':
          return await getFilterOptions(args);
        default:
          throw new Error(ErrorFormatter.toolUnknown(name));
      }
    }
  };
}