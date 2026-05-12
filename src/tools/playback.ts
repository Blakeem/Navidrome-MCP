/**
 * Navidrome MCP Server - Playback Tool Functions
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

import { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import {
  NonEmptyStringArraySchema,
  SearchAlbumsSchema,
  SearchSongsSchema,
} from '../schemas/common.js';
import {
  playbackEngine,
  type PlaybackStatus,
  type PlaylistEntry,
  type QueueTrackMetadata,
} from '../services/playback/playback-engine.js';
import { searchAlbums, searchSongs } from './search/index.js';
import { parseDuration } from '../transformers/shared-transformers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { MAX_ALBUM_PAGES, MAX_ALBUM_TRACKS } from '../constants/defaults.js';

interface PauseResult {
  success: true;
  paused: true;
}

interface ResumeResult {
  success: true;
  paused: false;
}

interface SetVolumeResult {
  success: true;
  volume: number;
}

// Note: `mode` is intentionally NOT echoed on play_* results. The LLM-supplied
// mode can also be silently demoted to 'replace' by the engine when a radio
// stream is loaded (radio/songs mutual exclusion); echoing the requested mode
// would lie to the LLM about what actually happened. The demotion is logged
// at WARN in the engine AND surfaced via the optional `demoted` field below
// so the LLM has a structured signal that `mode: 'append'` was silently
// promoted to `replace` (e.g. radio queue evicted before song load).
// Similarly, `shuffled`/`shuffle` are pure echoes of the LLM's input and are
// dropped.
interface PlaySongsResult {
  success: true;
  count: number;
  /** Set to true ONLY when the request was `mode: 'append'` but a radio
      stream in the queue forced a clear-and-replace. Omitted in the normal
      case so its presence is itself the signal. */
  demoted?: true;
}

interface PlayAlbumsResult {
  success: true;
  albumCount: number;
  trackCount: number;
  demoted?: true;
}

interface PlayAlbumsSearchResult {
  success: true;
  matchCount: number;
  albumCount: number;
  trackCount: number;
  appliedFilters?: Record<string, string>;
  demoted?: true;
}

interface PlaySongsSearchResult {
  success: true;
  count: number;
  appliedFilters?: Record<string, string>;
  demoted?: true;
}

interface PlayPlaylistResult {
  success: true;
  count: number;
  demoted?: true;
}

interface NextResult {
  success: true;
}

interface PreviousResult {
  success: true;
}

interface SeekResult {
  success: true;
}

interface NowPlayingResult {
  engineRunning: boolean;
  title?: string;
  artist?: string;
  album?: string;
  position?: number;
  duration?: number;
  paused?: boolean;
  queueIndex?: number;
  queueLength?: number;
  // Set when a radio stream is currently loaded. `isRadio` is true when the
  // current queue entry's filename doesn't carry a Navidrome song `id`.
  // `radioStation` is populated when the engine has recorded a station name
  // — only when the radio was started in the same MCP session (session-scoped).
  isRadio?: boolean;
  radioStation?: { name: string };
}

/**
 * LLM-facing shape of a play-queue entry. Intentionally a strict subset of
 * the internal `PlaylistEntry`:
 *   - `filename` is dropped — even after `sanitizeFilename` strips Subsonic
 *     auth params, it still leaks the LAN host/port the MCP server can reach
 *     Navidrome on. That topology is internal plumbing the model has no need
 *     for, and is also a security-sensitive disclosure (CLAUDE.md rule).
 *   - Everything else passes through unchanged.
 */
interface PlayQueueItem {
  index: number;
  songId: string | null;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  isCurrent: boolean;
  isPlaying: boolean;
}

interface GetPlayQueueResult {
  items: PlayQueueItem[];
  length: number;
  currentIndex?: number;
}

interface ClearPlayQueueResult {
  success: true;
}

interface ShufflePlayQueueResult {
  success: true;
}

interface MoveInPlayQueueResult {
  success: true;
  noop?: true;
}

interface RemoveFromPlayQueueResult {
  success: true;
}

interface PlayQueueIndexResult {
  success: true;
}

const SetVolumeSchema = z.object({
  level: z.number().min(0).max(100),
});

const QueueModeSchema = z.enum(['replace', 'append']).default('replace');

const PlaySongsSchema = z.object({
  songIds: NonEmptyStringArraySchema,
  mode: QueueModeSchema,
  shuffle: z.boolean().default(false),
});

const PlayAlbumsSchema = z.object({
  albumIds: NonEmptyStringArraySchema,
  mode: QueueModeSchema,
  shuffle: z.enum(['none', 'albums', 'songs']).default('none'),
});

const PlayAlbumsSearchSchema = SearchAlbumsSchema.extend({
  mode: QueueModeSchema,
  shuffle: z.enum(['none', 'albums', 'songs']).default('none'),
});

const PlaySongsSearchSchema = SearchSongsSchema.extend({
  mode: QueueModeSchema,
  shuffle: z.boolean().default(false),
});

const PlayPlaylistSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  mode: QueueModeSchema,
  shuffle: z.boolean().default(false),
});

