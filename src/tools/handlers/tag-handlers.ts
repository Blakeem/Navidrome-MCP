import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';

// Import tool functions
import {
  searchByTags,
  getTagDistribution,
  getFilterOptions,
} from '../tags.js';

// Tool definitions for tags category
const tools: Tool[] = [
  {
    name: 'search_by_tags',
    description: 'Search for tags by type (e.g., list all genres, find release types, etc.). Defaults to genre if no tagName specified. Use this to explore metadata categories like genres, release types, media formats, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        tagName: {
          type: 'string',
          description: 'Tag name to search by. Common working examples: "genre" (Rock, Jazz, Classical), "releasetype" (Album, EP, Single), "media" (CD, Vinyl, Digital), "releasecountry" (US, UK, Germany), "recordlabel" (Columbia Records, Sony Music), "mood" (Energetic, Melancholy), "composer", "producer", "year"',
          default: 'genre',
        },
        tagValue: {
          type: 'string',
          description: 'Optional tag value to match exactly (e.g., "Rock" for genre, "Album" for releasetype)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching tags to return',
          minimum: 1,
          maximum: 100,
          default: 100,
        },
      },
    },
  },
  {
    name: 'get_tag_distribution',
    description: 'Analyze tag usage patterns and distribution across the music library. Shows statistics for metadata categories like how many genres, release types, etc. are in the library with their usage counts.',
    inputSchema: {
      type: 'object',
      properties: {
        tagNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific tag names to analyze. If omitted, analyzes common types: "genre", "releasetype", "media", "releasecountry", "recordlabel", "mood", "composer", "producer", "year"',
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
    description: 'Get available values for metadata filters used in enhanced search/list tools. Exposes filter options like available genres, release types, countries, etc. that can be used with search_all, search_songs, search_albums, and list tools.',
    inputSchema: {
      type: 'object',
      properties: {
        filterType: {
          type: 'string',
          enum: ['genres', 'mediaTypes', 'countries', 'releaseTypes', 'recordLabels', 'moods'],
          description: 'Type of metadata filter to discover options for. Valid values: "genres" (Rock, Jazz, etc.), "mediaTypes" (CD, Vinyl, etc.), "countries" (US, UK, etc.), "releaseTypes" (Album, EP, etc.), "recordLabels" (Sony Music, etc.), "moods" (Energetic, etc.)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of options to return',
          minimum: 1,
          maximum: 200,
          default: 50,
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
        case 'search_by_tags':
          return await searchByTags(client, args);
        case 'get_tag_distribution':
          return await getTagDistribution(client, args);
        case 'get_filter_options':
          return await getFilterOptions(client, args);
        default:
          throw new Error(`Unknown tags tool: ${name}`);
      }
    }
  };
}