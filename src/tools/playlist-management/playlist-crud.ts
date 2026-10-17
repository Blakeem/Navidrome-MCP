/**
 * Navidrome MCP Server - Playlist CRUD Operations
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { NavidromeClient } from '../../client/navidrome-client.js';
import {
  transformPlaylistsToDTO,
  transformToPlaylistDTO,
  type RawPlaylist,
} from '../../transformers/index.js';
import type { TransformOptions } from '../../transformers/shared-transformers.js';
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

// Caps the playable-only candidate read and its probes. Playlists past it are never considered.
const PLAYLIST_FETCH_MAX = 500;
// Caps concurrent probes, so the view never opens one connection per playlist at once.
const PROBE_CONCURRENCY = 6;

/** An uninitialized library manager adds no `library_id`, so the probe sees every library. */
function activeLibrariesCoverEverything(): boolean {
  if (!libraryManager.isInitialized()) return true;
  const active = new Set(libraryManager.getActiveLibraryIds());
  const available = libraryManager.getAvailableLibraries();
  return available.every((lib) => active.has(lib.id));
}

/** The one-row page exists only to read the library-filtered X-Total-Count. */
async function playlistHasPlayableTracks(
  client: NavidromeClient,
  playlistId: string,
): Promise<boolean> {
  const endpoint = `/playlist/${encodeURIComponent(playlistId)}/tracks?_start=0&_end=1`;
  const { total } = await client.requestWithLibraryFilterAndMeta<unknown>(endpoint);
  return total !== null && total > 0;
}

// A smart playlist's cached songCount stays 0 until a track read refreshes it, so the count
// cannot rule it out.
function collectSmartPlaylistIds(rows: unknown): Set<string> {
  const smartIds = new Set<string>();
  if (!Array.isArray(rows)) {
    return smartIds;
  }
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const record = row as Record<string, unknown>;
    const rules = record['rules'];
    if (rules !== null && rules !== undefined && typeof record['id'] === 'string') {
      smartIds.add(record['id']);
    }
  }
  return smartIds;
}

async function filterToPlayablePlaylists(
  client: NavidromeClient,
  candidates: PlaylistDTO[],
  smartIds: ReadonlySet<string>,
): Promise<PlaylistDTO[]> {
  // With every library active, a probe repeats `songCount`, so a non-empty playlist is not probed.
  const probeNonEmpty = !activeLibrariesCoverEverything();
  const keptIds = new Set<string>();
  const toProbe: PlaylistDTO[] = [];

  for (const p of candidates) {
    if (smartIds.has(p.id) || (probeNonEmpty && p.songCount > 0)) {
      toProbe.push(p);
    } else if (p.songCount > 0) {
      keptIds.add(p.id);
    }
  }
  for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
    const batch = toProbe.slice(i, i + PROBE_CONCURRENCY);
    // One failed probe must not blank the web-UI play picker. A rejected probe keeps
    // the playlist, since hiding a playable one is worse than showing a maybe-unplayable one.
    const results = await Promise.allSettled(
      batch.map((p) => playlistHasPlayableTracks(client, p.id)),
    );
    batch.forEach((p, idx) => {
      const r = results[idx];
      if (r === undefined) return;
      if (r.status === 'fulfilled') {
        if (r.value) keptIds.add(p.id);
      } else {
        logger.warn(`playable-probe failed for playlist ${p.id}; keeping it (fail-open):`, r.reason);
        keptIds.add(p.id);
      }
    });
  }
  return candidates.filter((p) => keptIds.has(p.id));
}

/**
 * `offset` and `limit` are not echoed, since the LLM just sent them. `transformOptions` lets a
 * non-MCP caller such as the web remote keep a field like the numeric duration.
 */
