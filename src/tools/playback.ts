/**
 * Navidrome MCP Server - Playback Tool Functions
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
  PlayQueuePaginationSchema,
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
import { fetchRadioStations } from './radio.js';
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
import { hasSubsonicAuthParams } from '../utils/sanitize-url.js';

interface PauseResult {
  success: boolean;
  // Omitted when no entry is current. Then `success` is false and `message` says why.
  paused?: true;
  message?: string;
}

interface ResumeResult {
  success: boolean;
  // Omitted when no entry is current. Then `success` is false and `message` says why.
  paused?: false;
  message?: string;
}

interface SetVolumeResult {
  success: true;
  volume: number;
}

// Play results do not echo `mode`, since the engine turns 'append' into 'replace' when the queue
// holds a radio stream. `demoted` reports that change.
interface PlaySongsResult {
  success: true;
  count: number;
  skipped?: number;
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
  stopped?: true;
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
  songId?: string;
  title?: string;
  artist?: string;
  album?: string;
  position?: number;
  duration?: number;
  paused?: boolean;
  queueIndex?: number;
  queueLength?: number;
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

interface PlayQueuePageResult extends GetPlayQueueResult {
  offset: number;
  limit: number;
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
  // Present only when no live mpv exists.
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

interface LiveQueueState {
  position: number;
  count: number;
}

/**
 * Transport tools attach but never spawn, since a fresh mpv has no queue to act on. mpv idles with
 * its IPC connected after a clear or a finished queue, so a live socket does not prove playback.
 */
async function readLiveQueueState(): Promise<LiveQueueState | null> {
  await playbackEngine.ensureAttached();
  if (!playbackEngine.isRunning()) return null;
  return playbackEngine.readQueueState();
}

/**
 * A finished queue still holds entries the agent can restart, so its message names them instead of
 * reporting an empty queue.
 */
function noCurrentEntryMessage(queue: LiveQueueState | null, emptyQueueMessage: string): string {
  if (queue === null || queue.count === 0) return emptyQueueMessage;
  return `Nothing is playing. The queue holds ${entryCount(queue.count)} and none is current. Call play_queue_index to start one.`;
}

