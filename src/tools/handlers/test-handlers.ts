/**
 * Navidrome MCP Server - Test Tool Handlers
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
import { testConnection } from '../test.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';

const tools: Tool[] = [
  {
    name: 'test_connection',
    description: 'Test the connection to the Navidrome server',
    inputSchema: {
      type: 'object',
      properties: {
        includeServerInfo: {
          type: 'boolean',
          description: 'Also return the Navidrome URL, this MCP server\'s version, and each optional feature\'s enabled state, tools and setup hint',
          default: false,
        },
      },
    },
  },
];

export function createTestToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      if (name === 'test_connection') {
        return await testConnection(client, config, args);
      }
      throw new Error(ErrorFormatter.toolUnknown(name));
    }
  };
}