const SeekSchema = z.object({
  seconds: z.number(),
  mode: z.enum(['absolute', 'relative']).default('relative'),
});

const MoveInPlayQueueSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
});

const RemoveFromPlayQueueSchema = z.object({
  index: z.number().int().min(0),
});

const PlayQueueIndexSchema = z.object({
  index: z.number().int().min(0),
});

/**
 * Pause local audio playback. Lazy-spawns mpv on first call.
 */
export async function pause(_args: unknown): Promise<PauseResult> {
  try {
    logger.debug('playback: pause');
    await playbackEngine.pause();
    return { success: true, paused: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('pause', error));
  }
}

/**
 * Resume local audio playback. Lazy-spawns mpv on first call.
 */
export async function resume(_args: unknown): Promise<ResumeResult> {
  try {
    logger.debug('playback: resume');
    await playbackEngine.resume();
    return { success: true, paused: false };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('resume', error));
  }
}

/**
 * Set mpv's internal volume. `level` is clamped to [0, 100].
 * Lazy-spawns mpv on first call.
 */
export async function setVolume(args: unknown): Promise<SetVolumeResult> {
  let parsed: z.infer<typeof SetVolumeSchema>;
  try {
    parsed = SetVolumeSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('set_volume', error));
  }

  try {
    logger.debug(`playback: set_volume level=${parsed.level}`);
    const applied = await playbackEngine.setVolume(parsed.level);
    return { success: true, volume: applied };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('set_volume', error));
  }
}

/**
 * Report engine health. Does NOT spawn mpv, but will silently attach to an
 * already-running mpv (e.g. one spawned by a previous MCP server that has
 * since exited) so the report reflects reality after a restart.
 */
export async function playbackStatus(_args: unknown): Promise<PlaybackStatus> {
  try {
    await playbackEngine.ensureAttached();
    return playbackEngine.getStatus();
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('playback_status', error));
  }
}

/**
 * Play one or many songs through the local speakers. Trusts the provided
 * IDs without per-track Navidrome verification (verifying N tracks would
 * cost N round-trips; mpv's `end-file` event surfaces invalid IDs at
 * playback time). Optionally shuffles the new batch with Fisher-Yates
 * before queueing — `mode='append'` with `shuffle=true` shuffles ONLY the
 * new batch, leaving the existing queue order untouched.
 */
export async function playSongs(client: NavidromeClient, args: unknown): Promise<PlaySongsResult> {
  let parsed: z.infer<typeof PlaySongsSchema>;
  try {
    parsed = PlaySongsSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_songs', error));
  }

  try {
    logger.debug(`playback: play_songs count=${parsed.songIds.length} mode=${parsed.mode} shuffle=${parsed.shuffle}`);

    const ordered = parsed.shuffle ? fisherYatesShuffle(parsed.songIds) : [...parsed.songIds];

    if (parsed.shuffle) {
      logger.debug(`playback: shuffled song order: ${ordered.join(',')}`);
    }

    // Best-effort metadata lookup so `get_play_queue` reports titles for
    // every queue entry, not just the one mpv is currently spinning.
    // Failures here don't block enqueue — the queue itself is the load-bearing
    // operation; metadata is a UX nicety.
    const metadata = await fetchSongMetadata(client, ordered);

    const { demoted } = await playbackEngine.enqueue(ordered, parsed.mode, metadata);

    const out: PlaySongsResult = {
      success: true,
      count: ordered.length,
    };
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_songs', error));
  }
}

/**
 * Play one or many albums through the local speakers. Resolves each album
 * to its ordered track list, applies the requested shuffle mode, then loads
 * the result into the mpv playlist via `enqueue`.
 *
 * Shuffle modes:
 *   - `'none'`: input album order, natural track order within each album
 *   - `'albums'`: shuffle the album order; tracks within each album stay in
 *     natural order
 *   - `'songs'`: flatten all tracks then shuffle the flat list
 *
 * Albums that resolve to zero tracks are silently skipped. If every album
 * resolves to zero tracks, throws `'No tracks found across all albums'`.
 */
