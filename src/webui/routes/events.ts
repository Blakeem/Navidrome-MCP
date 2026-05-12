/**
 * Navidrome MCP Server - Web UI SSE Route
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

import type { ServerResponse } from 'node:http';
import type { SseBroadcaster } from '../broadcaster.js';

/**
 * GET /api/events — SSE stream. Handing the response to the broadcaster
 * also writes the headers + initial retry directive + first snapshot.
 * Returns once registration is complete; the response stays open until
 * the client disconnects.
 */
export async function handleEvents(
  res: ServerResponse,
  broadcaster: SseBroadcaster,
): Promise<void> {
  await broadcaster.addClient(res);
}
