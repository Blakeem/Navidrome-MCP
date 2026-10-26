/**
 * Navidrome MCP Server - Web UI SSE Route
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import type { GuestJukebox } from '../auth/auth-service.js';
import type { SseBroadcaster } from '../broadcaster.js';

export async function handleEvents(
  res: ServerResponse,
  broadcaster: SseBroadcaster,
): Promise<void> {
  await broadcaster.addClient(res);
}

/** The guest stream carries the reduced snapshot, with the requester's own `jukebox` field and songs. */
export async function handleGuestEvents(
  res: ServerResponse,
  broadcaster: SseBroadcaster,
  sessionId: string,
  jukebox: () => GuestJukebox | null,
): Promise<void> {
  await broadcaster.addGuestClient(res, sessionId, jukebox);
}