export async function playAlbums(client: NavidromeClient, args: unknown): Promise<PlayAlbumsResult> {
  let parsed: z.infer<typeof PlayAlbumsSchema>;
  try {
    parsed = PlayAlbumsSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_albums', error));
  }

  try {
    logger.debug(`playback: play_albums count=${parsed.albumIds.length} mode=${parsed.mode} shuffle=${parsed.shuffle}`);

    // Resolve each album to its track IDs (and the metadata we'll later hand
    // to the engine cache so `get_play_queue` can report titles for the full
    // queue, not just the currently-playing track). Skip albums that come
    // back empty; surface a clear error only if every album is empty.
    const albumTracks: string[][] = [];
    const metaByAlbum: QueueTrackMetadata[][] = [];
    for (const albumId of parsed.albumIds) {
      const { ids, metadata } = await fetchAlbumTrackIds(client, albumId);
      if (ids.length > 0) {
        albumTracks.push(ids);
        metaByAlbum.push(metadata);
      } else {
        logger.debug(`playback: play_albums skipping empty album ${albumId}`);
      }
    }

    if (albumTracks.length === 0) {
      throw new Error('No tracks found across all albums');
    }

    let flat: string[];
    switch (parsed.shuffle) {
      case 'albums':
        flat = fisherYatesShuffle(albumTracks).flat();
        break;
      case 'songs':
        flat = fisherYatesShuffle(albumTracks.flat());
        break;
      default:
        flat = albumTracks.flat();
        break;
    }

    if (parsed.shuffle !== 'none') {
      logger.debug(`playback: play_albums shuffled (${parsed.shuffle}) → ${flat.length} tracks`);
    }

    // Metadata is order-invariant — the engine indexes by `songId`, not by
    // queue position — so we can flatten regardless of the shuffle strategy.
    const metadata = metaByAlbum.flat();

    const { demoted } = await playbackEngine.enqueue(flat, parsed.mode, metadata);

    const out: PlayAlbumsResult = {
      success: true,
      albumCount: albumTracks.length,
      trackCount: flat.length,
    };
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_albums', error));
  }
}

/**
 * Run an album search and pipe the results into the live play queue.
 *
 * Identical shuffle / per-album track-resolution semantics to `playAlbums`,
 * but the album set is selected by passing through every filter accepted by
 * `search_albums` (query, genre, artist, year range, starred, etc.) instead
 * of an explicit ID list. This is the one-shot path for filter-driven
 * playback intents like "play 5 random starred albums" — composable with
 * `play_albums` for cases where the AI has already listed the albums and
 * wants to play those exact ones.
 */
export async function playAlbumsSearch(
  client: NavidromeClient,
  config: Config,
  args: unknown
): Promise<PlayAlbumsSearchResult> {
  let parsed: z.infer<typeof PlayAlbumsSearchSchema>;
  try {
    parsed = PlayAlbumsSearchSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_albums_search', error));
  }

  try {
    const { mode, shuffle, ...searchArgs } = parsed;
    logger.debug(`playback: play_albums_search mode=${mode} shuffle=${shuffle}`);

    const result = await searchAlbums(client, config, searchArgs);
    if (result.albums.length === 0) {
      throw new Error('No albums matched the search filters');
    }

    // Resolve each album's track list (with metadata for the engine queue
    // cache — see playAlbums for the rationale). Skip albums that come back
    // empty; surface a clear error only if every album is empty.
    const albumTracks: string[][] = [];
    const metaByAlbum: QueueTrackMetadata[][] = [];
    for (const album of result.albums) {
      const { ids, metadata } = await fetchAlbumTrackIds(client, album.id);
      if (ids.length > 0) {
        albumTracks.push(ids);
        metaByAlbum.push(metadata);
      } else {
        logger.debug(`playback: play_albums_search skipping empty album ${album.id}`);
      }
    }

    if (albumTracks.length === 0) {
      throw new Error('Found albums but none had any tracks');
    }

    let flat: string[];
    switch (shuffle) {
      case 'albums':
        flat = fisherYatesShuffle(albumTracks).flat();
        break;
      case 'songs':
        flat = fisherYatesShuffle(albumTracks.flat());
        break;
      default:
        flat = albumTracks.flat();
        break;
    }

    if (shuffle !== 'none') {
      logger.debug(`playback: play_albums_search shuffled (${shuffle}) → ${flat.length} tracks`);
    }

    const metadata = metaByAlbum.flat();
    const { demoted } = await playbackEngine.enqueue(flat, mode, metadata);

    const out: PlayAlbumsSearchResult = {
      success: true,
      matchCount: result.albums.length,
      albumCount: albumTracks.length,
      trackCount: flat.length,
    };
    if (result.appliedFilters !== undefined) {
      out.appliedFilters = result.appliedFilters;
    }
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_albums_search', error));
  }
}

/**
 * Run a song search and pipe the results into the live play queue.
 *
 * Songs are 1:1 with queue items so no per-album track resolution step is
 * needed. `shuffle: true` Fisher-Yates the new batch only — existing queue
 * items in `mode: 'append'` keep their order.
 */
export async function playSongsSearch(
  client: NavidromeClient,
  config: Config,
  args: unknown
): Promise<PlaySongsSearchResult> {
  let parsed: z.infer<typeof PlaySongsSearchSchema>;
  try {
    parsed = PlaySongsSearchSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_songs_search', error));
  }

  try {
    const { mode, shuffle, ...searchArgs } = parsed;
    logger.debug(`playback: play_songs_search mode=${mode} shuffle=${shuffle}`);

    const result = await searchSongs(client, config, searchArgs);
    if (result.songs.length === 0) {
      throw new Error('No songs matched the search filters');
    }

    let songIds = result.songs.map((s) => s.id);
    if (shuffle) {
      songIds = fisherYatesShuffle(songIds);
      logger.debug(`playback: play_songs_search shuffled ${songIds.length} songs`);
    }

    // The search result already contains every field we need for the engine
    // cache — no second fetch required. `durationFormatted` ("M:SS") is
    // reverse-parsed since the engine stores duration in raw seconds for
    // parity with mpv's own `duration` property.
    const metadata: QueueTrackMetadata[] = result.songs.map((s) => {
      const entry: QueueTrackMetadata = { songId: s.id };
      if (s.title !== '') entry.title = s.title;
      if (s.artist !== '') entry.artist = s.artist;
      if (s.album !== '') entry.album = s.album;
      const seconds = parseDuration(s.durationFormatted);
      if (seconds > 0) entry.duration = seconds;
      return entry;
    });

    const { demoted } = await playbackEngine.enqueue(songIds, mode, metadata);

    const out: PlaySongsSearchResult = {
      success: true,
      count: songIds.length,
    };
    if (result.appliedFilters !== undefined) {
      out.appliedFilters = result.appliedFilters;
    }
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_songs_search', error));
  }
}

