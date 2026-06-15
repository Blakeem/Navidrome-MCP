/**
 * Navidrome MCP Server - Web UI Playlist Routes
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

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import { playPlaylist, PlayPlaylistSchema } from '../../tools/playback.js';
import { listPlaylists } from '../../tools/playlist-management/playlist-crud.js';
import { readJsonBody, runAction, writeError } from '../http-helpers.js';

/**
 * GET /api/playlists — List the user's playlists for the picker modal. Reuses
 * the `list_playlists` tool impl; sorted by name, generous page (the schema
 * caps limit at 500). The frontend renders id/name/songCount.
 *
 * `onlyWithPlayableTracks: true` — the picker is for *playing*, so only show
 * playlists with at least one track in the currently active libraries (an
 * empty or fully-other-library playlist would yield nothing to play).
 */
export function handleListPlaylists(res: ServerResponse, client: NavidromeClient): Promise<void> {
  return runAction(res, () =>
    listPlaylists(client, {
      offset: 0,
      limit: 500,
      sort: 'name',
      order: 'ASC',
      onlyWithPlayableTracks: true,
    }),
  );
}

/**
 * POST /api/playlists/play — Body `{playlistId, mode?: 'replace'|'append',
 * shuffle?: boolean}`. Plays the whole playlist. Validation is delegated to the
 * Zod schema inside the `play_playlist` impl (re-used as-is so the UI cannot
 * drift from the MCP shape).
 */
export async function handlePlayPlaylist(
  req: IncomingMessage,
  res: ServerResponse,
  client: NavidromeClient,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    writeError(res, 400, err instanceof Error ? err.message : 'invalid JSON body');
    return;
  }

  // Re-validate at the route boundary so a malformed request (missing
  // playlistId, wrong types, null body) returns HTTP 400 — a client input
  // error — rather than the generic 500 that runAction maps every thrown
  // error to. The impl re-parses with the same schema, so the contract cannot
  // drift.
  const validation = PlayPlaylistSchema.safeParse(body);
  if (!validation.success) {
    const message = validation.error.issues.map((issue) => issue.message).join('; ');
    writeError(res, 400, message !== '' ? message : 'invalid request body');
    return;
  }

  return runAction(res, () => playPlaylist(client, validation.data));
}
