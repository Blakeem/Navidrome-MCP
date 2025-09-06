#!/usr/bin/env node
/**
 * Navidrome MCP Server
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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { NavidromeClient } from './client/navidrome-client.js';
import { logger } from './utils/logger.js';
import { getPackageVersion } from './utils/version.js';
import { MCP_CAPABILITIES } from './capabilities.js';

async function main(): Promise<void> {
  try {
    const config = await loadConfig();
    logger.setDebug(config.debug);

    // Add startup diagnostics for troubleshooting
    logger.debug('Starting Navidrome MCP Server...');
    logger.debug('Node version:', process.version);
    logger.debug('Platform:', process.platform);
    logger.debug('Environment variables present:', {
      NAVIDROME_URL: (process.env['NAVIDROME_URL'] !== null && process.env['NAVIDROME_URL'] !== undefined && process.env['NAVIDROME_URL'] !== ''),
      NAVIDROME_USERNAME: (process.env['NAVIDROME_USERNAME'] !== null && process.env['NAVIDROME_USERNAME'] !== undefined && process.env['NAVIDROME_USERNAME'] !== ''),
      NAVIDROME_PASSWORD: (process.env['NAVIDROME_PASSWORD'] !== null && process.env['NAVIDROME_PASSWORD'] !== undefined && process.env['NAVIDROME_PASSWORD'] !== ''),
    });

    const server = new Server(
      {
        name: 'navidrome-mcp',
        version: getPackageVersion(),
      },
      {
        capabilities: MCP_CAPABILITIES,
      }
    );

    const client = new NavidromeClient(config);
    await client.initialize();

    registerTools(server, client, config);
    registerResources(server, client);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('Navidrome MCP Server started successfully');
  } catch (error) {
    // Provide detailed error information for debugging
    logger.error('Failed to start Navidrome MCP Server');
    logger.error('Error details:', error);
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Stack trace:', error.stack);
    }
    throw error; // Re-throw to be caught by outer handler
  }
}

main().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
