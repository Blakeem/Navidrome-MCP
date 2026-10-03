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

import type { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import {
  LibraryPlayRequestSchema,
  MoveInPlayQueueSchema,
  PlayAlbumsSchema,
  PlayAlbumsSearchSchema,
  PlayPlaylistSchema,
  PlayQueueIndexSchema,
  PlaySongsSchema,
  PlaySongsSearchSchema,
  SeekSchema,
  SetVolumeSchema,
} from '../schemas/index.js';
import {
  playbackEngine,
  type PlaybackStatus,
  type QueueEntry,
  type QueueTrackMetadata,
} from '../services/playback/playback-engine.js';
import { fisherYatesShuffle, orderQueueSongs } from './queue-order.js';
import {
  fetchAlbumSetSongs,
  fetchLibrarySourceRows,
  fetchPlaylistSongs,
  fetchSongMetadata,
  toQueueMetadata,
  type LibraryPlayRequest,
} from './queue-sources.js';
import { searchAlbums, searchSongs } from './search/index.js';
import { parseDuration } from '../transformers/shared-transformers.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

interface PauseResult {
  success: boolean;
  // Omitted when no live mpv exists. Then `success` is false and `message` says why.
  paused?: true;
  message?: string;
}

interface ResumeResult {
  success: boolean;
  // Omitted when no live mpv exists. Then `success` is false and `message` says why.
  paused?: false;
  message?: string;
}

interface SetVolumeResult {
  success: true;
  volume: number;
}

// Play results do not echo `mode`, since the engine turns 'append' into 'replace' when a radio stream is queued.
// The optional `demoted` field reports that change.
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
  // current queue entry is not a Navidrome song stream.
  // `radioStation` is populated only when this server process started the
  // station and mpv still holds it.
  isRadio?: boolean;
  radioStation?: { name: string };
}

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
  success: boolean;
  message?: string;
}

interface ShuffleQueueFromTopResult {
  success: boolean;
  // Present only when there was nothing to shuffle (no live mpv).
  message?: string;
}

interface MoveInPlayQueueResult {
  success: boolean;
  noop?: true;
  message?: string;
}

interface RemoveFromPlayQueueResult {
  success: boolean;
  message?: string;
}

interface PlayQueueIndexResult {
  success: boolean;
  message?: string;
}

/**
 * Pause local audio playback. Attaches to a live mpv but never spawns one,
 * since pausing a fresh, empty mpv is meaningless.
 */
export async function pause(_args: unknown): Promise<PauseResult> {
  try {
    logger.debug('playback: pause');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'Nothing to pause. No active playback.' };
    }
    await playbackEngine.pause();
    return { success: true, paused: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('pause', error));
  }
}

/**
 * Resume local audio playback. Attaches to a live mpv but never spawns one,
 * since resuming a fresh, empty mpv would unpause silence.
 */
export async function resume(_args: unknown): Promise<ResumeResult> {
  try {
    logger.debug('playback: resume');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'Nothing to resume. No active playback. Start something with a play tool.' };
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
 * Play one or many songs through the local speakers. The IDs resolve through
 * fetchSongMetadata scoped to the active libraries. Unresolved IDs are dropped,
 * the requested order is kept, and the call throws when none resolve.
 * `mode='append'` with `shuffle=true` shuffles only the new batch and leaves the
 * existing queue order untouched.
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

    // Enqueuing only resolved IDs keeps out-of-library songs out of the queue and gives every entry metadata.
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
 *   - `'albums'`: shuffle the album order, natural track order within each album
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
  mode: z.infer<typeof PlayAlbumsSchema>['mode'],
  shuffle: z.infer<typeof PlayAlbumsSchema>['shuffle'],
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
 * playback intents like "play 5 random starred albums". `play_albums` covers
 * the case where the AI has already listed the albums and wants those exact ones.
 */
export async function playAlbumsSearch(
  client: NavidromeClient,
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

    const result = await searchAlbums(client, searchArgs);
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
 * needed. `shuffle: true` shuffles the new batch only. Existing queue items
 * in `mode: 'append'` keep their order.
 */
export async function playSongsSearch(
  client: NavidromeClient,
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

    const result = await searchSongs(client, searchArgs);
    if (result.songs.length === 0) {
      throw new Error('No songs matched the search filters');
    }

    let songIds = result.songs.map((s) => s.id);
    if (shuffle) {
      songIds = fisherYatesShuffle(songIds);
      logger.debug(`playback: play_songs_search shuffled ${songIds.length} songs`);
    }

    // The engine stores raw seconds like mpv's `duration`, so the search row's "M:SS" is parsed back.
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
 * single call. Avoids the two-step `get_playlist_tracks` → `play_songs`
 * pattern, which round-trips every `songId` through the LLM.
 *
 * Tracks load in the playlist's saved order. `shuffle: true` shuffles the
 * flat ID list before enqueue. Empty playlists raise `'Playlist has no tracks'`.
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

/**
 * Skip to the next track in mpv's playlist. Attach-only (never spawns): the
 * play queue lives inside mpv, so with no live mpv there is no queue to
 * navigate.
 */
export async function next(_args: unknown): Promise<NextResult> {
  try {
    logger.debug('playback: next');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty. Nothing to skip to. Start something with a play tool.' };
    }
    await playbackEngine.next();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('next', error));
  }
}

/**
 * Skip to the previous track in mpv's playlist. Attach-only (never spawns),
 * for the same reason as {@link next}.
 */
export async function previous(_args: unknown): Promise<PreviousResult> {
  try {
    logger.debug('playback: previous');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty. Nothing to skip to. Start something with a play tool.' };
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
      return { success: false, message: 'Nothing to seek. No active playback.' };
    }
    await playbackEngine.seek(parsed.seconds, parsed.mode);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }
}

