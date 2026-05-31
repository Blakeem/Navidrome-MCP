/**
 * Navidrome MCP Server - Degraded (unconfigured) tool surface
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
import { openBrowser } from '../utils/open-browser.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

/**
 * Register the minimal toolset for an unconfigured server. The full toolset is
 * withheld until a valid `settings.json` exists; these two tools exist only to
 * route the user into the settings page. The settings URL is surfaced in every
 * response (the channel the user actually sees in their AI client) because the
 * auto-opened browser silently no-ops on headless/SSH hosts.
 */
export function registerDegradedTools(server: Server, settingsUrl: string): void {
  const notice =
    `Navidrome MCP is not configured yet. Open the settings page to set it up:\n  ${settingsUrl}\n` +
    `Enter your Navidrome URL, username, and password (plus any optional features), Save, then restart this server.`;

  const tools: Tool[] = [
    {
      name: 'open_settings',
      description:
        'Open the Navidrome MCP settings page in a browser and return its local URL. ' +
        'Use this when the server is not configured (no Navidrome URL set).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'test_connection',
      description: 'Report Navidrome MCP configuration/connection status.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name } = request.params;
    // Only the two degraded-mode tools are registered; reject anything else
    // instead of masking an unknown tool with a success notice (matches the
    // registry convention).
    if (name !== 'open_settings' && name !== 'test_connection') {
      throw new Error(ErrorFormatter.toolUnknown(name));
    }
    if (name === 'open_settings') {
      openBrowser(settingsUrl);
    }
    return {
      content: [{ type: 'text' as const, text: notice }],
    };
  });
}
