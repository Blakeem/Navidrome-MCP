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
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';

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
    throw new Error(ErrorFormatter.toolUnknown(name));
  }
}

// Utility function to create consistent tool responses
function createToolResponse(result: unknown): { content: { type: 'text'; text: string }[] } {
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
import { createPlaybackToolCategory } from './playback-handlers.js';
import { playbackEngine } from '../../services/playback/playback-engine.js';
import { ScrobbleTracker } from '../../services/playback/scrobble-tracker.js';

// Main registration function
export function registerTools(server: Server, client: NavidromeClient, config: Config): void {
  const registry = new ToolRegistry();

  // Use feature flags from config for conditional tools
  const hasLastFm = config.features.lastfm;
  const hasLyrics = config.features.lyrics;
  const hasPlayback = config.features.playback;

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

  if (hasPlayback) {
    // Configure the singleton engine with the loaded config so tools can
    // lazy-spawn mpv on first invocation.
    playbackEngine.configure(config);
    // Auto-scrobble plays to Navidrome (Last.fm rules: now-playing on start,
    // submission past 50% of duration or 4 min, whichever first; ≥30s
    // tracks only). The tracker is constructed once and attached for the
    // rest of the process lifetime — there is no explicit shutdown. On
    // SIGINT/SIGTERM the engine closes its IPC socket (mpv keeps running,
    // detached) and the tracker is torn down with the process; any
    // in-flight /scrobble request is abandoned, which is acceptable per
    // Last.fm best-effort semantics.
    new ScrobbleTracker(client, playbackEngine).attach();
    registry.register('playback', createPlaybackToolCategory(client, config));
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