/**
 * mpv reports the raw Subsonic stream URL, auth token and salt included, as
 * `media-title` until it reads file metadata, so a URL-shaped value is suppressed.
 */
function looksLikeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// mpv under-reports a VBR file's duration early on, so a Navidrome duration this much longer wins.
const VBR_DURATION_TOLERANCE_SECONDS = 5;
// Polls retry the repair IPC only below this length, so a long track with a cold cache costs no IPC per poll.
const DURATION_REPAIR_MAX_SECONDS = 600;

function preferAuthoritativeDuration(mpvDuration: number | undefined, authoritative: number): number {
  if (mpvDuration === undefined || authoritative > mpvDuration + VBR_DURATION_TOLERANCE_SECONDS) {
    return authoritative;
  }
  return mpvDuration;
}

// The authoritative duration for one loaded file, kept so later polls reapply it
// without IPC while mpv's VBR duration is still under-reported.
let durationRepair: { key: string; duration: number } | null = null;
// The key a getQueue() reconciliation confirmed is NOT radio. Without it,
// `needsRadioFallback` forces a getQueue() IPC on every poll of ordinary playback.
let notRadioConfirmedForKey: string | null = null;

/**
 * Read current playback state from the engine's observed-property cache.
 * Read tools never start mpv. Attaching to an already-running mpv (e.g. one
 * that survived an MCP restart) keeps the report true to the actual playback.
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

    // getQueue() runs for three triggers: radio fallback, VBR duration repair and metadata repair.
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
    // A key confirmed not radio stops the radio fallback, which would otherwise fire getQueue() on every poll.
    const notRadioConfirmed =
      repairKey !== null && notRadioConfirmedForKey === repairKey;
    const needsRadioFallback = radioStation === null && !notRadioConfirmed;
    const cachedRepair = repairKey !== null && durationRepair?.key === repairKey ? durationRepair : null;
    const alreadyRepaired = cachedRepair !== null;
    if (cachedRepair !== null) {
      result.duration = preferAuthoritativeDuration(result.duration, cachedRepair.duration);
    }
    const needsDurationRepair =
      radioStation === null &&
      !alreadyRepaired &&
      (result.duration === undefined || result.duration < DURATION_REPAIR_MAX_SECONDS);
    // Radio is excluded because it has no album and takes its title from ICY, so it would fire getQueue() every poll.
    const needsMetadataRepair =
      radioStation === null &&
      (result.title === undefined || result.artist === undefined);
    if (
      typeof queueLength === 'number' &&
      queueLength > 0 &&
      (needsRadioFallback || needsDurationRepair || needsMetadataRepair)
    ) {
      try {
        const playlist = await playbackEngine.getQueue();
        const current = playlist.find(e => e.isCurrent);
        if (current !== undefined) {
          if (needsRadioFallback && current.songId === null) {
            result.isRadio = true;
          }
          if (current.songId !== null && repairKey !== null) {
            notRadioConfirmedForKey = repairKey;
          }
          if (result.title === undefined && current.title !== undefined && !looksLikeHttpUrl(current.title)) {
            result.title = current.title;
          }
          if (result.artist === undefined && current.artist !== undefined) {
            result.artist = current.artist;
          }
          if (result.album === undefined && current.album !== undefined) {
            result.album = current.album;
          }
          // After an MCP restart the engine cache is empty. Album is not a trigger,
          // since a song without one would re-fetch on every poll.
          if (
            client !== undefined &&
            current.songId !== null &&
            (result.title === undefined || result.artist === undefined)
          ) {
            const [md] = await fetchSongMetadata(client, [current.songId]);
            if (md !== undefined) {
              playbackEngine.ingestQueueMetadata([md]);
              if (result.title === undefined && md.title !== undefined && md.title !== '') result.title = md.title;
              if (result.artist === undefined && md.artist !== undefined && md.artist !== '') result.artist = md.artist;
              if (result.album === undefined && md.album !== undefined && md.album !== '') result.album = md.album;
            }
          }
          // The cached duration comes from Navidrome and outlasts mpv's early VBR estimate.
          if (current.duration !== undefined && current.duration > 0) {
            result.duration = preferAuthoritativeDuration(result.duration, current.duration);
            // Later polls for this key reapply the stored value without IPC. A cold cache
            // (no duration) stores nothing, so the next poll retries.
            if (repairKey !== null) {
              durationRepair = { key: repairKey, duration: current.duration };
            }
          }
        }
      } catch {
        // Best-effort. A failed getQueue leaves mpv's cached properties in place.
      }
    }

    // Backstop for every assignment above, since a URL-shaped value can carry stream credentials.
    if (result.title !== undefined && looksLikeHttpUrl(result.title)) delete result.title;
    if (result.artist !== undefined && looksLikeHttpUrl(result.artist)) delete result.artist;
    if (result.album !== undefined && looksLikeHttpUrl(result.album)) delete result.album;

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('now_playing', error));
  }
}

/**
 * Read-only snapshot of the live mpv play queue. Never spawns mpv, and returns
 * `{ items: [], length: 0 }` when none is running. `currentIndex` is omitted
 * when no entry is marked current.
 */
