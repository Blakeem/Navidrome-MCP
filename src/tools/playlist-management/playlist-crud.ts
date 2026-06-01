/**
 * Navidrome MCP Server - Playlist CRUD Operations
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

import type { NavidromeClient } from '../../client/navidrome-client.js';
import {
  transformPlaylistsToDTO,
  transformToPlaylistDTO,
  type RawPlaylist,
} from '../../transformers/index.js';
import type {
  PlaylistDTO,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
} from '../../types/index.js';
import {
  PlaylistPaginationSchema,
  CreatePlaylistSchema,
  UpdatePlaylistSchema,
  PlaylistIdSchema,
} from '../../schemas/index.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { logger } from '../../utils/logger.js';
import { libraryManager } from '../../services/library-manager.js';

// Upper bound for the pre-filter fetch when `onlyWithPlayableTracks` is on:
// we must pull the full candidate set before filtering so in-memory
// offset/limit are correct over the FILTERED view. Matches the schema's max
// limit (500); playlist counts are small in practice.
const PLAYLIST_FETCH_MAX = 500;
// Concurrency cap for the per-playlist track probes — bounded fan-out so we
// don't open one connection per playlist at once.
const PROBE_CONCURRENCY = 6;

/**
 * Return true when filtering by active library is a no-op — either the
 * library manager isn't initialized yet, or every available library is
 * active. In both cases an "active-library" probe would match the same rows
 * as the unfiltered call, so we can skip probing and just drop empty
 * playlists.
 */
function activeLibrariesCoverEverything(): boolean {
  if (!libraryManager.isInitialized()) return true;
  const active = new Set(libraryManager.getActiveLibraryIds());
  const available = libraryManager.getAvailableLibraries();
  return available.every((lib) => active.has(lib.id));
}

/**
 * Probe a single playlist for >=1 track in the active libraries. Uses the
 * library-filtered `/playlist/{id}/tracks` endpoint (X-Total-Count reflects
 * the filtered count) with the smallest possible page since we only need the
 * total, not the rows.
 */
async function playlistHasPlayableTracks(
  client: NavidromeClient,
  playlistId: string,
): Promise<boolean> {
  const endpoint = `/playlist/${encodeURIComponent(playlistId)}/tracks?_start=0&_end=1`;
  const { total } = await client.requestWithLibraryFilterAndMeta<unknown>(endpoint);
  return total !== null && total > 0;
}

/**
 * Filter the candidate playlists down to those with >=1 track in the active
 * libraries, probing each in bounded-concurrency batches. An empty playlist
 * (`songCount === 0`) can never have playable tracks, so it's dropped without
 * a probe.
 */
async function filterToPlayablePlaylists(
  client: NavidromeClient,
  candidates: PlaylistDTO[],
): Promise<PlaylistDTO[]> {
  const nonEmpty = candidates.filter((p) => p.songCount > 0);
  const kept: PlaylistDTO[] = [];
  for (let i = 0; i < nonEmpty.length; i += PROBE_CONCURRENCY) {
    const batch = nonEmpty.slice(i, i + PROBE_CONCURRENCY);
    // allSettled (not all) so one transient probe failure can't blank the whole
    // list — this powers the web-UI play picker. Fail OPEN: a rejected probe
    // keeps the playlist (better to show a maybe-unplayable entry than to hide a
    // playable one because of a network blip).
    const results = await Promise.allSettled(
      batch.map((p) => playlistHasPlayableTracks(client, p.playlistId)),
    );
    batch.forEach((p, idx) => {
      const r = results[idx];
      if (r === undefined) return;
      if (r.status === 'fulfilled') {
        if (r.value) kept.push(p);
      } else {
        logger.warn(`playable-probe failed for playlist ${p.playlistId}; keeping it (fail-open):`, r.reason);
        kept.push(p);
      }
    });
  }
  return kept;
}

/**
 * List all playlists accessible to the user. `offset`/`limit` are NOT echoed
 * — the LLM just sent them and tracks its own pagination state. `total` is
 * server-derived (X-Total-Count) so the LLM can plan further pages.
 */
