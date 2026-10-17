/**
 * Navidrome MCP Server - Web UI SSE Route
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import type { SseBroadcaster } from '../broadcaster.js';

export async function handleEvents(
  res: ServerResponse,
  broadcaster: SseBroadcaster,
): Promise<void> {
  await broadcaster.addClient(res);
}