export async function getPlayQueue(client: NavidromeClient, _args: unknown): Promise<GetPlayQueueResult> {
  try {
    logger.debug('playback: get_play_queue');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { items: [], length: 0 };
    }

    const entries = await playbackEngine.getQueue();

    // The engine cache is lost on an MCP restart while mpv keeps playing, so Navidrome fills the gaps.
    // `artist` is the trigger because mpv supplies only the current track's title.
    const missing = entries
      .filter((e) => e.songId !== null && e.artist === undefined)
      .map((e) => e.songId as string);
    if (missing.length > 0) {
      const fetched = await fetchSongMetadata(client, missing);
      playbackEngine.ingestQueueMetadata(fetched);
      const byId = new Map(fetched.map((m) => [m.songId, m]));
      for (const entry of entries) {
        if (entry.songId === null) continue;
        const md = byId.get(entry.songId);
        if (md === undefined) continue;
        // mpv's title wins because it reflects ICY title updates.
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
 * Copy only the LLM-facing fields. A stream URL would disclose the LAN host and port the server
 * reaches Navidrome on, and a field later added to `QueueEntry` must not reach the model unreviewed.
 */
function stripInternalFields(entry: QueueEntry): PlayQueueItem {
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
 * Clear the live play queue and stop playback. Attach-only: with no live mpv
 * there is no queue to clear, so it reports success without starting mpv.
 */
export async function clearPlayQueue(_args: unknown): Promise<ClearPlayQueueResult> {
  try {
    logger.debug('playback: clear_play_queue');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: true };
    }
    await playbackEngine.clearQueue();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('clear_play_queue', error));
  }
}

/**
 * Randomize the order of items in the live play queue via mpv's native
 * `playlist-shuffle` (atomic). Changes order only, never membership.
 * Attach-only, since a fresh mpv has no queue to shuffle.
 */
export async function shufflePlayQueue(_args: unknown): Promise<ShufflePlayQueueResult> {
  try {
    logger.debug('playback: shuffle_play_queue');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty. Nothing to shuffle. Start something with a play tool.' };
    }
    await playbackEngine.shuffleQueue();
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
 * Move a play-queue entry so it ends at index `to`. Short-circuits with
 * `{ noop: true }` when `from === to`. A `to` past the last index is rejected,
 * and an out-of-range `from` surfaces mpv's error via ErrorFormatter.
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
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty. Nothing to move. Start something with a play tool.' };
    }
    // mpv moves a past-the-end target to the end without an error, so the bound is checked here.
    const queueLength = (await playbackEngine.getQueue()).length;
    if (parsed.to >= queueLength) {
      throw new Error(
        `to ${parsed.to} is past the last queue index. The queue holds ${queueLength} entries, so to must be below ${queueLength}. Call get_play_queue to read the queue.`,
      );
    }
    // mpv inserts the entry before the one at its target, so a forward move targets the slot after `to`.
    const mpvTarget = parsed.from < parsed.to ? parsed.to + 1 : parsed.to;
    await playbackEngine.moveQueueEntry(parsed.from, mpvTarget);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('move_in_play_queue', error));
  }
}

/**
 * Jump the play head to the play-queue entry at the given index, like
 * clicking a row in a media-player queue. Queue contents are unchanged.
 * mpv unpauses, since a jump means "play this row now".
 *
 * Out-of-range indices surface as mpv errors via `ErrorFormatter`. No
 * pre-validation avoids a race with concurrent queue mutations.
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
    // Attach-only like next/previous, since the queue lives in mpv.
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty. Nothing to jump to. Start something with a play tool.' };
    }
    await playbackEngine.jumpToQueueEntry(parsed.index);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_queue_index', error));
  }
}

/**
 * Remove the play-queue entry at the given index. mpv auto-advances when the
 * removed entry is the playing track. Out-of-range indices surface as mpv
 * errors via ErrorFormatter.
 */
export async function removeFromPlayQueue(args: unknown): Promise<RemoveFromPlayQueueResult> {
  let parsed: z.infer<typeof PlayQueueIndexSchema>;
  try {
    parsed = PlayQueueIndexSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('remove_from_play_queue', error));
  }

  try {
    logger.debug(`playback: remove_from_play_queue index=${parsed.index}`);
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { success: false, message: 'The play queue is empty. Nothing to remove. Start something with a play tool.' };
    }
    await playbackEngine.removeQueueEntry(parsed.index);
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
