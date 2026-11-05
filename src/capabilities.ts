/**
 * Navidrome MCP Server - Capabilities Configuration
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

export const MCP_CAPABILITIES: ServerCapabilities = {
  tools: {},
  resources: {
    subscribe: false,
    listChanged: false,
  },
};

export const SETUP_CAPABILITIES: ServerCapabilities = { tools: {} };
