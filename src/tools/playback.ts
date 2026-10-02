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
  LibraryPlayRequestSchema,
  NonEmptyStringArraySchema,
  PlayQueueIndexSchema,
  PlaylistIdSchema,
  SearchAlbumsSchema,
  SearchSongsSchema,
  SeekSchema,
  SetVolumeSchema,
} from '../schemas/index.js';
import {
  playbackEngine,
  type PlaybackStatus,
  type PlaylistEntry,
  type QueueTrackMetadata,
} from '../services/playback/playback-engine.js';
import { fisherYatesShuffle, orderQueueSongs } from './queue-order.js';
import { searchAlbums, searchSongs } from './search/index.js';
import { parseDuration } from '../transformers/shared-transformers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import { MAX_ALBUM_PAGES, MAX_ALBUM_TRACKS } from '../constants/defaults.js';

interface PauseResult {
  success: boolean;
  // Present only on a successful pause. Omitted when there was nothing to
  // pause (no live mpv — e.g. the player was powered off), in which case
  // `success` is false and `message` explains why.
  paused?: true;
  message?: string;
}

interface ResumeResult {
  success: boolean;
  // Present only on a successful resume. Omitted when there was nothing to
  // resume (no live mpv — e.g. the player was powered off), in which case
  // `success` is false and `message` explains why.
  paused?: false;
  message?: string;
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

interface PlaySongSetResult {
  success: true;
  count: number;
  demoted?: true;
}

interface NextResult {
  success: boolean;
  message?: string;
}

interface PreviousResult {
  success: boolean;
  message?: string;
}

interface SeekResult {
  success: boolean;
  message?: string;
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

interface ShuffleQueueFromTopResult {
  success: boolean;
  // Present only when there was nothing to shuffle (no live mpv).
  message?: string;
}

interface MoveInPlayQueueResult {
  success: true;
  noop?: true;
}

interface RemoveFromPlayQueueResult {
  success: true;
}

interface PlayQueueIndexResult {
  success: boolean;
  message?: string;
}

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

const PlayPlaylistSchema = PlaylistIdSchema.extend({
  mode: QueueModeSchema,
  shuffle: z.boolean().default(false),
});

const MoveInPlayQueueSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
});

const RemoveFromPlayQueueSchema = z.object({
  index: z.number().int().min(0),
});

/**
 * Pause local audio playback. Attaches to a live mpv but never spawns one:
 * pausing a freshly-spawned, empty mpv is meaningless. If no mpv is running
 * (e.g. the web player was powered off), there is nothing to pause — report
 * that instead of resurrecting an empty player.
 */
export async function pause(_args: unknown): Promise<PauseResult> {
  try {
    logger.debug('playback: pause');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'Nothing to pause — no active playback.' };
    }
    await playbackEngine.pause();
    return { success: true, paused: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('pause', error));
  }
}

/**
 * Resume local audio playback. Attaches to a live mpv but never spawns one:
 * resuming against a freshly-spawned, empty mpv would just unpause silence.
 * If no mpv is running (e.g. the web player was powered off, taking mpv with
 * it), there is nothing to resume — report that instead of resurrecting an
 * empty player. Start playback with a `play_*` tool to get audio back.
 */
export async function resume(_args: unknown): Promise<ResumeResult> {
  try {
    logger.debug('playback: resume');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'Nothing to resume — no active playback. Start something with a play tool.' };
    }
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

    // Resolve metadata AND scope to the active libraries in one pass. The
    // `/song?id=<csv>&library_id=X` lookup drops IDs outside the active
    // libraries, so the rows it returns ARE the play-eligible set. We then
    // restrict the enqueue list to exactly those IDs (preserving the
    // requested/shuffled order) so playback and queue metadata stay
    // consistent — we never enqueue a song we couldn't resolve, avoiding a
    // "plays but missing metadata" (or out-of-library) state.
    const metadata = await fetchSongMetadata(client, ordered, { scopeToActiveLibraries: true });
    const playable = new Set(metadata.map((m) => m.songId));
    const enqueueIds = ordered.filter((id) => playable.has(id));

    if (enqueueIds.length === 0) {
      throw new Error('No playable songs in the active libraries for the requested IDs');
    }

    const { demoted } = await playbackEngine.enqueue(enqueueIds, parsed.mode, metadata);

    const out: PlaySongsResult = {
      success: true,
      count: enqueueIds.length,
    };
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_songs', error));
  }
}

