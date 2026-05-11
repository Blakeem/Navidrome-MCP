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
} from '../services/playback/playback-engine.js';
import { searchAlbums, searchSongs } from './search/index.js';
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

interface GetPlayQueueResult {
  items: PlaylistEntry[];
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
export async function playSongs(_client: NavidromeClient, args: unknown): Promise<PlaySongsResult> {
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

    const { demoted } = await playbackEngine.enqueue(ordered, parsed.mode);

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

    // Resolve each album to its track IDs. Skip albums that come back empty;
    // surface a clear error only if every album is empty.
    const albumTracks: string[][] = [];
    for (const albumId of parsed.albumIds) {
      const ids = await fetchAlbumTrackIds(client, albumId);
      if (ids.length > 0) {
        albumTracks.push(ids);
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

    const { demoted } = await playbackEngine.enqueue(flat, parsed.mode);

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

    // Resolve each album's track list. Skip albums that come back empty;
    // surface a clear error only if every album is empty.
    const albumTracks: string[][] = [];
    for (const album of result.albums) {
      const ids = await fetchAlbumTrackIds(client, album.id);
      if (ids.length > 0) {
        albumTracks.push(ids);
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

    const { demoted } = await playbackEngine.enqueue(flat, mode);

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

    const { demoted } = await playbackEngine.enqueue(songIds, mode);

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
async function fetchAlbumTrackIds(client: NavidromeClient, albumId: string): Promise<string[]> {
  const ids: string[] = [];
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
        const id = (track as Record<string, unknown>)['id'];
        if (typeof id === 'string' && id !== '') {
          ids.push(id);
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
  return ids;
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

    // Surface radio context. Two signals: the engine's session-scoped
    // station-name memory (set by `enqueueRadio`) and a runtime check of
    // the current queue entry — `songId === null` means a non-Navidrome
    // URL (almost always a radio stream).
    const radioStation = playbackEngine.getCurrentRadioStation();
    if (radioStation !== null) {
      result.isRadio = true;
      result.radioStation = radioStation;
    } else if (typeof queueLength === 'number' && queueLength > 0) {
      // Fallback: if we attached to a running mpv where the engine flag was
      // lost (different MCP session), still detect radio mode from the queue.
      // Skip the IPC roundtrip entirely when the cached playlist-count is 0
      // — there's nothing to inspect, and `now_playing` may be polled often.
      try {
        const playlist = await playbackEngine.getPlaylist();
        const current = playlist.find(e => e.isCurrent);
        if (current !== undefined && current.songId === null) {
          result.isRadio = true;
        }
      } catch {
        // Best-effort; if getPlaylist fails, skip the fallback detection
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
export async function getPlayQueue(_args: unknown): Promise<GetPlayQueueResult> {
  try {
    logger.debug('playback: get_play_queue');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { items: [], length: 0 };
    }

    const entries = await playbackEngine.getPlaylist();
    const result: GetPlayQueueResult = {
      items: entries,
      length: entries.length,
    };
    const current = entries.find((e) => e.isCurrent);
    if (current !== undefined) {
      result.currentIndex = current.index;
    }
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_play_queue', error));
  }
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
