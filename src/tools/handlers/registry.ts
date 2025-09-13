import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';

// Tool category interfaces
export interface ToolCategory {
  tools: Tool[];
  handleToolCall(name: string, args: unknown): Promise<unknown>;
}


// Registry for all tool categories
export class ToolRegistry {
  private readonly categories: Map<string, ToolCategory> = new Map();
  private readonly allTools: Tool[] = [];

  register(categoryName: string, category: ToolCategory): void {
    this.categories.set(categoryName, category);
    this.allTools.push(...category.tools);
  }

  getAllTools(): Tool[] {
    return [...this.allTools];
  }

  async handleToolCall(name: string, args: unknown): Promise<unknown> {
    for (const category of this.categories.values()) {
      const tool = category.tools.find(t => t.name === name);
      if (tool) {
        return category.handleToolCall(name, args);
      }
    }
    throw new Error(`Unknown tool: ${name}`);
  }
}

// Utility function to create consistent tool responses
export function createToolResponse(result: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// Import category factory functions
import { createTestToolCategory } from '../test.js';
import { createLibraryToolCategory } from '../library.js';
import { createPlaylistToolCategory } from './playlist-handlers.js';
import { createSearchToolCategory } from './search-handlers.js';
import { createUserPreferencesToolCategory } from './user-preferences-handlers.js';
import { createQueueToolCategory } from './queue-handlers.js';
import { createRadioToolCategory } from './radio-handlers.js';
import { createLastFmToolCategory } from './lastfm-handlers.js';
import { createLyricsToolCategory } from './lyrics-handlers.js';
import { createTagsToolCategory } from './tag-handlers.js';

// Main registration function
export function registerTools(server: Server, client: NavidromeClient, config: Config): void {
  const registry = new ToolRegistry();

  // Use feature flags from config for conditional tools
  const hasLastFm = config.features.lastfm;
  const hasLyrics = config.features.lyrics;

  // Register all tool categories
  registry.register('test', createTestToolCategory(client, config));
  registry.register('library', createLibraryToolCategory(client, config));
  registry.register('playlist-management', createPlaylistToolCategory(client, config));
  registry.register('search', createSearchToolCategory(client, config));
  registry.register('user-preferences', createUserPreferencesToolCategory(client, config));
  registry.register('queue-management', createQueueToolCategory(client, config));
  registry.register('radio', createRadioToolCategory(client, config));
  registry.register('tags', createTagsToolCategory(client, config));

  // Add conditional tools based on configuration  
  if (hasLastFm) {
    registry.register('lastfm-discovery', createLastFmToolCategory(client, config));
  }

  if (hasLyrics) {
    registry.register('lyrics', createLyricsToolCategory(client, config));
  }

  // Register MCP handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.getAllTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await registry.handleToolCall(name, args ?? {});
    return createToolResponse(result);
  });
}