/**
 * Navidrome MCP Server - Web UI Playlist Routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import { listPlaylists } from '../../tools/playlist-management/playlist-crud.js';
import { runAction } from '../http-helpers.js';

/**
 * 500 is the largest page the `list_playlists` schema allows. The picker plays what the user picks,
 * so it lists only playlists with a track in the active libraries.
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
