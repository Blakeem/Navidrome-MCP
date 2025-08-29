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

export function registerResources(server: Server, client: NavidromeClient): void {
  // Define available resources
  const resources: Resource[] = [
    {
      uri: 'navidrome://library/recent-songs',
      name: 'Recent Songs',
      description: 'Recently added songs from the music library (sample of 10 songs)',
      mimeType: 'application/json',
    },
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

    if (uri === 'navidrome://library/recent-songs') {
      try {
        // Get recent songs using our working /song endpoint
        const queryParams = new URLSearchParams({
          _start: '0',
          _end: '10',
          _sort: 'createdAt',
          _order: 'DESC',
        });

        const songs = await client.request<unknown>(`/song?${queryParams.toString()}`);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(
                {
                  resource: 'Recent Songs',
                  description: 'Recently added songs from the music library',
                  timestamp: new Date().toISOString(),
                  data: songs,
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
                  error: 'Failed to fetch recent songs',
                  message: error instanceof Error ? error.message : 'Unknown error',
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }

    if (uri === 'navidrome://server/status') {
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

    throw new Error(`Unknown resource: ${uri}`);
  });
}