/**
 * Load every track of a Navidrome playlist into the live mpv queue in a
 * single call — the playlist counterpart to `play_albums` / `play_songs`.
 * Avoids the two-step `get_playlist_tracks` → `play_songs` pattern, which
 * round-trips every `mediaFileId` through the LLM and wastes context tokens
 * for large playlists.
 *
 * Tracks are loaded in the playlist's saved order; `shuffle: true` applies
 * Fisher-Yates to the flat ID list before enqueue. `mode: 'append'` adds to
 * the existing queue without clearing or unpausing (same semantics as the
 * sibling tools). Empty playlists raise `'Playlist has no tracks'`.
 */
export async function playPlaylist(client: NavidromeClient, args: unknown): Promise<PlayPlaylistResult> {
  let parsed: z.infer<typeof PlayPlaylistSchema>;
  try {
    parsed = PlayPlaylistSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_playlist', error));
  }

  try {
    logger.debug(`playback: play_playlist id=${parsed.playlistId} mode=${parsed.mode} shuffle=${parsed.shuffle}`);

    const { ids, metadata } = await fetchPlaylistTrackIds(client, parsed.playlistId);
    if (ids.length === 0) {
      throw new Error('Playlist has no tracks');
    }

    const ordered = parsed.shuffle ? fisherYatesShuffle(ids) : ids;
    if (parsed.shuffle) {
      logger.debug(`playback: play_playlist shuffled ${ordered.length} tracks`);
    }

    // Metadata is indexed by songId in the engine cache, not by queue
    // position (see playback-engine.ts:metadataCache), so the unshuffled
    // metadata array stays valid even when `ordered` is permuted.
    const { demoted } = await playbackEngine.enqueue(ordered, parsed.mode, metadata);

    const out: PlayPlaylistResult = {
      success: true,
      count: ordered.length,
    };
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_playlist', error));
  }
}

/**
 * Fetch the ordered track ID list for a single album from Navidrome.
 *
 * Uses `album_id` (snake_case) for the filter — Navidrome's REST API
 * convention. Sorts by `album` ascending which produces natural disc/track
 * order (handles multi-disc releases correctly; the default sort is
 * unstable).
 *
 * Pagination: reads `X-Total-Count` from the first page and follows up with
 * additional MAX_ALBUM_TRACKS-sized pages until the full track list is
 * fetched. Boxsets / "complete works" releases easily exceed the per-page
 * limit; the previous single-page fetch silently truncated them, so a
 * `play_albums` invocation against a 1500-track Bach collection played
 * only the first 500 tracks.
 *
 * Safety cap: bails out after MAX_ALBUM_PAGES pages (= MAX_ALBUM_TRACKS *
 * MAX_ALBUM_PAGES tracks total) to bound the worst case if Navidrome ever
 * returns an inconsistent X-Total-Count.
 *
 * Returns `[]` for albums with no tracks; callers decide whether that is
 * a hard error or a skip case.
 */