export async function listPlaylists(client: NavidromeClient, args: unknown): Promise<{
  playlists: PlaylistDTO[];
  total: number;
}> {
  try {
    const params = PlaylistPaginationSchema.parse(args);
    logger.debug('Tool listPlaylists called with args:', params);

    // Default path (full management view) — single server-paginated read.
    // `/api/playlist?library_id=X` is IGNORED by Navidrome, so there is no
    // server-side library filter to apply here; the LLM needs the full set so
    // it can add songs to empty/other-library playlists too.
    if (!params.onlyWithPlayableTracks) {
      const queryParams = new URLSearchParams({
        _start: params.offset.toString(),
        _end: (params.offset + params.limit).toString(),
        _sort: params.sort,
        _order: params.order,
      });

      const { data, total } = await client.requestWithMeta<unknown>(`/playlist?${queryParams.toString()}`);
      const playlists = transformPlaylistsToDTO(data);

      return {
        playlists,
        total: total ?? playlists.length,
      };
    }

    // Playable-only view. Because `/api/playlist` can't be library-filtered,
    // we must pull the full candidate set, filter it, then paginate over the
    // FILTERED result so `offset`/`limit`/`total` stay correct.
    const queryParams = new URLSearchParams({
      _start: '0',
      _end: PLAYLIST_FETCH_MAX.toString(),
      _sort: params.sort,
      _order: params.order,
    });
    const { data } = await client.requestWithMeta<unknown>(`/playlist?${queryParams.toString()}`);
    const allPlaylists = transformPlaylistsToDTO(data);

    // Optimization: when the active libraries cover everything (or the
    // library manager isn't initialized), a probe would match the same rows
    // as `songCount`, so just drop empty playlists — no per-playlist probes.
    const filtered = activeLibrariesCoverEverything()
      ? allPlaylists.filter((p) => p.songCount > 0)
      : await filterToPlayablePlaylists(client, allPlaylists);

    const page = filtered.slice(params.offset, params.offset + params.limit);

    return {
      playlists: page,
      total: filtered.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_playlists', error));
  }
}

/**
 * Get a specific playlist by ID
 */
export async function getPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  try {
    const params = PlaylistIdSchema.parse(args);
    logger.debug('Tool getPlaylist called with args:', params);

    const rawPlaylist = await client.request<unknown>(`/playlist/${encodeURIComponent(params.playlistId)}`);
    return transformToPlaylistDTO(rawPlaylist as RawPlaylist);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_playlist', error));
  }
}

/**
 * Create a new playlist
 */
export async function createPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  try {
    const params = CreatePlaylistSchema.parse(args);
    logger.debug('Tool createPlaylist called with args:', params);

    const requestBody: CreatePlaylistRequest = {
      name: params.name,
      public: params.public,
    };

    if (params.comment !== undefined) {
      requestBody.comment = params.comment;
    }

    // Navidrome's `POST /playlist` only echoes `{id}` — no metadata. Re-fetch
    // the playlist by id so callers receive the same DTO shape as
    // `get_playlist` / `list_playlists` (owner, ownerId, createdAt,
    // updatedAt, etc.). The transformer's `name`/`comment` fallbacks remain
    // as defence-in-depth in case the GET also comes back incomplete.
    const created = await client.request<{ id?: string }>('/playlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const newId = created.id;
    if (typeof newId !== 'string' || newId === '') {
      throw new Error('Navidrome POST /playlist did not return a playlist id');
    }

    const rawPlaylist = await client.request<unknown>(`/playlist/${encodeURIComponent(newId)}`);
    const playlist = transformToPlaylistDTO(rawPlaylist as RawPlaylist);

    // Defence-in-depth fallbacks if the follow-up GET also omits fields.
    if (playlist.name === '') {
      playlist.name = params.name;
    }
    if (params.comment !== undefined && params.comment !== '' && (playlist.comment === undefined || playlist.comment === '')) {
      playlist.comment = params.comment;
    }

    return playlist;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('create_playlist', error));
  }
}

/**
 * Update a playlist's metadata
 */
export async function updatePlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  try {
    const params = UpdatePlaylistSchema.parse(args);
    logger.debug('Tool updatePlaylist called with args:', params);

    const requestBody: UpdatePlaylistRequest = {};

    if (params.name !== undefined) {
      requestBody.name = params.name;
    }

    if (params.comment !== undefined) {
      requestBody.comment = params.comment;
    }

    if (params.public !== undefined) {
      requestBody.public = params.public;
    }

    const rawPlaylist = await client.request<unknown>(`/playlist/${encodeURIComponent(params.playlistId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const playlist = transformToPlaylistDTO(rawPlaylist as RawPlaylist);

    // Fix the name if it was updated but not properly returned from API
    if (params.name !== undefined && params.name !== '' && playlist.name === '') {
      playlist.name = params.name;
    }

    // Fix the comment if it was updated but not properly returned from API
    if (params.comment !== undefined && (playlist.comment === undefined || playlist.comment === '')) {
      playlist.comment = params.comment;
    }

    return playlist;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('update_playlist', error));
  }
}

/**
 * Delete a playlist (owner or admin only). The deleted id is intentionally
 * NOT echoed in the response — the LLM just sent it. The success flag plus
 * the message ("Successfully deleted playlist") is enough to confirm the
 * round trip; the id is captured in the DEBUG log for diagnostics.
 */
export async function deletePlaylist(client: NavidromeClient, args: unknown): Promise<{ success: boolean; message: string }> {
  try {
    const params = PlaylistIdSchema.parse(args);
    logger.debug('Tool deletePlaylist called with args:', params);

    await client.request<unknown>(`/playlist/${encodeURIComponent(params.playlistId)}`, {
      method: 'DELETE',
    });

    return {
      success: true,
      message: 'Successfully deleted playlist',
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('delete_playlist', error));
  }
}