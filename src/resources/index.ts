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
import { transformSongsToDTO } from '../transformers/song-transformer.js';
import type { RecentlyAddedSongsResponse } from '../types/dto.js';

export function registerResources(server: Server, client: NavidromeClient): void {
  // Define available resources
  const resources: Resource[] = [
    {
      uri: 'navidrome://library/recent-songs',
      name: 'Recently Added Songs',
      description: 'Songs recently added to the music library (newest first). Supports query parameters: ?limit=N (1-50, default 10) &offset=N (default 0) for pagination',
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

    // Parse URI to handle query parameters
    const baseUri = uri.split('?')[0];

    if (baseUri === 'navidrome://library/recent-songs') {
      try {
        // Parse optional query parameters from URI
        const url = new URL(uri, 'https://example.com');
        
        // Parse and validate limit parameter
        const limitParam = url.searchParams.get('limit');
        let limit = 10; // default
        if (limitParam !== null) {
          const parsedLimit = parseInt(limitParam, 10);
          if (isNaN(parsedLimit)) {
            throw new Error(`Invalid limit parameter: '${limitParam}'. Must be a number between 1 and 50.`);
          }
          limit = Math.min(50, Math.max(1, parsedLimit));
        }
        
        // Parse and validate offset parameter
        const offsetParam = url.searchParams.get('offset');
        let offset = 0; // default
        if (offsetParam !== null) {
          const parsedOffset = parseInt(offsetParam, 10);
          if (isNaN(parsedOffset) || parsedOffset < 0) {
            throw new Error(`Invalid offset parameter: '${offsetParam}'. Must be a non-negative number.`);
          }
          offset = parsedOffset;
        }

        // Get recent songs using our working /song endpoint
        const queryParams = new URLSearchParams({
          _start: offset.toString(),
          _end: (offset + limit).toString(),
          _sort: 'createdAt',
          _order: 'DESC',
        });

        const rawSongs = await client.request<unknown>(`/song?${queryParams.toString()}`);
        const songs = transformSongsToDTO(rawSongs);

        const response: RecentlyAddedSongsResponse = {
          resource: 'Recently Added Songs',
          description: 'Songs recently added to the music library (newest first)',
          timestamp: new Date().toISOString(),
          count: songs.length,
          offset,
          limit,
          songs,
        };

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(response, null, 2),
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
                  error: 'Failed to fetch recently added songs',
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

    throw new Error(`Unknown resource: ${baseUri}`);
  });
}