async function fetchAlbumTrackIds(
  client: NavidromeClient,
  albumId: string,
): Promise<{ ids: string[]; metadata: QueueTrackMetadata[] }> {
  const ids: string[] = [];
  const metadata: QueueTrackMetadata[] = [];
  let totalReported: number | null = null;
  for (let page = 0; page < MAX_ALBUM_PAGES; page++) {
    const start = page * MAX_ALBUM_TRACKS;
    const params = new URLSearchParams({
      album_id: albumId,
      _start: String(start),
      _end: String(start + MAX_ALBUM_TRACKS),
      _sort: 'album',
      _order: 'ASC',
    });
    const endpoint = `/song?${params.toString()}`;
    const { data, total } = await client.requestWithMeta<unknown>(endpoint);
    if (page === 0) totalReported = total;

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response shape from ${endpoint}: expected array`);
    }
    for (const track of data) {
      if (typeof track === 'object' && track !== null) {
        const record = track as Record<string, unknown>;
        const id = record['id'];
        if (typeof id === 'string' && id !== '') {
          ids.push(id);
          // Collect what we need for the in-engine queue cache. The /song
          // endpoint returns these fields directly on each row, so no
          // transformer round-trip is needed.
          const entry: QueueTrackMetadata = { songId: id };
          if (typeof record['title'] === 'string') entry.title = record['title'];
          if (typeof record['artist'] === 'string') entry.artist = record['artist'];
          if (typeof record['album'] === 'string') entry.album = record['album'];
          if (typeof record['duration'] === 'number') entry.duration = record['duration'];
          metadata.push(entry);
        }
      }
    }
    // Unconditional break on empty page — protects against a server that
    // reports a stale/inflated X-Total-Count and returns empty pages forever.
    if (data.length === 0) break;
    // Stop early when we know we've covered the full result set. If
    // X-Total-Count is missing (server quirk), fall back to "stop when the
    // page came back smaller than requested" — same heuristic the rest of
    // the codebase uses for paginated reads.
    const collected = ids.length;
    if (total !== null) {
      if (collected >= total) break;
    } else if (data.length < MAX_ALBUM_TRACKS) {
      break;
    }
  }
  // If the server told us the album has more tracks than our hard cap, we've
  // silently truncated. Warn so it's diagnosable in DEBUG logs at least —
  // realistic albums don't hit 10k tracks but boxsets/complete-works might.
  if (totalReported !== null && totalReported > MAX_ALBUM_PAGES * MAX_ALBUM_TRACKS) {
    logger.warn(
      `Album ${albumId} has ${totalReported} tracks but only the first ${ids.length} were loaded (MAX_ALBUM_PAGES=${MAX_ALBUM_PAGES} cap).`
    );
  }
  return { ids, metadata };
}

/**
 * Fetch every track ID + queue metadata for a playlist. Paginated reads
 * of `/playlist/{id}/tracks` follow X-Total-Count just like
 * `fetchAlbumTrackIds` so playlists longer than one page load completely.
 * The MAX_ALBUM_* caps are reused as a generic per-page / max-pages bound
 * — Navidrome's pagination cap is the same for every paginated read,
 * regardless of which collection is being walked.
 *
 * Returns `[]` for empty playlists; callers decide whether to treat that
 * as a hard error.
 */
async function fetchPlaylistTrackIds(
  client: NavidromeClient,
  playlistId: string,
): Promise<{ ids: string[]; metadata: QueueTrackMetadata[] }> {
  const ids: string[] = [];
  const metadata: QueueTrackMetadata[] = [];
  let totalReported: number | null = null;
  for (let page = 0; page < MAX_ALBUM_PAGES; page++) {
    const start = page * MAX_ALBUM_TRACKS;
    const params = new URLSearchParams({
      _start: String(start),
      _end: String(start + MAX_ALBUM_TRACKS),
    });
    const endpoint = `/playlist/${encodeURIComponent(playlistId)}/tracks?${params.toString()}`;
    const { data, total } = await client.requestWithMeta<unknown>(endpoint);
    if (page === 0) totalReported = total;

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response shape from ${endpoint}: expected array`);
    }
    for (const track of data) {
      if (typeof track !== 'object' || track === null) continue;
      const record = track as Record<string, unknown>;
      // Playlist rows carry the play-target as `mediaFileId`; the row's
      // own `id` is the playlist-position record, not the song. Fall back
      // to `id` (stringified if numeric) only if `mediaFileId` is missing,
      // matching the transformer in playlist-export.ts.
      const rawMediaFileId = record['mediaFileId'];
      const rawId = record['id'];
      let songId = '';
      if (typeof rawMediaFileId === 'string' && rawMediaFileId !== '') {
        songId = rawMediaFileId;
      } else if (typeof rawId === 'string' && rawId !== '') {
        songId = rawId;
      } else if (typeof rawId === 'number') {
        songId = String(rawId);
      }
      if (songId === '') continue;
      ids.push(songId);
      const entry: QueueTrackMetadata = { songId };
      if (typeof record['title'] === 'string') entry.title = record['title'];
      if (typeof record['artist'] === 'string') entry.artist = record['artist'];
      if (typeof record['album'] === 'string') entry.album = record['album'];
      if (typeof record['duration'] === 'number') entry.duration = record['duration'];
      metadata.push(entry);
    }
    if (data.length === 0) break;
    if (total !== null) {
      if (ids.length >= total) break;
    } else if (data.length < MAX_ALBUM_TRACKS) {
      break;
    }
  }
  if (totalReported !== null && totalReported > MAX_ALBUM_PAGES * MAX_ALBUM_TRACKS) {
    logger.warn(
      `Playlist ${playlistId} has ${totalReported} tracks but only the first ${ids.length} were loaded (MAX_ALBUM_PAGES=${MAX_ALBUM_PAGES} cap).`
    );
  }
  return { ids, metadata };
}

/**
 * Look up minimal queue metadata (title/artist/album/duration) for an
 * arbitrary list of song IDs. Used by `play_songs` where the LLM hands us
 * raw IDs without DTOs. Best-effort: a missing/failed fetch yields no
 * metadata for that ID, and the queue entry will fall back to whatever
 * mpv has loaded.
 *
 * Uses Navidrome's `/song?id=<csv>` shape (passing each id in the same
 * `id` query key — Navidrome's REST layer accepts repeated keys). Chunked
 * to keep URLs sane; each chunk is one round-trip.
 */
