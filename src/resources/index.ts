/**
 * Navidrome MCP Server - Resource Registry
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

// The MCP spec code for an unknown resource, which the SDK's ErrorCode enum lacks.
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
                  // A resource is not a tool, so the raw message skips toolExecution's prefix.
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