/**
 * Play one or many albums through the local speakers. Reads the albums'
 * ordered track lists, applies the requested shuffle mode, then loads
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
    return { success: true, ...await enqueueAlbumsByIds(client, parsed.albumIds, parsed.mode, parsed.shuffle) };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_albums', error));
  }
}

/**
 * Load the tracks of an ordered album-ID list into the live mpv queue in a single enqueue.
 * Albums with no tracks add nothing, and a set with no tracks at all throws.
 * `demoted` is present only when the engine turned `append` into `replace`.
 */
async function enqueueAlbumsByIds(
  client: NavidromeClient,
  albumIds: readonly string[],
  mode: 'replace' | 'append',
  shuffle: 'none' | 'albums' | 'songs',
): Promise<{ albumCount: number; trackCount: number; demoted?: true }> {
  const rows = await fetchAlbumSetSongs(client, albumIds, 'Album set');
  if (rows.length === 0) {
    throw new Error('No tracks found across all albums');
  }

  const ordered = orderQueueSongs(rows, { shuffleSongs: shuffle === 'songs', shuffleAlbums: shuffle === 'albums' });
  const ids = ordered.map((row) => row.songId);
  const { demoted } = await playbackEngine.enqueue(ids, mode, ordered.map(toQueueMetadata));

  const out: { albumCount: number; trackCount: number; demoted?: true } = {
    albumCount: new Set(rows.map((row) => row.albumId)).size,
    trackCount: ids.length,
  };
  if (demoted) out.demoted = true;
  return out;
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

    const enqueued = await enqueueAlbumsByIds(client, result.albums.map((album) => album.id), mode, shuffle);
    const out: PlayAlbumsSearchResult = {
      success: true,
      matchCount: result.albums.length,
      ...enqueued,
    };
    if (result.appliedFilters !== undefined) {
      out.appliedFilters = result.appliedFilters;
    }
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

    const rows = await fetchPlaylistSongs(client, parsed.playlistId);
    if (rows.length === 0) {
      throw new Error('Playlist has no tracks');
    }
    const ids = rows.map((row) => row.songId);

    const ordered = parsed.shuffle ? fisherYatesShuffle(ids) : ids;
    if (parsed.shuffle) {
      logger.debug(`playback: play_playlist shuffled ${ordered.length} tracks`);
    }

    // Metadata is indexed by songId in the engine cache, not by queue
    // position (see playback-engine.ts:metadataCache), so the unshuffled
    // metadata array stays valid even when `ordered` is permuted.
    const { demoted } = await playbackEngine.enqueue(ordered, parsed.mode, rows.map(toQueueMetadata));

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

type LibraryPlayRequest = z.infer<typeof LibraryPlayRequestSchema>;

const EMPTY_LIBRARY_SOURCE_MESSAGES: Record<LibraryPlayRequest['type'], string> = {
  song: 'Song not found in the active libraries',
  album: 'Album has no songs',
  artist: 'Artist has no songs',
  playlist: 'Playlist has no tracks',
  'starred-songs': 'No starred songs',
  'starred-albums': 'No songs in starred albums',
};

// Thrown unwrapped so the web route can tell an empty source from a failure.
export class EmptyLibrarySourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyLibrarySourceError';
  }
}

/**
 * Web-remote only. Every browse source resolves to one row list so the
 * remote's two shuffle toggles order all sources the same way.
 */