async function fetchSongMetadata(
  client: NavidromeClient,
  songIds: readonly string[],
): Promise<QueueTrackMetadata[]> {
  if (songIds.length === 0) return [];
  const CHUNK_SIZE = 100;
  const out: QueueTrackMetadata[] = [];
  for (let i = 0; i < songIds.length; i += CHUNK_SIZE) {
    const chunk = songIds.slice(i, i + CHUNK_SIZE);
    const params = new URLSearchParams();
    for (const id of chunk) params.append('id', id);
    // Page through this id-set explicitly — Navidrome paginates even when
    // an `id` filter is supplied, so a >MAX_ALBUM_TRACKS chunk would
    // silently truncate. CHUNK_SIZE <= MAX_ALBUM_TRACKS keeps us under
    // the implicit page cap.
    params.set('_start', '0');
    params.set('_end', String(chunk.length));
    const endpoint = `/song?${params.toString()}`;
    try {
      const data = await client.request<unknown>(endpoint);
      if (!Array.isArray(data)) continue;
      for (const track of data) {
        if (typeof track !== 'object' || track === null) continue;
        const record = track as Record<string, unknown>;
        const id = record['id'];
        if (typeof id !== 'string' || id === '') continue;
        const entry: QueueTrackMetadata = { songId: id };
        if (typeof record['title'] === 'string') entry.title = record['title'];
        if (typeof record['artist'] === 'string') entry.artist = record['artist'];
        if (typeof record['album'] === 'string') entry.album = record['album'];
        if (typeof record['duration'] === 'number') entry.duration = record['duration'];
        out.push(entry);
      }
    } catch (err) {
      // Best-effort enrichment — failure just means the queue entries fall
      // back to mpv's own metadata (current/recent tracks only).
      logger.debug(`fetchSongMetadata chunk failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/**
 * Skip to the next track in mpv's playlist.
 */
export async function next(_args: unknown): Promise<NextResult> {
  try {
    logger.debug('playback: next');
    await playbackEngine.next();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('next', error));
  }
}

/**
 * Skip to the previous track in mpv's playlist.
 */
export async function previous(_args: unknown): Promise<PreviousResult> {
  try {
    logger.debug('playback: previous');
    await playbackEngine.previous();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('previous', error));
  }
}

/**
 * Seek within the currently playing track.
 */
export async function seek(args: unknown): Promise<SeekResult> {
  let parsed: z.infer<typeof SeekSchema>;
  try {
    parsed = SeekSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }

  try {
    logger.debug(`playback: seek seconds=${parsed.seconds} mode=${parsed.mode}`);
    await playbackEngine.seek(parsed.seconds, parsed.mode);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }
}

/**
 * Read current playback state from the engine's observed-property cache.
 * Does NOT trigger a lazy spawn — read tools never start mpv. Will
 * transparently attach to an already-running mpv (e.g. one that survived
 * an MCP restart) so the report reflects the actual playback state.
 */
export async function nowPlaying(_args: unknown): Promise<NowPlayingResult> {
  try {
    await playbackEngine.ensureAttached();
    const status = playbackEngine.getStatus();
    if (!status.engineRunning) {
      return { engineRunning: false };
    }

    const result: NowPlayingResult = { engineRunning: true };

    const queueIndex = playbackEngine.getCachedProperty('playlist-pos');
    if (typeof queueIndex === 'number') result.queueIndex = queueIndex;

    const queueLength = playbackEngine.getCachedProperty('playlist-count');
    if (typeof queueLength === 'number') result.queueLength = queueLength;

    const paused = playbackEngine.getCachedProperty('pause');
    if (typeof paused === 'boolean') result.paused = paused;

    const position = playbackEngine.getCachedProperty('time-pos');
    if (typeof position === 'number') result.position = position;

    const duration = playbackEngine.getCachedProperty('duration');
    if (typeof duration === 'number') result.duration = duration;

    const title = playbackEngine.getCachedProperty('media-title');
    if (typeof title === 'string') result.title = title;

    const metadata = playbackEngine.getCachedProperty('metadata');
    if (typeof metadata === 'object' && metadata !== null) {
      const meta = metadata as Record<string, unknown>;
      const artist = pickFirstString(meta, ['artist', 'Artist', 'ARTIST', 'icy-name']);
      const album = pickFirstString(meta, ['album', 'Album', 'ALBUM']);
      if (artist !== null) result.artist = artist;
      if (album !== null) result.album = album;
    }

    // Surface radio context AND repair duration for VBR MP3s.
    //
    // Two reasons we may need to call `getPlaylist()` here:
    //
    //   (1) RADIO DETECTION fallback — when the engine's session-scoped
    //       `currentRadioStation` flag was lost (different MCP session
    //       attached to existing mpv), we still want to flag `isRadio: true`
    //       when the current queue entry has no Navidrome songId.
    //
    //   (2) DURATION REPAIR for VBR MP3s — mpv streams VBR MP3 over HTTP and
    //       reports `duration` based on bytes-seen-so-far until it scans the
    //       full file (~20-30s into playback, or after any absolute seek).
    //       During that window mpv's number is a fraction of the real value.
    //       Navidrome's per-song metadata has the pre-scanned, authoritative
    //       duration, which Batch 3 piped into the engine's `metadataCache`
    //       keyed by songId. `getPlaylist()` already merges that cache into
    //       each entry's `duration` field, so the current entry's duration
    //       is the authoritative number when the cache has it. Prefer it
    //       whenever it's meaningfully larger than mpv's number (>5s gap
    //       covers all early-VBR cases without overriding legitimate mpv
    //       updates for tracks where mpv has finished its scan).
    //
    // `now_playing` is polled often, so we keep IPC pressure low: skip the
    // `getPlaylist()` call when neither fix is needed — i.e. the engine
    // already knows it's radio (no duration to repair) AND we have nothing
    // to fall back to.
    const radioStation = playbackEngine.getCurrentRadioStation();
    if (radioStation !== null) {
      result.isRadio = true;
      result.radioStation = radioStation;
    }
    const needsRadioFallback = radioStation === null;
    const needsDurationRepair =
      radioStation === null &&
      (result.duration === undefined || result.duration < 600);
    if (
      typeof queueLength === 'number' &&
      queueLength > 0 &&
      (needsRadioFallback || needsDurationRepair)
    ) {
      try {
        const playlist = await playbackEngine.getPlaylist();
        const current = playlist.find(e => e.isCurrent);
        if (current !== undefined) {
          // Radio fallback (only when session-scoped flag wasn't set)
          if (needsRadioFallback && current.songId === null) {
            result.isRadio = true;
          }
          // VBR duration repair: prefer the cached (Navidrome-sourced)
          // duration when mpv's reported duration is missing or noticeably
          // smaller than the authoritative value.
          if (
            current.duration !== undefined &&
            current.duration > 0 &&
            (result.duration === undefined || current.duration > result.duration + 5)
          ) {
            result.duration = current.duration;
          }
        }
      } catch {
        // Best-effort; if getPlaylist fails, fall back to whatever we got
        // from mpv's cached properties.
      }
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('now_playing', error));
  }
}

/**
 * Read-only snapshot of the live mpv play queue. Does NOT spawn mpv if it
 * isn't already running — returns `{ items: [], length: 0 }` instead. When
 * mpv is alive, returns the full normalized playlist plus the index of the
 * currently-playing entry (omitted if no entry is marked current).
 */
export async function getPlayQueue(client: NavidromeClient, _args: unknown): Promise<GetPlayQueueResult> {
  try {
    logger.debug('playback: get_play_queue');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { items: [], length: 0 };
    }

    const entries = await playbackEngine.getPlaylist();

    // mpv only loads track metadata as it plays — and even for the
    // currently-playing track, the engine's internal shape only carries
    // `title` from mpv (not artist/album/duration). Future-queue entries
    // arrive here with no title at all. The engine's per-session metadata
    // cache covers tracks enqueued in the current MCP session, but it's lost
    // on MCP restart while mpv keeps playing. To survive restarts and give
    // the LLM a reliable view, fall back to a Navidrome lookup for every
    // entry that still has a songId but is missing structured fields. The
    // trigger key is `artist` (not `title`) so we also enrich the current
    // track — title alone is rarely enough context. Best-effort: a failed
    // lookup leaves the entry as-is (the LLM at least has songId).
    const missing = entries
      .filter((e) => e.songId !== null && e.artist === undefined)
      .map((e) => e.songId as string);
    if (missing.length > 0) {
      const fetched = await fetchSongMetadata(client, missing);
      // Push enrichment back into the engine cache too so the next call is a
      // cache hit without re-fetching. Engine API is the public ingress for
      // metadata updates.
      playbackEngine.ingestQueueMetadata(fetched);
      const byId = new Map(fetched.map((m) => [m.songId, m]));
      for (const entry of entries) {
        if (entry.songId === null) continue;
        const md = byId.get(entry.songId);
        if (md === undefined) continue;
        // mpv's title (when present) wins — it reflects what the player
        // is actually showing, including any ICY title updates. Fill in
        // the rest from Navidrome regardless of whether mpv had a title,
        // since mpv never populates artist/album/duration on our
        // PlaylistEntry shape.
        if (entry.title === undefined && md.title !== undefined && md.title !== '') {
          entry.title = md.title;
        }
        if (entry.artist === undefined && md.artist !== undefined && md.artist !== '') {
          entry.artist = md.artist;
        }
        if (entry.album === undefined && md.album !== undefined && md.album !== '') {
          entry.album = md.album;
        }
        if (entry.duration === undefined && md.duration !== undefined && md.duration > 0) {
          entry.duration = md.duration;
        }
      }
    }

    // Strip `filename` before exposing to the LLM. The engine retains it for
    // internal queries like `hasRadioStream`, but it carries Navidrome's
    // internal LAN host/port — sensitive topology that should not reach
    // the model's context window. Per CLAUDE.md, URL-bearing fields must be
    // sanitized; here we drop the field entirely since callers identify
    // tracks by `index` + `songId`.
    const items: PlayQueueItem[] = entries.map(stripInternalFields);
    const result: GetPlayQueueResult = {
      items,
      length: items.length,
    };
    const current = items.find((e) => e.isCurrent);
    if (current !== undefined) {
      result.currentIndex = current.index;
    }
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_play_queue', error));
  }
}

/**
 * Project an internal `PlaylistEntry` onto the LLM-facing `PlayQueueItem`
 * shape. Drops `filename` (internal plumbing / LAN topology disclosure) and
 * passes everything else through as-is.
 */
function stripInternalFields(entry: PlaylistEntry): PlayQueueItem {
  const item: PlayQueueItem = {
    index: entry.index,
    songId: entry.songId,
    isCurrent: entry.isCurrent,
    isPlaying: entry.isPlaying,
  };
  if (entry.title !== undefined) item.title = entry.title;
  if (entry.artist !== undefined) item.artist = entry.artist;
  if (entry.album !== undefined) item.album = entry.album;
  if (entry.duration !== undefined) item.duration = entry.duration;
  return item;
}

/**
 * Clear the live play queue and stop playback. Idempotent — mpv `stop`
 * tolerates an idle engine. Lazy-spawns mpv on first call (the spawn is
 * effectively a no-op since `stop` immediately follows).
 */
export async function clearPlayQueue(_args: unknown): Promise<ClearPlayQueueResult> {
  try {
    logger.debug('playback: clear_play_queue');
    await playbackEngine.clearPlaylist();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('clear_play_queue', error));
  }
}

/**
 * Randomize the order of items in the live play queue via mpv's native
 * `playlist-shuffle` (atomic). Does not change membership; only order.
 */
export async function shufflePlayQueue(_args: unknown): Promise<ShufflePlayQueueResult> {
  try {
    logger.debug('playback: shuffle_play_queue');
    await playbackEngine.shufflePlaylist();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('shuffle_play_queue', error));
  }
}

/**
 * Move a play-queue entry from one index to another. Short-circuits with
 * `{ noop: true }` when `from === to`. Out-of-range indices are NOT
 * pre-validated — mpv errors and the message surfaces via ErrorFormatter
 * (avoids a race with concurrent queue mutations).
 */
export async function moveInPlayQueue(args: unknown): Promise<MoveInPlayQueueResult> {
  let parsed: z.infer<typeof MoveInPlayQueueSchema>;
  try {
    parsed = MoveInPlayQueueSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('move_in_play_queue', error));
  }

  if (parsed.from === parsed.to) {
    logger.debug(`playback: move_in_play_queue noop (from===to===${parsed.from})`);
    return { success: true, noop: true };
  }

  try {
    logger.debug(`playback: move_in_play_queue from=${parsed.from} to=${parsed.to}`);
    await playbackEngine.movePlaylistEntry(parsed.from, parsed.to);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('move_in_play_queue', error));
  }
}

/**
 * Jump the play head to the play-queue entry at the given index.
 *
 * Companion to `next` / `previous` for non-adjacent navigation — equivalent
 * to clicking a row in a media-player queue. Queue contents are unchanged;
 * only the active track shifts. mpv unpauses implicitly so the action feels
 * responsive: a user expressing intent to "play this row" with a paused
 * engine would otherwise silently change tracks without resuming playback.
 *
 * Out-of-range indices surface as mpv errors via `ErrorFormatter` (no
 * pre-validation — avoids a TOCTOU race with concurrent queue mutations
 * that change the length).
 */
export async function playQueueIndex(args: unknown): Promise<PlayQueueIndexResult> {
  let parsed: z.infer<typeof PlayQueueIndexSchema>;
  try {
    parsed = PlayQueueIndexSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_queue_index', error));
  }

  try {
    logger.debug(`playback: play_queue_index index=${parsed.index}`);
    await playbackEngine.jumpToPlaylistEntry(parsed.index);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_queue_index', error));
  }
}

/**
 * Remove the play-queue entry at the given index. mpv auto-advances when
 * the removed entry is the currently-playing track — no tool-side logic
 * needed. Out-of-range indices surface as mpv errors via ErrorFormatter.
 */
export async function removeFromPlayQueue(args: unknown): Promise<RemoveFromPlayQueueResult> {
  let parsed: z.infer<typeof RemoveFromPlayQueueSchema>;
  try {
    parsed = RemoveFromPlayQueueSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('remove_from_play_queue', error));
  }

  try {
    logger.debug(`playback: remove_from_play_queue index=${parsed.index}`);
    await playbackEngine.removePlaylistEntry(parsed.index);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('remove_from_play_queue', error));
  }
}

// ---------- helpers ----------

/**
 * Return a new array shuffled with Fisher-Yates. Pure; does not mutate input.
 */
function fisherYatesShuffle<T>(input: readonly T[]): T[] {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * Read the first key from `obj` whose value is a non-empty string.
 * Used to tolerate metadata key-casing variation (mpv passes through
 * whatever ID3 frame names the source file used).
 */
function pickFirstString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}