function entryCount(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`;
}

export async function pause(_args: unknown): Promise<PauseResult> {
  try {
    logger.debug('playback: pause');
    const queue = await readLiveQueueState();
    if (queue === null || queue.position < 0) {
      return { success: false, message: noCurrentEntryMessage(queue, 'Nothing to pause. No active playback.') };
    }
    await playbackEngine.pause();
    return { success: true, paused: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('pause', error));
  }
}

export async function resume(_args: unknown): Promise<ResumeResult> {
  try {
    logger.debug('playback: resume');
    const queue = await readLiveQueueState();
    if (queue === null || queue.position < 0) {
      return {
        success: false,
        message: noCurrentEntryMessage(queue, 'Nothing to resume. No active playback. Start something with a play tool.'),
      };
    }
    await playbackEngine.resume();
    return { success: true, paused: false };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('resume', error));
  }
}

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
 * Attaches to an mpv that an exited MCP server left running, so the report reflects it after a
 * restart.
 */
export async function playbackStatus(_args: unknown): Promise<PlaybackStatus> {
  try {
    await playbackEngine.ensureAttached();
    return playbackEngine.getStatus();
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('playback_status', error));
  }
}

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

    // Enqueuing only resolved IDs keeps out-of-library songs out of the queue and gives every entry
    // metadata.
    const metadata = await fetchSongMetadata(client, ordered, { scopeToActiveLibraries: true });
    const playable = new Set(metadata.map((m) => m.songId));
    const enqueueIds = ordered.filter((id) => playable.has(id));
    const skipped = ordered.length - enqueueIds.length;

    if (enqueueIds.length === 0) {
      throw new Error('No playable songs in the active libraries for the requested IDs');
    }

    const { demoted } = await playbackEngine.enqueue(enqueueIds, parsed.mode, metadata);

    const out: PlaySongsResult = {
      success: true,
      count: enqueueIds.length,
    };
    if (skipped > 0) out.skipped = skipped;
    if (demoted) out.demoted = true;
    return out;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_songs', error));
  }
}

export async function playAlbums(client: NavidromeClient, args: unknown): Promise<PlayAlbumsResult> {
  let parsed: z.infer<typeof PlayAlbumsSchema>;
  try {
    parsed = PlayAlbumsSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_albums', error));
  }

  try {
    const { albumIds, mode, shuffleSongs, shuffleAlbums } = parsed;
    logger.debug(
      `playback: play_albums count=${albumIds.length} mode=${mode} shuffleSongs=${shuffleSongs} shuffleAlbums=${shuffleAlbums}`,
    );
    return { success: true, ...await enqueueAlbumsByIds(client, albumIds, mode, { shuffleSongs, shuffleAlbums }) };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_albums', error));
  }
}

async function enqueueAlbumsByIds(
  client: NavidromeClient,
  albumIds: readonly string[],
  mode: z.infer<typeof PlayAlbumsSchema>['mode'],
  shuffle: Pick<z.infer<typeof PlayAlbumsSchema>, 'shuffleSongs' | 'shuffleAlbums'>,
): Promise<{ albumCount: number; trackCount: number; demoted?: true }> {
  const rows = await fetchAlbumSetSongs(client, albumIds, 'Album set');
  if (rows.length === 0) {
    throw new Error('No tracks found in the active libraries for these album IDs. Check the IDs with search_albums, or the active libraries with get_user_details.');
  }

  const ordered = orderQueueSongs(rows, shuffle);
  const ids = ordered.map((row) => row.songId);
  const { demoted } = await playbackEngine.enqueue(ids, mode, ordered.map(toQueueMetadata));

  const out: { albumCount: number; trackCount: number; demoted?: true } = {
    albumCount: new Set(rows.map((row) => row.albumId)).size,
    trackCount: ids.length,
  };
  if (demoted) out.demoted = true;
  return out;
}

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
    const { mode, shuffleSongs, shuffleAlbums, ...searchArgs } = parsed;
    logger.debug(`playback: play_albums_search mode=${mode} shuffleSongs=${shuffleSongs} shuffleAlbums=${shuffleAlbums}`);

    const result = await searchAlbums(client, searchArgs);
    if (result.albums.length === 0) {
      throw new Error('No albums matched the search filters');
    }

    const enqueued = await enqueueAlbumsByIds(client, result.albums.map((album) => album.id), mode, { shuffleSongs, shuffleAlbums });
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

    // The engine stores raw seconds like mpv's `duration`, so the row's "M:SS" is parsed back.
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
      throw new Error(await describeUnplayablePlaylist(client, parsed.playlistId));
    }
    const ids = rows.map((row) => row.songId);

    const ordered = parsed.shuffle ? fisherYatesShuffle(ids) : ids;
    if (parsed.shuffle) {
      logger.debug(`playback: play_playlist shuffled ${ordered.length} tracks`);
    }

    // The engine caches metadata by songId, not by queue position, so the unshuffled rows still
    // describe the shuffled `ordered` list.
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

/** An empty playlist and one with every track in inactive libraries need different fixes. */
async function describeUnplayablePlaylist(client: NavidromeClient, playlistId: string): Promise<string> {
  const playlist = await client.request<{ songCount?: unknown }>(`/playlist/${encodeURIComponent(playlistId)}`);
  if (playlist.songCount === 0) {
    return 'Playlist is empty. Add tracks with add_tracks_to_playlist first.';
  }
  return 'Playlist has no tracks in the active libraries. Call get_user_details to see the active libraries, or set_active_libraries to change them.';
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
 * The web remote is the only caller. Every browse source resolves to one row list, so the remote's
 * two shuffle toggles order every source the same way.
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

export async function next(_args: unknown): Promise<NextResult> {
  try {
    logger.debug('playback: next');
    const queue = await readLiveQueueState();
    if (queue === null || queue.position < 0) {
      return {
        success: false,
        message: noCurrentEntryMessage(queue, 'The play queue is empty. Nothing to skip to. Start something with a play tool.'),
      };
    }
    const wasLastEntry = queue.position === queue.count - 1;
    await playbackEngine.next();
    if (wasLastEntry) {
      return {
        success: true,
        stopped: true,
        message: 'That was the last entry, so playback stopped. Call play_queue_index to start the queue again.',
      };
    }
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('next', error));
  }
}

export async function previous(_args: unknown): Promise<PreviousResult> {
  try {
    logger.debug('playback: previous');
    const queue = await readLiveQueueState();
    if (queue === null || queue.position < 0) {
      return {
        success: false,
        message: noCurrentEntryMessage(queue, 'The play queue is empty. Nothing to skip to. Start something with a play tool.'),
      };
    }
    await playbackEngine.previous();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('previous', error));
  }
}

export async function seek(args: unknown): Promise<SeekResult> {
  let parsed: z.infer<typeof SeekSchema>;
  try {
    parsed = SeekSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }

  try {
    logger.debug(`playback: seek seconds=${parsed.seconds} mode=${parsed.mode}`);
    const queue = await readLiveQueueState();
    if (queue === null || queue.position < 0) {
      return { success: false, message: noCurrentEntryMessage(queue, 'Nothing to seek. No active playback.') };
    }
    await playbackEngine.seek(parsed.seconds, parsed.mode);
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }
}

/**
 * mpv reports the stream URL, or its basename as the filename fallback, as media-title until it
 * reads a title tag. Both forms carry the Subsonic auth params.
 */
function carriesStreamUrl(value: string): boolean {
  if (hasSubsonicAuthParams(value)) return true;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// mpv under-reports a VBR file's duration early on, so a Navidrome duration this much longer wins.
const VBR_DURATION_TOLERANCE_SECONDS = 5;
// Polls retry the repair IPC only below this length, so a long track with a cold cache costs no
// IPC per poll.
const DURATION_REPAIR_MAX_SECONDS = 600;

function preferAuthoritativeDuration(mpvDuration: number | undefined, authoritative: number): number {
  if (mpvDuration === undefined || authoritative > mpvDuration + VBR_DURATION_TOLERANCE_SECONDS) {
    return authoritative;
  }
  return mpvDuration;
}

interface RepairCache {
  key: string;
  stationName?: string;
  notRadio?: true;
  duration?: number;
}

// It holds facts resolved for one loaded file, so later polls of that file skip the getQueue IPC
// and the Navidrome reads.
let repairCache: RepairCache | null = null;

export function resetNowPlayingCache(): void {
  repairCache = null;
}

// A new key replaces the entire entry, so facts about the previous file never carry over.
function recordRepairFacts(key: string, facts: Omit<RepairCache, 'key'>): void {
  const kept: RepairCache = repairCache?.key === key ? repairCache : { key };
  repairCache = { ...kept, ...facts };
}

const UNKNOWN_STATION_NAME = 'Unknown station';

/**
 * Reading the saved stations lets every process that shares mpv name the station. Saved stations
 * can share a URL, so the station that play_radio_station tagged wins.
 */
async function findSavedStationName(
  client: NavidromeClient | undefined,
  lookup: StationLookup,
): Promise<string | null | undefined> {
  if (client === undefined) return null;
  try {
    const stations = await fetchRadioStations(client);
    const matches = stations.filter((station) => lookup.urls.includes(station.streamUrl));
    const tagged = matches.find((station) => station.id === lookup.taggedStationId);
    return (tagged ?? matches[0])?.name ?? null;
  } catch (error) {
    logger.debug('now_playing: saved radio station lookup failed:', error);
    return undefined;
  }
}

interface StationLookup {
  urls: readonly unknown[];
  taggedStationId: string | null;
}

type RepairFields = Pick<NowPlayingResult, 'title' | 'artist' | 'album' | 'duration' | 'isRadio' | 'radioStation'>;

interface QueueRepair {
  fields: RepairFields;
  facts: Omit<RepairCache, 'key'>;
}

/**
 * Navidrome fills what the engine cache lacks after an MCP restart. Returns null once mpv has moved
 * off the polled index, so another entry's facts never reach the old key.
 */
async function reconcileWithQueue(
  client: NavidromeClient | undefined,
  polled: Readonly<NowPlayingResult>,
  needs: { radio: boolean; duration: boolean },
  loadedPath: string | null,
  stationLookup: StationLookup | null,
): Promise<QueueRepair | null> {
  const fields: RepairFields = {};
  const facts: Omit<RepairCache, 'key'> = {};
  let fetchedDuration: number | undefined;

  const playlist = await playbackEngine.getQueue();
  const current = playlist.find((e) => e.isCurrent);
  if (current === undefined) return null;
  if (polled.queueIndex !== undefined && current.index !== polled.queueIndex) return null;
  // The path cache can lag a queue replace at the same index. A song stream path on a radio entry
  // is the replaced song's, so it would name no station and key the wrong file.
  if (current.songId === null && loadedPath !== null && hasSubsonicAuthParams(loadedPath)) return null;

  if (current.songId !== null) facts.notRadio = true;
  if (current.songId === null && needs.radio) {
    fields.isRadio = true;
    // Mid-load mpv has no path yet, so the name waits for a later poll.
    if (stationLookup !== null) {
      const savedName = await findSavedStationName(client, stationLookup);
      fields.radioStation = { name: savedName ?? UNKNOWN_STATION_NAME };
      // A failed station read caches nothing, so the next poll retries it.
      if (savedName !== undefined) facts.stationName = savedName ?? UNKNOWN_STATION_NAME;
    }
  }

  if (polled.title === undefined && current.title !== undefined && !carriesStreamUrl(current.title)) {
    fields.title = current.title;
  }
  if (polled.artist === undefined && current.artist !== undefined) fields.artist = current.artist;
  if (polled.album === undefined && current.album !== undefined) fields.album = current.album;

  // Album is not a trigger, since a song without one would re-fetch on every poll.
  const titleMissing = (polled.title ?? fields.title) === undefined;
  const artistMissing = (polled.artist ?? fields.artist) === undefined;
  const durationMissing = needs.duration && current.duration === undefined;
  if (client !== undefined && current.songId !== null && (titleMissing || artistMissing || durationMissing)) {
    const [md] = await fetchSongMetadata(client, [current.songId]);
    if (md !== undefined) {
      playbackEngine.ingestQueueMetadata([md]);
      if (titleMissing && md.title !== undefined && md.title !== '') fields.title = md.title;
      if (artistMissing && md.artist !== undefined && md.artist !== '') fields.artist = md.artist;
      if ((polled.album ?? fields.album) === undefined && md.album !== undefined && md.album !== '') {
        fields.album = md.album;
      }
      fetchedDuration = md.duration;
    }
  }

  const authoritativeDuration = current.duration ?? fetchedDuration;
  if (authoritativeDuration !== undefined && authoritativeDuration > 0) {
    fields.duration = preferAuthoritativeDuration(polled.duration, authoritativeDuration);
    facts.duration = authoritativeDuration;
  }
  return { fields, facts };
}

/**
 * Without `client`, no Navidrome read fills a cold engine cache, and a radio stream reports
 * "Unknown station".
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

    // mpv keeps its pause flag while idle, which would report a paused track when none is loaded.
    const paused = playbackEngine.getCachedProperty('pause');
    if (typeof paused === 'boolean' && typeof queueIndex === 'number' && queueIndex >= 0) result.paused = paused;

    const position = playbackEngine.getCachedProperty('time-pos');
    if (typeof position === 'number') result.position = position;

    const duration = playbackEngine.getCachedProperty('duration');
    if (typeof duration === 'number') result.duration = duration;

    const title = playbackEngine.getCachedProperty('media-title');
    if (typeof title === 'string' && !carriesStreamUrl(title)) result.title = title;

    const metadata = playbackEngine.getCachedProperty('metadata');
    if (typeof metadata === 'object' && metadata !== null) {
      const meta = metadata as Record<string, unknown>;
      const artist = pickFirstString(meta, ['artist', 'Artist', 'ARTIST', 'icy-name']);
      const album = pickFirstString(meta, ['album', 'Album', 'ALBUM']);
      if (artist !== null && !carriesStreamUrl(artist)) result.artist = artist;
      if (album !== null && !carriesStreamUrl(album)) result.album = album;
    }

    // The key holds mpv's path, since a removed entry or another process can load a new file at one
    // index within one generation. It holds the station tag, since two stations can share a URL.
    const loadedPath = playbackEngine.getCachedProperty('path');
    const stationTag = playbackEngine.getRadioStationTag();
    const songId = typeof loadedPath === 'string' ? playbackEngine.songIdForPath(loadedPath) : null;
    if (songId !== null) result.songId = songId;
    const repairKey =
      typeof queueIndex === 'number' && typeof loadedPath === 'string' && loadedPath !== ''
        ? `${String(playbackEngine.getQueueGeneration())}:idx:${String(queueIndex)}:${loadedPath}:${stationTag ?? ''}`
        : null;
    const cached = repairKey !== null && repairCache?.key === repairKey ? repairCache : null;
    const knownStation = cached?.stationName;
    const cachedDuration = cached?.duration;
    if (knownStation !== undefined) {
      result.isRadio = true;
      result.radioStation = { name: knownStation };
    }
    if (cachedDuration !== undefined) {
      result.duration = preferAuthoritativeDuration(result.duration, cachedDuration);
    }
    const isKnownRadio = knownStation !== undefined;
    const needs = {
      radio: !isKnownRadio && cached?.notRadio === undefined,
      duration:
        !isKnownRadio &&
        cachedDuration === undefined &&
        (result.duration === undefined || result.duration < DURATION_REPAIR_MAX_SECONDS),
    };
    // Known radio is excluded, since a stream with no ICY title would fire getQueue() every poll.
    const needsMetadataRepair = !isKnownRadio && (result.title === undefined || result.artist === undefined);
    if (
      typeof queueLength === 'number' &&
      queueLength > 0 &&
      (needs.radio || needs.duration || needsMetadataRepair)
    ) {
      try {
        // A .pls or .m3u station plays an expanded URL, so mpv's playlist-path is tried too.
        const stationLookup = repairKey === null
          ? null
          : { urls: [loadedPath, playbackEngine.getCachedProperty('playlist-path')], taggedStationId: stationTag };
        const polledPath = typeof loadedPath === 'string' ? loadedPath : null;
        const repair = await reconcileWithQueue(client, result, needs, polledPath, stationLookup);
        if (repair !== null) {
          Object.assign(result, repair.fields);
          if (repairKey !== null) recordRepairFacts(repairKey, repair.facts);
        }
      } catch {
        // A failed getQueue leaves mpv's cached properties in place.
      }
    }

    // A live stream's mpv duration is its buffered length, which grows while it plays. A loaded
    // path that names no song is radio too, which covers a first poll whose queue read failed.
    const pathNamesNoSong = typeof loadedPath === 'string' && loadedPath !== '' && songId === null;
    if (result.isRadio === true || pathNamesNoSong) delete result.duration;

    // Any field assigned above can hold a stream URL, so each one is checked again here.
    if (result.title !== undefined && carriesStreamUrl(result.title)) delete result.title;
    if (result.artist !== undefined && carriesStreamUrl(result.artist)) delete result.artist;
    if (result.album !== undefined && carriesStreamUrl(result.album)) delete result.album;

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('now_playing', error));
  }
}

export async function getPlayQueue(client: NavidromeClient, _args: unknown): Promise<GetPlayQueueResult> {
  try {
    logger.debug('playback: get_play_queue');
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) {
      return { items: [], length: 0 };
    }

    const entries = await playbackEngine.getQueue();

    // An MCP restart loses the engine cache while mpv keeps playing, so Navidrome fills the gaps.
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
 * The agent reads one page, since play tools build queues of thousands of tracks. The web remote
 * reads the entire queue through getPlayQueue.
 */
export async function getPlayQueuePage(client: NavidromeClient, args: unknown): Promise<PlayQueuePageResult> {
  let parsed: z.infer<typeof PlayQueuePaginationSchema>;
  try {
    parsed = PlayQueuePaginationSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_play_queue', error));
  }

  const full = await getPlayQueue(client, {});
  const page: PlayQueuePageResult = {
    items: full.items.slice(parsed.offset, parsed.offset + parsed.limit),
    length: full.length,
    offset: parsed.offset,
    limit: parsed.limit,
  };
  if (full.currentIndex !== undefined) {
    page.currentIndex = full.currentIndex;
  }
  return page;
}

/**
 * A stream URL would disclose the LAN host and port the server reaches Navidrome on. A field later
 * added to `QueueEntry` must not reach the model unreviewed, so only LLM-facing fields are copied.
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

/** Succeeds with no live mpv, since there is no queue to clear. */
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

export async function shufflePlayQueue(_args: unknown): Promise<ShufflePlayQueueResult> {
  try {
    logger.debug('playback: shuffle_play_queue');
    const queue = await readLiveQueueState();
    if (queue === null || queue.count === 0) {
      return { success: false, message: 'The play queue is empty. Nothing to shuffle. Start something with a play tool.' };
    }
    await playbackEngine.shuffleQueue();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('shuffle_play_queue', error));
  }
}

/** The web remote's shuffle. It never spawns mpv, since a fresh mpv has no queue to shuffle. */
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
    const queue = await readLiveQueueState();
    if (queue === null || queue.count === 0) {
      return { success: false, message: 'The play queue is empty. Nothing to move. Start something with a play tool.' };
    }
    // mpv moves a past-the-end target to the end without an error, so the bound is checked here.
    if (parsed.to >= queue.count) {
      throw new Error(
        `to ${parsed.to} is past the last queue index. The queue holds ${entryCount(queue.count)}, so to must be below ${queue.count}. Call get_play_queue to read the queue.`,
      );
    }
    // mpv inserts the entry before the one at its target, so a forward move targets `to + 1`.
    const mpvTarget = parsed.from < parsed.to ? parsed.to + 1 : parsed.to;
    try {
      await playbackEngine.moveQueueEntry(parsed.from, mpvTarget);
    } catch (error) {
      throw queueIndexError(error, `from ${parsed.from}`);
    }
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('move_in_play_queue', error));
  }
}

export async function playQueueIndex(args: unknown): Promise<PlayQueueIndexResult> {
  let parsed: z.infer<typeof PlayQueueIndexSchema>;
  try {
    parsed = PlayQueueIndexSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_queue_index', error));
  }

  try {
    logger.debug(`playback: play_queue_index index=${parsed.index}`);
    // A finished queue still holds rows, so jumping to one is a valid restart.
    const queue = await readLiveQueueState();
    if (queue === null || queue.count === 0) {
      return { success: false, message: 'The play queue is empty. Nothing to jump to. Start something with a play tool.' };
    }
    // mpv accepts an index past the end and stops playback, so the bound is checked here.
    if (parsed.index >= queue.count) {
      throw new Error(
        `index ${parsed.index} is not in the play queue. The queue holds ${entryCount(queue.count)}. Call get_play_queue for the current indices.`,
      );
    }
    try {
      await playbackEngine.jumpToQueueEntry(parsed.index);
    } catch (error) {
      throw queueIndexError(error, `index ${parsed.index}`);
    }
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_queue_index', error));
  }
}

export async function removeFromPlayQueue(args: unknown): Promise<RemoveFromPlayQueueResult> {
  let parsed: z.infer<typeof PlayQueueIndexSchema>;
  try {
    parsed = PlayQueueIndexSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('remove_from_play_queue', error));
  }

  try {
    logger.debug(`playback: remove_from_play_queue index=${parsed.index}`);
    const queue = await readLiveQueueState();
    if (queue === null || queue.count === 0) {
      return { success: false, message: 'The play queue is empty. Nothing to remove. Start something with a play tool.' };
    }
    try {
      await playbackEngine.removeQueueEntry(parsed.index);
    } catch (error) {
      throw queueIndexError(error, `index ${parsed.index}`);
    }
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('remove_from_play_queue', error));
  }
}

/** mpv's error for an unknown queue index names neither the index nor a recovery. */
function queueIndexError(error: unknown, label: string): unknown {
  if (error instanceof Error && error.message.startsWith('mpv command error')) {
    return new Error(`${label} is not in the play queue. Call get_play_queue for the current indices.`);
  }
  return error;
}

/** mpv keeps each tag format's key casing, such as ARTIST from Vorbis comments. */
function pickFirstString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}