export async function playLibrarySource(
  client: NavidromeClient,
  args: unknown,
): Promise<PlaySongSetResult> {
  let parsed: LibraryPlayRequest;
  try {
    parsed = LibraryPlayRequestSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_library_source', error));
  }

  try {
    const { type, mode, shuffleSongs, shuffleAlbums } = parsed;
    logger.debug(
      `playback: play_library_source type=${type} mode=${mode} shuffleSongs=${shuffleSongs} shuffleAlbums=${shuffleAlbums}`,
    );

    const rows = await fetchLibrarySourceRows(client, parsed);
    if (rows.length === 0) {
      throw new EmptyLibrarySourceError(EMPTY_LIBRARY_SOURCE_MESSAGES[type]);
    }

    const ordered = orderQueueSongs(rows, { shuffleSongs, shuffleAlbums });
    const ids = ordered.map((row) => row.songId);
    const { demoted } = await playbackEngine.enqueue(ids, mode, ordered.map(toQueueMetadata));

    const out: PlaySongSetResult = {
      success: true,
      count: ids.length,
    };
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    if (error instanceof EmptyLibrarySourceError) throw error;
    throw new Error(ErrorFormatter.toolExecution('play_library_source', error));
  }
}

// Album position lets the web play path group and sort albums after the read.
interface QueueSongRow extends QueueTrackMetadata {
  albumId?: string;
  discNumber?: number;
  trackNumber?: number;
}

// Bounds the URL length of each album-set song read, since every album id repeats the `album_id` key.
const ALBUM_ID_CHUNK_SIZE = 100;

function toQueueSongRow(songId: string, record: Record<string, unknown>): QueueSongRow {
  const row: QueueSongRow = { songId };
  if (typeof record['title'] === 'string') row.title = record['title'];
  if (typeof record['artist'] === 'string') row.artist = record['artist'];
  if (typeof record['album'] === 'string') row.album = record['album'];
  if (typeof record['duration'] === 'number') row.duration = record['duration'];
  if (typeof record['albumId'] === 'string' && record['albumId'] !== '') row.albumId = record['albumId'];
  if (typeof record['discNumber'] === 'number') row.discNumber = record['discNumber'];
  if (typeof record['trackNumber'] === 'number') row.trackNumber = record['trackNumber'];
  return row;
}

// The engine caches whole metadata objects, so album position stays out of its cache.
function toQueueMetadata(row: QueueSongRow): QueueTrackMetadata {
  const metadata: QueueTrackMetadata = { songId: row.songId };
  if (row.title !== undefined) metadata.title = row.title;
  if (row.artist !== undefined) metadata.artist = row.artist;
  if (row.album !== undefined) metadata.album = row.album;
  if (row.duration !== undefined) metadata.duration = row.duration;
  return metadata;
}

async function fetchLibrarySourceRows(
  client: NavidromeClient,
  request: LibraryPlayRequest,
): Promise<QueueSongRow[]> {
  switch (request.type) {
    case 'song':
      return fetchSongPages(client, { id: request.id }, `Song ${request.id}`);
    case 'album':
      return fetchAlbumSongs(client, request.id);
    case 'artist':
      // Songs, not albums: `/album?artist_id=` also returns albums holding none of this artist's tracks.
      // `artists_id` matches featured and album-artist credits. `artist_id` holds only the first artist.
      return fetchSongPages(client, { artists_id: request.id, _sort: 'album', _order: 'ASC' }, `Artist ${request.id}`);
    case 'playlist':
      return fetchPlaylistSongs(client, request.id);
    case 'starred-songs':
      return fetchStarredSongs(client);
    case 'starred-albums':
      return fetchStarredAlbumSongs(client);
  }
}

async function fetchStarredAlbumSongs(client: NavidromeClient): Promise<QueueSongRow[]> {
  return fetchAlbumSetSongs(client, await fetchStarredAlbumIds(client), 'Starred albums');
}

// Navidrome ORs repeated `album_id` keys, so one paged read per chunk replaces one read per album.
async function fetchAlbumSetSongs(
  client: NavidromeClient,
  albumIds: readonly string[],
  label: string,
): Promise<QueueSongRow[]> {
  const rows: QueueSongRow[] = [];
  for (let start = 0; start < albumIds.length; start += ALBUM_ID_CHUNK_SIZE) {
    const chunk = albumIds.slice(start, start + ALBUM_ID_CHUNK_SIZE);
    const page = await fetchSongPages(
      client,
      { album_id: chunk, _sort: 'album', _order: 'ASC' },
      `${label} ${start + 1}-${start + chunk.length}`,
    );
    rows.push(...page);
  }
  return sortRowsByAlbumOrder(rows, albumIds);
}

