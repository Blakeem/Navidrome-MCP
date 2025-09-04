import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import type { ToolCategory } from './registry.js';

// Import tool functions
import {
  listTags,
  getTag,
  searchByTags,
  getTagDistribution,
  listUniqueTags,
} from '../tags.js';

// Tool definitions for tags category
const tools: Tool[] = [
  {
    name: 'list_tags',
    description: 'List all metadata tags with optional filtering by tag name and pagination',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tags to return (1-500)',
          minimum: 1,
          maximum: 500,
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Number of tags to skip for pagination',
          minimum: 0,
          default: 0,
        },
        sort: {
          type: 'string',
          description: 'Field to sort by',
          enum: ['tagName', 'tagValue', 'albumCount', 'songCount'],
          default: 'tagName',
        },
        order: {
          type: 'string',
          description: 'Sort order',
          enum: ['ASC', 'DESC'],
          default: 'ASC',
        },
        tagName: {
          type: 'string',
          description: 'Filter by specific tag name (e.g., "genre", "composer", "label")',
        },
      },
    },
  },
  {
    name: 'get_tag',
    description: 'Get detailed information about a specific tag by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the tag',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_by_tags',
    description: 'Search for songs/albums by specific tag criteria (e.g., find all songs with genre "Jazz" or composer "Bach")',
    inputSchema: {
      type: 'object',
      properties: {
        tagName: {
          type: 'string',
          description: 'Tag name to search by (e.g., "genre", "composer", "label")',
        },
        tagValue: {
          type: 'string',
          description: 'Optional tag value to match exactly',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of matching tags to return',
          minimum: 1,
          maximum: 100,
          default: 100,
        },
      },
      required: ['tagName'],
    },
  },
  {
    name: 'get_tag_distribution',
    description: 'Analyze tag usage patterns and distribution across the music library',
    inputSchema: {
      type: 'object',
      properties: {
        tagNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific tag names to analyze (if omitted, analyzes all)',
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
    name: 'list_unique_tags',
    description: 'List all unique tag names with statistics (how many unique values, total usage)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tag names to return',
          minimum: 1,
          maximum: 100,
          default: 100,
        },
        minUsage: {
          type: 'number',
          description: 'Minimum song count to include a tag name',
          minimum: 1,
          default: 1,
        },
      },
    },
  },
];

// Factory function for creating tags tool category with dependencies  
export function createTagsToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'list_tags':
          return await listTags(client, args);
        case 'get_tag':
          return await getTag(client, args);
        case 'search_by_tags':
          return await searchByTags(client, args);
        case 'get_tag_distribution':
          return await getTagDistribution(client, args);
        case 'list_unique_tags':
          return await listUniqueTags(client, args);
        default:
          throw new Error(`Unknown tags tool: ${name}`);
      }
    }
  };
}