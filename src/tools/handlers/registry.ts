/**
 * Navidrome MCP Server - Tool Handler Registry
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

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';
import { createTestToolCategory } from './test-handlers.js';
import { createLibraryToolCategory } from './library-handlers.js';
import { createPlaylistToolCategory } from './playlist-handlers.js';
import { createSearchToolCategory } from './search-handlers.js';
import { createUserPreferencesToolCategory } from './user-preferences-handlers.js';
import { createQueueToolCategory } from './queue-handlers.js';
import { createListeningHistoryToolCategory } from './listening-history-handlers.js';
import { createRadioToolCategory } from './radio-handlers.js';
import { createLastFmToolCategory } from './lastfm-handlers.js';
import { createLyricsToolCategory } from './lyrics-handlers.js';
import { createTagToolCategory } from './tag-handlers.js';
import { createPlaybackToolCategory } from './playback-handlers.js';

export interface ToolCategory {
  tools: Tool[];
  handleToolCall(name: string, args: unknown): Promise<unknown>;
}

interface RegisteredTool {
  tool: Tool;
  category: ToolCategory;
}

export class ToolRegistry {
  private readonly toolsByName = new Map<string, RegisteredTool>();

  register(category: ToolCategory): void {
    for (const tool of category.tools) {
      if (this.toolsByName.has(tool.name)) {
        throw new Error(`Tool '${tool.name}' is registered by two categories`);
      }
      this.toolsByName.set(tool.name, { tool, category });
    }
  }

  getAllTools(): Tool[] {
    return [...this.toolsByName.values()].map((entry) => entry.tool);
  }

  hasTool(name: string): boolean {
    return this.toolsByName.has(name);
  }

  async handleToolCall(name: string, args: unknown): Promise<unknown> {
    const entry = this.toolsByName.get(name);
    if (entry === undefined) {
      throw new McpError(ErrorCode.InvalidParams, ErrorFormatter.toolUnknown(name));
    }
    const start = Date.now();
    try {
      const result = await entry.category.handleToolCall(name, args);
      logger.debug(`tool ${name} ok (${Date.now() - start}ms)`);
      return result;
    } catch (err) {
      logger.warn(`tool ${name} failed (${Date.now() - start}ms):`, err);
      throw err;
    }
  }
}

function createToolResponse(result: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

/** An execution failure is a result the model reads, so it can correct its call and retry. */
function createToolErrorResponse(name: string, error: unknown): CallToolResult {
  return { content: [{ type: 'text', text: ErrorFormatter.toolExecution(name, error) }], isError: true };
}

export function buildToolRegistry(client: NavidromeClient, config: Config): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(createTestToolCategory(client, config));
  registry.register(createLibraryToolCategory(client, config));
  registry.register(createPlaylistToolCategory(client, config));
  registry.register(createSearchToolCategory(client, config));
  registry.register(createUserPreferencesToolCategory(client, config));
  registry.register(createQueueToolCategory(client, config));
  registry.register(createListeningHistoryToolCategory(client, config));
  registry.register(createRadioToolCategory(client, config));
  registry.register(createTagToolCategory(client, config));
  // Unconditional: the category serves the lyrics stored in the audio files
  // with no LRCLIB, and drops its LRCLIB search when features.lyrics is off.
  registry.register(createLyricsToolCategory(client, config));

  if (config.features.lastfm) {
    registry.register(createLastFmToolCategory(client, config));
  }

  if (config.features.playback) {
    // createRuntime() configures the engine and the entry point attaches the scrobbler, since both outlive tool registration.
    registry.register(createPlaybackToolCategory(client, config));
  }

  return registry;
}

export function registerTools(server: Server, client: NavidromeClient, config: Config): void {
  const registry = buildToolRegistry(client, config);

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: registry.getAllTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    if (!registry.hasTool(name)) {
      throw new McpError(ErrorCode.InvalidParams, ErrorFormatter.toolUnknown(name));
    }
    try {
      return createToolResponse(await registry.handleToolCall(name, args ?? {}));
    } catch (error) {
      return createToolErrorResponse(name, error);
    }
  });
}