// The chunked read returns album-name order. A stable sort restores the input order and keeps each album's track order.
function sortRowsByAlbumOrder(rows: readonly QueueSongRow[], albumIds: readonly string[]): QueueSongRow[] {
  const albumRank = new Map(albumIds.map((albumId, index) => [albumId, index]));
  const rankOf = (row: QueueSongRow): number => {
    const rank = row.albumId === undefined ? undefined : albumRank.get(row.albumId);
    return rank ?? albumIds.length;
  };
  return rows.slice().sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * Shared paging loop for every Navidrome list read that feeds the queue. `extract` returns null to skip a row.
 * MAX_ALBUM_PAGES bounds the walk in case Navidrome reports an inflated X-Total-Count.
 */
async function fetchPages<T>(
  client: NavidromeClient,
  path: string,
  filter: Record<string, string | readonly string[]>,
  extract: (record: Record<string, unknown>) => T | null,
  label: string,
): Promise<T[]> {
  const items: T[] = [];
  const filterParams = new URLSearchParams();
  let rowsRead = 0;
  let totalReported: number | null = null;
  for (const [key, value] of Object.entries(filter)) {
    for (const item of typeof value === 'string' ? [value] : value) filterParams.append(key, item);
  }
  for (let page = 0; page < MAX_ALBUM_PAGES; page++) {
    const start = page * MAX_ALBUM_TRACKS;
    const params = new URLSearchParams(filterParams);
    params.set('_start', String(start));
    params.set('_end', String(start + MAX_ALBUM_TRACKS));
    const endpoint = `${path}?${params.toString()}`;
    const { data, total } = await client.requestWithLibraryFilterAndMeta<unknown>(endpoint);
    if (page === 0) totalReported = total;

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response shape from ${endpoint}: expected array`);
    }
    rowsRead += data.length;
    for (const entry of data) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = extract(entry as Record<string, unknown>);
      if (item !== null) items.push(item);
    }
    // A stale X-Total-Count can promise rows that never come, so an empty page always ends the walk.
    if (data.length === 0) break;
    // Without X-Total-Count, a short page is the only end-of-set signal.
    if (total !== null) {
      if (rowsRead >= total) break;
    } else if (data.length < MAX_ALBUM_TRACKS) {
      break;
    }
  }
  if (totalReported !== null && totalReported > MAX_ALBUM_PAGES * MAX_ALBUM_TRACKS) {
    logger.warn(
      `${label} has ${totalReported} rows but only the first ${items.length} were loaded (MAX_ALBUM_PAGES=${MAX_ALBUM_PAGES} cap).`
    );
  }
  return items;
}

function recordId(record: Record<string, unknown>): string | null {
  const id = record['id'];
  return typeof id === 'string' && id !== '' ? id : null;
}

function songRowFromRecord(record: Record<string, unknown>): QueueSongRow | null {
  const id = recordId(record);
  return id === null ? null : toQueueSongRow(id, record);
}

function fetchSongPages(
  client: NavidromeClient,
  filter: Record<string, string | readonly string[]>,
  label: string,
): Promise<QueueSongRow[]> {
  return fetchPages(client, '/song', filter, songRowFromRecord, label);
}

// `_sort=album` yields disc and track order. The default sort is unstable on multi-disc releases.
function fetchAlbumSongs(client: NavidromeClient, albumId: string): Promise<QueueSongRow[]> {
  return fetchSongPages(client, { album_id: albumId, _sort: 'album', _order: 'ASC' }, `Album ${albumId}`);
}

// The library filter also narrows X-Total-Count, so a deactivated library's tracks never enqueue.
function fetchPlaylistSongs(client: NavidromeClient, playlistId: string): Promise<QueueSongRow[]> {
  return fetchPages(
    client,
    `/playlist/${encodeURIComponent(playlistId)}/tracks`,
    {},
    (record) => playlistSongRow(playlistId, record),
    `Playlist ${playlistId}`,
  );
}

// A playlist row's own `id` is its playlist position, never a song, so only `mediaFileId` can be played.
function playlistSongRow(playlistId: string, record: Record<string, unknown>): QueueSongRow | null {
  const mediaFileId = record['mediaFileId'];
  if (typeof mediaFileId === 'string' && mediaFileId !== '') return toQueueSongRow(mediaFileId, record);
  logger.warn(`playback: playlist ${playlistId} row ${String(record['id'])} has no mediaFileId, skipping it`);
  return null;
}

// `playDate` ASC plays the least-recently-played first, so repeated plays cycle the whole collection.
function fetchStarredSongs(client: NavidromeClient): Promise<QueueSongRow[]> {
  return fetchSongPages(client, { starred: 'true', _sort: 'playDate', _order: 'ASC' }, 'Starred set');
}

// Same least-recently-played order as the starred songs. The songs are read later per album chunk.
function fetchStarredAlbumIds(client: NavidromeClient): Promise<string[]> {
  return fetchPages(
    client,
    '/album',
    { starred: 'true', _sort: 'playDate', _order: 'ASC' },
    recordId,
    'Starred album set',
  );
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
  options: { scopeToActiveLibraries?: boolean } = {},
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
      // When scoping is requested (the enqueue path), `/song?...&library_id=X`
      // drops songs outside the active libraries, so the returned rows ARE the
      // play-eligible set. Otherwise (queue enrichment for already-playing
      // tracks) we look up by id unfiltered so a track in a now-deactivated
      // library still gets its title/artist.
      const data = options.scopeToActiveLibraries === true
        ? await client.requestWithLibraryFilter<unknown>(endpoint)
        : await client.request<unknown>(endpoint);
      if (!Array.isArray(data)) continue;
      for (const track of data) {
        if (typeof track !== 'object' || track === null) continue;
        const record = track as Record<string, unknown>;
        const id = record['id'];
        if (typeof id !== 'string' || id === '') continue;
        out.push(toQueueMetadata(toQueueSongRow(id, record)));
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
 * Skip to the next track in mpv's playlist. Attach-only (never spawns): the
 * play queue lives inside mpv, so with no live mpv there is no queue to
 * navigate. Report an empty queue rather than spawning an empty player.
 */
export async function next(_args: unknown): Promise<NextResult> {
  try {
    logger.debug('playback: next');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty — nothing to skip to. Start something with a play tool.' };
    }
    await playbackEngine.next();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('next', error));
  }
}

/**
 * Skip to the previous track in mpv's playlist. Attach-only (never spawns) —
 * same rationale as {@link next}.
 */
export async function previous(_args: unknown): Promise<PreviousResult> {
  try {
    logger.debug('playback: previous');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty — nothing to skip to. Start something with a play tool.' };
    }
    await playbackEngine.previous();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('previous', error));
  }
}

/**
 * Seek within the currently playing track. Attach-only (never spawns): there is
 * nothing to seek within when no mpv is running, so report that rather than
 * spawning an empty player (matches next/previous/resume/pause).
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
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'Nothing to seek — no active playback.' };
    }
    await playbackEngine.seek(parsed.seconds, parsed.mode);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }
}

/**
 * True when a string is an http(s) URL. mpv's top-level `media-title` is the
 * raw stream URL during the brief track-load window (before it reads file
 * metadata), and our Subsonic stream URL carries the auth token (`t`) + salt
 * (`s`). Such a value must never reach the LLM transcript — it's useless as a
 * display title and a credential leak the project's sanitize-url policy
 * forbids — so we detect and suppress it. Non-URL strings (real titles, ICY
 * "Artist - Track" radio titles) pass through untouched.
 */
function looksLikeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// The authoritative duration for one loaded file, kept so later polls reapply it
// without IPC while mpv's VBR duration is still under-reported.
let durationRepair: { key: string; duration: number } | null = null;
// The key a getPlaylist() reconciliation confirmed is NOT radio. Without it,
// `needsRadioFallback` forces a getPlaylist() IPC on every poll of ordinary playback.
let notRadioConfirmedForKey: string | null = null;

/**
 * Read current playback state from the engine's observed-property cache.
 * Does NOT trigger a lazy spawn — read tools never start mpv. Will
 * transparently attach to an already-running mpv (e.g. one that survived
 * an MCP restart) so the report reflects the actual playback state.
 *
 * `client` is optional and used only as a last-resort enrichment path: after
 * an MCP restart the in-memory metadata cache is empty, so title/artist/album
 * for the current track are resolved by a single Navidrome lookup. When the
 * client is absent (e.g. the live-mpv integration helper), the in-session
 * engine cache still supplies them.
 */
export async function nowPlaying(_args: unknown, client?: NavidromeClient): Promise<NowPlayingResult> {
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

    // Never surface a URL-shaped media-title: during the track-load window mpv
    // reports the raw stream URL (with auth token + salt) here. Suppress it and
    // let the songId-based reconciliation below fill in the real title, the
    // same way get_play_queue stays correct.
    const title = playbackEngine.getCachedProperty('media-title');
    if (typeof title === 'string' && !looksLikeHttpUrl(title)) result.title = title;

    const metadata = playbackEngine.getCachedProperty('metadata');
    if (typeof metadata === 'object' && metadata !== null) {
      const meta = metadata as Record<string, unknown>;
      const artist = pickFirstString(meta, ['artist', 'Artist', 'ARTIST', 'icy-name']);
      const album = pickFirstString(meta, ['album', 'Album', 'ALBUM']);
      if (artist !== null && !looksLikeHttpUrl(artist)) result.artist = artist;
      if (album !== null && !looksLikeHttpUrl(album)) result.album = album;
    }

    // getPlaylist() runs for three triggers: radio fallback, VBR duration repair and metadata repair.
    // `now_playing` runs on every poll, so the per-key caches skip that IPC once a key is resolved.
    const radioStation = playbackEngine.getCurrentRadioStation();
    if (radioStation !== null) {
      result.isRadio = true;
      result.radioStation = radioStation;
    }
    // mpv's `path` is in the key because the generation is per process: another process
    // sharing this mpv, or removal of the playing entry, loads a new file at the same index.
    const loadedPath = playbackEngine.getCachedProperty('path');
    const repairKey =
      typeof queueIndex === 'number' && typeof loadedPath === 'string' && loadedPath !== ''
        ? `${String(playbackEngine.getQueueGeneration())}:idx:${String(queueIndex)}:${loadedPath}`
        : null;
    // Once a position is confirmed NOT radio (a real songId was seen there),
    // stop re-firing getPlaylist() for the radio fallback on every poll — this
    // term would otherwise be true for all ordinary playback and defeat the
    // duration/metadata caches below.
    const notRadioConfirmed =
      repairKey !== null && notRadioConfirmedForKey === repairKey;
    const needsRadioFallback = radioStation === null && !notRadioConfirmed;
    const cachedRepair = repairKey !== null && durationRepair?.key === repairKey ? durationRepair : null;
    const alreadyRepaired = cachedRepair !== null;
    if (cachedRepair !== null && (result.duration === undefined || cachedRepair.duration > result.duration + 5)) {
      result.duration = cachedRepair.duration;
    }
    const needsDurationRepair =
      radioStation === null &&
      !alreadyRepaired &&
      (result.duration === undefined || result.duration < 600);
    // Title/artist/album still missing for a non-radio track — either mpv hadn't
    // loaded file metadata yet, or we suppressed a URL-shaped media-title above.
    // Resolve them by songId from the current queue entry, the same correctness
    // path get_play_queue uses. Scoped to non-radio so radio (which has no
    // album, and gets its title via ICY) doesn't force a getPlaylist every poll.
    const needsMetadataRepair =
      radioStation === null &&
      (result.title === undefined || result.artist === undefined);
    if (
      typeof queueLength === 'number' &&
      queueLength > 0 &&
      (needsRadioFallback || needsDurationRepair || needsMetadataRepair)
    ) {
      try {
        const playlist = await playbackEngine.getPlaylist();
        const current = playlist.find(e => e.isCurrent);
        if (current !== undefined) {
          // Radio fallback (only when session-scoped flag wasn't set)
          if (needsRadioFallback && current.songId === null) {
            result.isRadio = true;
          }
          if (current.songId !== null && repairKey !== null) {
            notRadioConfirmedForKey = repairKey;
          }
          // Metadata reconciliation by songId. getPlaylist already merged the
          // engine's per-song cache and sanitized any URL, so current.title/
          // artist/album are the authoritative display strings when present.
          if (result.title === undefined && current.title !== undefined && !looksLikeHttpUrl(current.title)) {
            result.title = current.title;
          }
          if (result.artist === undefined && current.artist !== undefined) {
            result.artist = current.artist;
          }
          if (result.album === undefined && current.album !== undefined) {
            result.album = current.album;
          }
          // Post-MCP-restart the engine cache is empty, so current.* may be
          // blank. Fall back to a single Navidrome lookup for the current song
          // (mirrors get_play_queue), bounded to one track so polling stays
          // cheap. Gate on the ESSENTIAL fields only (title/artist) — a song
          // that genuinely has no album would otherwise re-fetch every poll
          // since album never resolves. Mirrors get_play_queue's `artist`
          // trigger. Only when a client was supplied and a real songId exists.
          if (
            client !== undefined &&
            current.songId !== null &&
            (result.title === undefined || result.artist === undefined)
          ) {
            const [md] = await fetchSongMetadata(client, [current.songId]);
            if (md !== undefined) {
              // Seed the cache so subsequent polls are hits, no re-fetch.
              playbackEngine.ingestQueueMetadata([md]);
              if (result.title === undefined && md.title !== undefined && md.title !== '') result.title = md.title;
              if (result.artist === undefined && md.artist !== undefined && md.artist !== '') result.artist = md.artist;
              if (result.album === undefined && md.album !== undefined && md.album !== '') result.album = md.album;
            }
          }
          // VBR duration repair: prefer the cached (Navidrome-sourced)
          // duration when mpv's reported duration is missing or noticeably
          // smaller than the authoritative value.
          if (current.duration !== undefined && current.duration > 0) {
            // The cache holds the authoritative (Navidrome-sourced) duration for
            // this entry. Prefer it whenever mpv's value is missing or noticeably
            // smaller (early-VBR window); otherwise mpv has already settled.
            if (result.duration === undefined || current.duration > result.duration + 5) {
              result.duration = current.duration;
            }
            // Later polls for this key reapply the stored value without IPC. A cold cache
            // (no duration) stores nothing, so the next poll retries.
            if (repairKey !== null) {
              durationRepair = { key: repairKey, duration: current.duration };
            }
          }
        }
      } catch {
        // Best-effort; if getPlaylist fails, fall back to whatever we got
        // from mpv's cached properties.
      }
    }

    // Defense-in-depth: under no circumstances let a credential-bearing,
    // URL-shaped value escape in a display field (CLAUDE.md sanitize-url rule).
    // Every assignment above is already guarded, but this is the final backstop.
    if (result.title !== undefined && looksLikeHttpUrl(result.title)) delete result.title;
    if (result.artist !== undefined && looksLikeHttpUrl(result.artist)) delete result.artist;
    if (result.album !== undefined && looksLikeHttpUrl(result.album)) delete result.album;

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
 * Shuffle the live queue and start it from the new top track (the web remote's
 * shuffle). Attaches but never spawns mpv, since a fresh mpv has no queue.
 */
export async function shuffleQueueFromTop(_args: unknown): Promise<ShuffleQueueFromTopResult> {
  try {
    logger.debug('playback: shuffle_queue_from_top');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'Nothing to shuffle, no active playback.' };
    }
    await playbackEngine.shuffleQueueFromTop();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('shuffle_queue_from_top', error));
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
    // Attach-only (never spawns): the queue lives in mpv, so with no live mpv
    // there is no entry to jump to. Report an empty queue rather than spawning
    // an empty player (matches next/previous).
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty — nothing to jump to. Start something with a play tool.' };
    }
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
