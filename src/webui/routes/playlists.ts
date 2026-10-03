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

import type { ServerResponse } from 'node:http';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import { listPlaylists } from '../../tools/playlist-management/playlist-crud.js';
import { runAction } from '../http-helpers.js';

/**
 * GET /api/playlists lists the user's playlists for the picker modal. It reuses
 * the `list_playlists` tool impl, sorted by name, with the largest page its schema allows (500).
 *
 * The picker is for *playing*, so `onlyWithPlayableTracks` keeps only playlists
 * with at least one track in the currently active libraries.
 */
export function handleListPlaylists(res: ServerResponse, client: NavidromeClient): Promise<void> {
  return runAction(res, () =>
    listPlaylists(
      client,
      {
        offset: 0,
        limit: 500,
        sort: 'name',
        order: 'ASC',
        onlyWithPlayableTracks: true,
      },
      { keep: ['duration'] },
    ),
  );
}
