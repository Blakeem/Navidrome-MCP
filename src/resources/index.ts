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
  ReadResourceRequestSchema,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

export function registerResources(server: Server, client: NavidromeClient): void {
  // Define available resources
  const resources: Resource[] = [
    {
      uri: 'navidrome://server/status',
      name: 'Server Status',
      description: 'Navidrome server connection status',
      mimeType: 'application/json',
    },
  ];

  // Register list resources handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  // Register read resource handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // Parse URI to handle query parameters
    const baseUri = uri.split('?')[0];


    if (baseUri === 'navidrome://server/status') {
      try {
        // Test connectivity using our working /song endpoint with minimal request
        const queryParams = new URLSearchParams({
          _start: '0',
          _end: '1', // Just get 1 song to test connectivity
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

    throw new Error(ErrorFormatter.unknownResource(baseUri !== null && baseUri !== undefined && baseUri !== '' ? baseUri : uri));
  });
}