export async function listPlaylists(client: NavidromeClient, args: unknown, transformOptions: TransformOptions = {}): Promise<{
  playlists: PlaylistDTO[];
  total: number;
  truncated?: boolean;
}> {
  try {
    const params = PlaylistPaginationSchema.parse(args);
    logger.debug('Tool listPlaylists called with args:', params);

    // Navidrome ignores `library_id` on /api/playlist. The full set also lets the LLM add songs
    // to empty or other-library playlists.
    if (!params.onlyWithPlayableTracks) {
      const queryParams = new URLSearchParams({
        _start: params.offset.toString(),
        _end: (params.offset + params.limit).toString(),
        _sort: params.sort,
        _order: params.order,
      });

      const { data, total } = await client.requestWithMeta<unknown>(`/playlist?${queryParams.toString()}`);
      const playlists = transformPlaylistsToDTO(data, transformOptions);

      return {
        playlists,
        total: total ?? playlists.length,
      };
    }

    // Paging runs over the filtered rows so offset, limit and total describe the same set.
    const queryParams = new URLSearchParams({
      _start: '0',
      _end: PLAYLIST_FETCH_MAX.toString(),
      _sort: params.sort,
      _order: params.order,
    });
    const { data, total } = await client.requestWithMeta<unknown>(`/playlist?${queryParams.toString()}`);
    const allPlaylists = transformPlaylistsToDTO(data, transformOptions);
    const smartIds = collectSmartPlaylistIds(data);

    // Rows past PLAYLIST_FETCH_MAX are never fetched or counted, so the response flags the
    // understated total.
    const truncated = (total !== null && total > PLAYLIST_FETCH_MAX) || allPlaylists.length >= PLAYLIST_FETCH_MAX;
    if (truncated) {
      logger.warn(
        `list_playlists playable-only candidate set was truncated at PLAYLIST_FETCH_MAX (${PLAYLIST_FETCH_MAX}). ` +
          `Server reports ${total ?? 'unknown'} total playlists. Results and total may be incomplete.`
      );
    }

    const filtered = await filterToPlayablePlaylists(client, allPlaylists, smartIds);
    const page = filtered.slice(params.offset, params.offset + params.limit);

    return {
      playlists: page,
      total: filtered.length,
      ...(truncated ? { truncated: true } : {}),
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('list_playlists', error));
  }
}

export async function getPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  try {
    const params = PlaylistIdSchema.parse(args);
    logger.debug('Tool getPlaylist called with args:', params);

    const rawPlaylist = await client.request<unknown>(`/playlist/${encodeURIComponent(params.playlistId)}`);
    // A single-item lookup has no array to bloat context, so it is always verbose.
    return transformToPlaylistDTO(rawPlaylist as RawPlaylist, { verbose: true });
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_playlist', error));
  }
}

type CreatedPlaylistDTO = PlaylistDTO & { note?: string };

/** A failed read-back still resolves with the new id, since a retry would create a duplicate. */
export async function createPlaylist(client: NavidromeClient, args: unknown): Promise<CreatedPlaylistDTO> {
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

    // `POST /playlist` echoes only `{id}`, so a read-back returns the same DTO as `get_playlist`.
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

    let playlist: CreatedPlaylistDTO;
    try {
      const rawPlaylist = await client.request<unknown>(`/playlist/${encodeURIComponent(newId)}`);
      playlist = transformToPlaylistDTO(rawPlaylist as RawPlaylist, { verbose: true });
    } catch (error) {
      logger.warn(`create_playlist: created ${newId}, but reading it back failed: ${error instanceof Error ? error.message : String(error)}`);
      const sentPlaylist: RawPlaylist = { id: newId, name: params.name, public: params.public, songCount: 0 };
      if (params.comment !== undefined) {
        sentPlaylist.comment = params.comment;
      }
      return {
        ...transformToPlaylistDTO(sentPlaylist),
        note: `Created playlist ${newId}, but reading it back failed. Do not call create_playlist again. Call get_playlist with playlistId ${newId} for its details.`,
      };
    }

    // Defensive fallbacks in case the read-back omits the name or comment.
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

    // Navidrome's PUT answers with the full stored playlist.
    return transformToPlaylistDTO(rawPlaylist as RawPlaylist, { verbose: true });
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('update_playlist', error));
  }
}

/** The deleted id is not echoed, since the LLM just sent it. */
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