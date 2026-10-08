/**
 * Navidrome MCP Server - Resource Registry
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
import type { NavidromeClient } from '../client/navidrome-client.js';
import {
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

const STATUS_RESOURCE_URI = 'navidrome://server/status';

// MCP spec code for an unknown resource. SDK 1.17 ErrorCode has no member for it.
const RESOURCE_NOT_FOUND = -32002;

export function registerResources(server: Server, client: NavidromeClient): void {
  const resources: Resource[] = [
    {
      uri: STATUS_RESOURCE_URI,
      name: 'Server Status',
      description: 'Navidrome server connection status',
      mimeType: 'application/json',
    },
  ];

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    const baseUri = uri.split('?')[0] ?? uri;

    if (baseUri === STATUS_RESOURCE_URI) {
      try {
        // A one-row /song listing proves auth and reachability at minimal cost.
        const queryParams = new URLSearchParams({
          _start: '0',
          _end: '1',
        });

        await client.request(`/song?${queryParams.toString()}`);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  status: 'connected',
                  server: 'Navidrome',
                  timestamp: new Date().toISOString(),
                  message: 'Successfully connected to Navidrome server',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  status: 'error',
                  server: 'Navidrome',
                  timestamp: new Date().toISOString(),
                  error: 'Failed to connect to Navidrome server',
                  // A resource is not a tool, so the raw message skips the "Tool failed" prefix of toolExecution.
                  message: error instanceof Error ? error.message : 'Unknown error',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    throw new McpError(RESOURCE_NOT_FOUND, ErrorFormatter.unknownResource(baseUri));
  });
}
