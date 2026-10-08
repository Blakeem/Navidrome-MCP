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
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { getSettingsStorePath } from '../config/store-path.js';
import { openBrowser } from '../utils/open-browser.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { redact } from '../utils/logger.js';

export interface StartupFailure {
  reason: string;
  /** Navidrome could not be reached, so the configuration was never judged. */
  unreachable: boolean;
}

/** settings.json wins over env vars on every restart, so env advice alone cannot fix a failing store. */
function configFixHint(): string {
  return (
    `Fix the values on the settings page, or edit or remove settings.json at ${getSettingsStorePath()}. ` +
    'The environment variables NAVIDROME_URL, NAVIDROME_USERNAME and NAVIDROME_PASSWORD apply only ' +
    'when no settings.json with a Navidrome URL exists.'
  );
}

/** Shared by the setup-mode log line and both degraded tools, so the remedy text has one source. */
export function buildSetupNotice(settingsUrl: string, failure?: StartupFailure): string {
  const openSettings = `Open the settings page to set it up:\n  ${settingsUrl}\n`;
  const saveAndRestart =
    'Enter your Navidrome URL, username, and password (plus any optional features), Save, then restart this server.\n';

  if (failure === undefined) {
    return (
      `Navidrome MCP is not configured yet.\n${openSettings}${saveAndRestart}` +
      'On a headless machine or in a container (where that loopback URL is unreachable), set environment ' +
      'variables instead and restart: NAVIDROME_URL, NAVIDROME_USERNAME, NAVIDROME_PASSWORD (plus ' +
      'MCP_TRANSPORT=http and MCP_HTTP_EXPOSE=true for a remote-reachable container). They are used ' +
      'automatically whenever no usable settings.json exists.'
    );
  }
  // fetch echoes a credential-bearing URL verbatim in its error, and this notice reaches the LLM.
  const reason = redact(failure.reason) as string;
  if (failure.unreachable) {
    return (
      `Navidrome MCP could not reach Navidrome at the configured URL: ${reason}\n` +
      'The configuration was not rejected. Restart the MCP client once Navidrome is reachable.\n' +
      `To change the settings anyway, open the settings page:\n  ${settingsUrl}`
    );
  }
  return (
    `Navidrome MCP could not start with the current configuration: ${reason}\n` +
    `${openSettings}${saveAndRestart}${configFixHint()}`
  );
}

/** The settings URL goes in every response because the auto-opened browser no-ops on headless or SSH hosts. */
export function registerDegradedTools(server: Server, settingsUrl: string, failure?: StartupFailure): void {
  const notice = buildSetupNotice(settingsUrl, failure);

  const tools: Tool[] = [
    {
      name: 'open_settings',
      description:
        'Open the Navidrome MCP settings page in a browser and return its local URL. ' +
        'Use this when the server is not configured or its configuration failed at startup.',
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
    const content = [{ type: 'text' as const, text: notice }];
    // An unknown name must fail like the full registry does, not return the setup notice.
    if (!tools.some((tool) => tool.name === name)) {
      throw new McpError(ErrorCode.InvalidParams, ErrorFormatter.toolUnknown(name));
    }
    if (name === 'open_settings') {
      openBrowser(settingsUrl);
    }
    // A degraded server has no working connection, so test_connection reports a failed check.
    if (name === 'test_connection') {
      return { content, isError: true };
    }
    return { content };
  });
}
