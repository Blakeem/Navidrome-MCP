/**
 * Navidrome MCP Server - Playback Engine
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

import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import {
  MPV_ATTACH_CONNECT_DELAY_MS,
  MPV_ATTACH_CONNECT_RETRIES,
  MPV_QUIT_SOCKET_TIMEOUT_MS,
  MPV_STALE_SOCKET_PROBE_MS,
  MPV_VISUALIZER_SPAWN_WAIT_MS,
} from '../../constants/timeouts.js';
import { MAX_QUEUE_READ_PAGES, QUEUE_READ_PAGE_SIZE } from '../../constants/defaults.js';
import { buildSubsonicAuthParams } from '../../utils/subsonic-auth.js';
import { MpvIpc } from './mpv-ipc.js';
import { getDefaultIpcPath, spawnMpv } from './mpv-process.js';
import {
  decideVisualizerAction,
  hasVisualizerFilter,
  mpvBuildId,
  settledVisualizerValidation,
  validateVisualizerFilter,
  VISUALIZER_FILTER_LABEL,
  visualizerFilterSpec,
  type VisualizerValidation,
} from './visualizer-filter.js';

/**
 * Sized to the largest batch one enqueue can carry. Both caches grow past it for a
 * longer live queue, since evicting a live entry forces a refetch on every queue read.
 */
const FILENAME_CACHE_LIMIT = MAX_QUEUE_READ_PAGES * QUEUE_READ_PAGE_SIZE;

/** Path of the Subsonic stream endpoint that `buildStreamUrl` targets. */
const SUBSONIC_STREAM_PATH = '/rest/stream';

/**
 * Properties we observe on the engine and cache locally so consumers can
 * read state without round-tripping IPC. Each entry is `[observeId, name]`.
 */
const OBSERVED_PROPERTIES: ReadonlyArray<readonly [number, string]> = [
  [1, 'playlist-pos'],
  [2, 'playlist-count'],
  [3, 'pause'],
  [4, 'time-pos'],
  [5, 'duration'],
  [6, 'media-title'],
  [7, 'metadata'],
  [8, 'idle-active'],
  [9, 'volume'],
  [10, 'eof-reached'],
  [11, 'path'],
  [12, 'playlist-path'],
];

// Names the saved station a radio stream was played from, since saved stations can share a stream URL.
// Observed so every process sharing mpv sees a change, but optional because mpv before 0.36 has no user-data.
const RADIO_STATION_TAG_PROPERTY = 'user-data/navidrome-mcp/radio-station-id';
const OPTIONAL_OBSERVED_PROPERTIES: ReadonlyArray<readonly [number, string]> = [
  [13, RADIO_STATION_TAG_PROPERTY],
];

// On a transcoded stream mpv can briefly reject a valid seek while its cache
// settles. Retrying the same command clears it without touching mpv's clock.
const SEEK_MAX_ATTEMPTS = 4;
const SEEK_RETRY_DELAY_MS = 250;

/**
 * Snapshot of engine status, returned by tools.
 */
export interface PlaybackStatus {
  engineRunning: boolean;
  mpvPath: string | null;
  mpvVersion: string | null;
  volume: number | null;
  idle: boolean | null;
}

/**
 * One entry in the live mpv playlist, normalized for tool consumers.
 *
 * `songId` is the `id` query parameter of an http(s) URL whose path ends in
 * `/rest/stream`. Any other filename, such as a radio stream, yields `null`.
 *
 * `entryId` is mpv's per-entry id. It survives a move, so it tells a shifted
 * entry from a new one where the index cannot.
 *
 * `title` prefers mpv's playlist title and falls back to the metadata cache.
 * `artist`, `album` and `duration` come only from the metadata cache, which
 * `enqueue` and `ingestQueueMetadata` fill.
 */
export interface QueueEntry {
  index: number;
  songId: string | null;
  entryId?: number;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  isCurrent: boolean;
  isPlaying: boolean;
}

/**
 * Track metadata the tool layer passes at enqueue time. mpv loads metadata
 * only for tracks it touches, so without it future entries are bare IDs.
 */
export interface QueueTrackMetadata {
  songId: string;
  title?: string;
  artist?: string;
  album?: string;
  /** Duration in seconds, matching mpv's own `duration` units. */
  duration?: number;
}

/**
 * Engine state-change event delivered to subscribers of `onStateChange`.
 *
 * `kind === 'property'` is forwarded from mpv's own observe-property stream.
 * `name` is the mpv property (`pause`, `volume`, `time-pos`, `playlist-pos`,
 * `playlist-count`, `duration`, `media-title`, `metadata`, `idle-active`,
 * `eof-reached`, `path`, `playlist-path`) and `data` is the new value (unknown JSON shape).
 *
 * `kind === 'queue'` fires after a queue-mutating IPC sequence completes
 * (enqueue/clear/shuffle/move/remove/enqueueRadio), since mpv's property events
 * do not cover every change a mutation produces. It carries no payload, so
 * subscribers re-read state from the public getters.
 *
 * `kind === 'attach'` fires when the engine connects to an mpv instance, before
 * that instance's observe-emitted snapshot, so subscribers can drop state from a previous instance.
 *
 * `kind === 'message'` forwards mpv's `client-message`, which mpv delivers to every IPC client
 * (the sender included) in one order. Processes sharing mpv use it as a broadcast channel.
 *
 * `kind === 'visualizer'` fires when `isVisualizerUnsupported()` changes, which no mpv event announces.
 */
export type StateChangeEvent =
  | { kind: 'property'; name: string; data: unknown }
  | { kind: 'queue' }
  | { kind: 'attach' }
  | { kind: 'message'; args: string[] }
  | { kind: 'visualizer' };

type StateChangeHandler = (event: StateChangeEvent) => void;

interface VisualizerSyncRequest {
  // A track start is safe until its audio begins, which mpv announces with playback-restart.
  stillSafe?: () => boolean;
  // Set by the spawn path, whose caller holds a play request until the sync finishes.
  checkWaitMs?: number;
}

/**
 * Singleton playback engine wrapping mpv.
 *
 * Lifecycle:
 *   - The engine is constructed in `not-running` state at module load time.
 *   - `ensureRunning()` lazy-spawns mpv on first call, connects IPC, observes
 *     the standard property set, and fetches the mpv version.
 *   - Subsequent `ensureRunning()` calls are no-ops while the engine is alive.
 *   - The engine installs no signal handlers. The entry points own process
 *     shutdown and call quitMpv() to stop mpv.
 *
 * Concurrent `ensureRunning()` calls are coalesced via a stored start promise.
 */
class PlaybackEngine {
  private static instance: PlaybackEngine | null = null;

  private config: Config | null = null;
  private mpvBinary: string | null = null;
  private ipcPath: string = getDefaultIpcPath();
  // mpv runs detached so playback survives a restart. Once a spawn connects, the
  // engine keeps no child handle and the IPC connection is the only one.
  private ipc: MpvIpc | null = null;
  private startPromise: Promise<void> | null = null;
  // Coalesces concurrent attaches so they share one connection.
  private attachPromise: Promise<boolean> | null = null;
  private mpvVersion: string | null = null;
  // Set by quitMpv. It silences the child's exit handler and refuses any later spawn.
  private shuttingDown = false;
  private readonly propertyCache = new Map<string, unknown>();
  // Bumped by every load that can land a new track at position 0, so
  // per-position caches in consumers (e.g. now_playing's duration repair)
  // never match the previous track at the same index.
  private queueGeneration = 0;
  // Serializes this process's mutating queue operations, since interleaved IPC sequences can leave a hybrid
  // queue. It does not span processes, so loads from the MCP and the web remote at once can still interleave.
  private mutationLock: Promise<unknown> = Promise.resolve();
  // Set by every control path and never cleared. Reads and the startup adoption leave it unset,
  // so an MCP that only observed mpv does not quit another MCP's playback on exit.
  private controlledMpv = false;
  // The spawned child until its connect commits. It runs detached and has no socket to receive quit yet.
  private pendingSpawn: ChildProcess | null = null;
  // getQueue() is polled often with 100+ entries, and mpv filenames are
  // stable for the queue's lifetime, so parsed song IDs are cached.
  private readonly filenameCache = new Map<string, string | null>();
  // Lets getQueue() report titles for entries mpv has not loaded. Removed
  // entries are not evicted, since a stale entry costs only bytes.
  private readonly metadataCache = new Map<string, QueueTrackMetadata>();
  // Song IDs in the playlist the last getQueue() read, which metadata eviction never drops.
  private liveSongIds: ReadonlySet<string> = new Set();
  private readonly stateChangeHandlers: Array<StateChangeHandler> = [];
  // Each entry point says how it reads the visualizer setting. Off until one does, so a bare engine adds no filter.
  private visualizerWanted: () => boolean = () => false;
  // Only the web player's engine follows the setting after spawn, since an MCP process in env mode reads another value.
  private visualizerKeepsInSync = false;
  private visualizerPending = false;
  // Why the filter cannot run on the current mpv, or null when it can.
  private visualizerRefusal: string | null = null;
  // Lets a track-start sync that waited in the chain tell whether that track's audio has begun.
  private playbackRestarts = 0;
  // A pause and a track start can land together, and each reads the af list before it writes.
  private visualizerSyncChain: Promise<void> = Promise.resolve();

  private constructor() {}

  static getInstance(): PlaybackEngine {
    PlaybackEngine.instance ??= new PlaybackEngine();
    return PlaybackEngine.instance;
  }

  /**
   * Configure the engine with the loaded application config. Must be called
   * once at startup before any tool invocation. Later calls overwrite the
   * config reference.
   */
  configure(config: Config): void {
    this.config = config;
    this.mpvBinary = config.mpvPath ?? null;
  }

  /**
   * Every engine adds the filter to an mpv it spawns, so the first track plays through it. Only an engine with
   * `keepInSync` changes it later, so two processes that read the setting differently never undo each other.
   */
  setVisualizerSource(source: () => boolean, options: { keepInSync?: boolean } = {}): void {
    this.visualizerWanted = source;
    this.visualizerKeepsInSync = options.keepInSync === true;
  }

  /** Applies the visualizer setting now if mpv is idle or paused, otherwise at the next track start, pause or stop. */
  syncVisualizerFilter(): Promise<void> {
    const ipc = this.ipc;
    return ipc === null || !this.visualizerKeepsInSync ? Promise.resolve() : this.queueVisualizerSync(ipc, {});
  }

  isVisualizerUnsupported(): boolean {
    return this.visualizerRefusal !== null;
  }

  /** Whether the engine has a live IPC connection to mpv. */
  isRunning(): boolean {
    return this.ipc?.isConnected() === true;
  }

  /** A spawn still connecting counts, since its detached child outlives an exit that skips quitMpv. */
  hasControlledMpv(): boolean {
    return this.controlledMpv || this.pendingSpawn !== null;
  }

  /**
   * Try to attach to an already-running mpv via the well-known IPC socket,
   * but do NOT spawn a new one if attach fails. Used by read-only tools
   * (`now_playing`, `playback_status`) so they can recover after an MCP
   * restart without taking on the cost of spawning mpv themselves.
   *
   * Resolves silently in all cases. The caller checks `isRunning()` afterwards.
   */
  async ensureAttached(): Promise<void> {
    if (this.isRunning()) return;
    if (this.config === null) return;
    if (this.startPromise !== null) {
      await this.startPromise.catch(() => undefined);
      return;
    }
    this.ipcPath = getDefaultIpcPath();
    await this.attachExistingShared();
  }

  /**
   * Lazy-connect to mpv: first try to attach to an already-running mpv via
   * the well-known IPC socket (e.g. one spawned by a previous MCP server
   * that has since exited), then fall back to spawning a fresh mpv if
   * nothing's there. Returns once IPC is connected and baseline property
   * observation is in place. Concurrent callers share the same start promise.
   */
  async ensureRunning(): Promise<void> {
    if (!this.isRunning()) {
      this.startPromise ??= this.startOrAttach();
      try {
        await this.startPromise;
      } finally {
        // A settled promise left here would make the first call after an IPC drop a no-op.
        this.startPromise = null;
      }
    }
    this.controlledMpv = true;
  }

  /**
   * Pause playback. Lazy-spawns mpv if necessary.
   */
  async pause(): Promise<void> {
    await this.ensureRunning();
    await this.requireIpc().command('set_property', 'pause', true);
  }

  /**
   * Resume playback. Lazy-spawns mpv if necessary.
   */
  async resume(): Promise<void> {
    await this.ensureRunning();
    await this.requireIpc().command('set_property', 'pause', false);
  }

  /**
   * Set mpv's internal volume. Input is clamped to [0, 100].
   * Lazy-spawns mpv if necessary.
   *
   * @returns the clamped value that was applied
   */
  async setVolume(level: number): Promise<number> {
    const clamped = Math.max(0, Math.min(100, level));
    await this.ensureRunning();
    await this.requireIpc().command('set_property', 'volume', clamped);
    return clamped;
  }

  /**
   * Load the given ordered list of song stream URLs into mpv's playlist.
   *
   * - `mode='replace'`: clear the existing playlist, replace with the new
   *   tracks (first via `loadfile <url> replace`, remaining via `append`),
   *   and unpause so playback starts immediately.
   * - `mode='append'`: append each new track to the existing playlist via
   *   `loadfile <url> append`. Does NOT clear the queue and does NOT unpause,
   *   so existing playback state (including pause) is preserved. When no entry is
   *   current (an empty or finished queue), the first appended track becomes
   *   current, paused.
   *
   * Caller is responsible for ordering / shuffle of `songIds`. Lazy-spawns
   * mpv on first call.
   */
  async enqueue(
    songIds: readonly string[],
    mode: 'replace' | 'append',
    metadata?: ReadonlyArray<QueueTrackMetadata>,
  ): Promise<{ demoted: boolean }> {
    if (songIds.length === 0) {
      throw new Error('enqueue requires at least one song ID');
    }
    await this.ensureRunning();
    const result = await this.withMutationLock(async () => {
      const ipc = this.requireIpc();

      // An infinite radio stream breaks queue semantics, so an append onto radio
      // becomes a replace. `demoted` tells the LLM its requested mode was not honored.
      let effectiveMode = mode;
      let demoted = false;
      if (effectiveMode === 'append' && await this.hasRadioStream()) {
        logger.warn('enqueue: append demoted to replace because queue contains a radio stream');
        effectiveMode = 'replace';
        demoted = true;
      }

      if (effectiveMode === 'replace') {
        this.queueGeneration++;
        // Replace is not atomic on mpv's side. A mid-sequence failure stops and
        // clears, so the queue never shows a half-load that contradicts the error.
        const [first, ...rest] = songIds;
        if (first === undefined) {
          throw new Error('enqueue requires at least one song ID');
        }
        // The previous queue's titles must not bleed into the new queue's view.
        this.metadataCache.clear();
        this.ingestMetadata(metadata);
        // Clear up front so the prior queue is gone even if the first loadfile fails.
        await ipc.command('playlist-clear');
        try {
          await ipc.command('loadfile', this.buildStreamUrl(first), 'replace');
          for (const id of rest) {
            await ipc.command('loadfile', this.buildStreamUrl(id), 'append');
          }
          await ipc.command('set_property', 'pause', false);
        } catch (err) {
          // `stop` alone keeps the playlist, so clear first to make the error
          // message true. Both are best effort, since a dead connection re-attaches.
          try {
            await ipc.command('playlist-clear');
          } catch {
            // The connection is gone. The cache-zero below and the next attach handle it.
          }
          try {
            await ipc.command('stop');
          } catch {
            // The connection is gone. Further teardown is the IPC layer's job.
          }
          // A read before mpv's async change event must see the empty queue.
          this.propertyCache.set('playlist-count', 0);
          this.propertyCache.set('playlist-pos', null);
          // The rethrow skips the success-path emit, so broadcast the cleared queue here.
          this.emitStateChange({ kind: 'queue' });
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`enqueue failed mid-sequence; queue was cleared and is now empty: ${reason}`);
        }
      } else {
        // An append keeps the existing pause state, so a paused queue stays paused.
        this.ingestMetadata(metadata);
        // Read fresh because the observed cache can lag. mpv selects nothing for
        // tracks appended while no entry is current, which leaves a dead position.
        const posBeforeAppend = await ipc.command('get_property', 'playlist-pos');
        const countBeforeAppend = await ipc.command('get_property', 'playlist-count');
        for (const id of songIds) {
          await ipc.command('loadfile', this.buildStreamUrl(id), 'append');
        }
        const hadNoCurrentEntry = typeof posBeforeAppend === 'number' && posBeforeAppend < 0;
        if (hadNoCurrentEntry && typeof countBeforeAppend === 'number') {
          await ipc.command('set_property', 'pause', true);
          await ipc.command('set_property', 'playlist-pos', countBeforeAppend);
        }
      }

      return { demoted };
    });
    this.emitStateChange({ kind: 'queue' });
    return result;
  }

  /**
   * Read the live mpv playlist as a normalized array of `QueueEntry`.
   *
   * Read-method semantics: uses `ensureAttached()` (does NOT spawn mpv).
   * If no mpv is running/attachable, returns `[]` so callers see an empty
   * queue rather than spawning a fresh, empty mpv. A filename the engine did
   * not build yields `songId: null` rather than throwing, since another
   * client can load anything through the shared IPC socket.
   */
  async getQueue(): Promise<QueueEntry[]> {
    await this.ensureAttached();
    if (!this.isRunning()) return [];

    const rawResult = await this.requireIpc().command('get_property', 'playlist');
    if (!Array.isArray(rawResult)) return [];
    const raw: unknown[] = rawResult;

    const entries: QueueEntry[] = [];
    const liveSongIds = new Set<string>();
    for (let index = 0; index < raw.length; index++) {
      const item = raw[index];
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;

      const filename = typeof record['filename'] === 'string' ? record['filename'] : '';
      const isCurrent = record['current'] === true;
      const isPlaying = record['playing'] === true;
      const titleRaw = record['title'];
      const mpvTitle = typeof titleRaw === 'string' && titleRaw !== '' ? titleRaw : undefined;

      const songId = filename === '' ? null : this.parseSongIdCached(filename, raw.length);
      if (songId !== null) liveSongIds.add(songId);

      // mpv's title wins, since it sees ICY and dynamic title updates. The cache
      // fills the tracks mpv has not loaded.
      const cached = songId !== null ? this.metadataCache.get(songId) : undefined;

      const entry: QueueEntry = {
        index,
        songId,
        isCurrent,
        isPlaying,
      };
      if (typeof record['id'] === 'number') entry.entryId = record['id'];
      const resolvedTitle = mpvTitle ?? cached?.title;
      if (resolvedTitle !== undefined && resolvedTitle !== '') entry.title = resolvedTitle;
      if (cached?.artist !== undefined && cached.artist !== '') entry.artist = cached.artist;
      if (cached?.album !== undefined && cached.album !== '') entry.album = cached.album;
      if (cached?.duration !== undefined && cached.duration > 0) entry.duration = cached.duration;
      entries.push(entry);
    }
    this.liveSongIds = liveSongIds;
    return entries;
  }

  /**
   * Back-fill the metadata cache for entries the engine never saw, such as
   * after an attach. Shares the cap and overwrite rules of `enqueue`.
   */
  ingestQueueMetadata(metadata: ReadonlyArray<QueueTrackMetadata>): void {
    this.ingestMetadata(metadata);
  }

  /**
   * Merge a batch of caller-supplied track metadata into the per-session cache.
   * Entries missing `songId` are skipped (no key to index by). Existing keys
   * are overwritten with the freshest values.
   */
  private ingestMetadata(metadata: ReadonlyArray<QueueTrackMetadata> | undefined): void {
    if (metadata === undefined || metadata.length === 0) return;
    const batchSongIds = new Set<string>();
    for (const m of metadata) {
      if (typeof m.songId !== 'string' || m.songId === '') continue;
      // Map.set keeps an existing key's insertion slot, so a delete first makes the re-ingested key newest.
      this.metadataCache.delete(m.songId);
      this.metadataCache.set(m.songId, m);
      batchSongIds.add(m.songId);
    }
    for (const songId of this.metadataCache.keys()) {
      if (this.metadataCache.size <= FILENAME_CACHE_LIMIT) break;
      if (!this.liveSongIds.has(songId) && !batchSongIds.has(songId)) this.metadataCache.delete(songId);
    }
  }

  /**
   * Clear the live queue AND halt playback. Uses mpv `stop`, not
   * `playlist-clear`: `playlist-clear` removes everything *except* the
   * currently-playing track, so audio keeps coming out of the speakers.
   * `stop` empties the queue and silences output, which is what users
   * expect from a "clear" verb. Idempotent and safe when idle.
   */
  async clearQueue(): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      // An append after a clear lands a new track at index 0, so per-position caches must not match it.
      this.queueGeneration++;
      await this.requireIpc().command('stop');
      this.metadataCache.clear();
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Replace the live queue with a single radio stream and start playback.
   *
   * An infinite radio stream mixed with finite tracks breaks skip, queue
   * position, and scrobbling, so this always replaces the whole queue, as
   * Navidrome's web UI does. `loadfile <url> replace` clears the prior queue.
   */
  async enqueueRadio(streamUrl: string, stationId: string): Promise<void> {
    if (streamUrl.trim() === '') {
      throw new Error('enqueueRadio requires a non-empty stream URL');
    }
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      this.queueGeneration++;
      // Tagged before the load, so a poll never pairs the new stream with the previous station's tag.
      await this.writeRadioStationTag(ipc, stationId);
      await ipc.command('loadfile', streamUrl, 'replace');
      await ipc.command('set_property', 'pause', false);
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /** The saved-station ID the last radio play tagged. Null when none is set or mpv has no user-data. */
  getRadioStationTag(): string | null {
    const tag = this.propertyCache.get(RADIO_STATION_TAG_PROPERTY);
    return typeof tag === 'string' && tag !== '' ? tag : null;
  }

  // Best effort. Without the tag, the station name falls back to the first saved station with the stream URL.
  private async writeRadioStationTag(ipc: MpvIpc, stationId: string): Promise<void> {
    try {
      await ipc.command('set_property', RADIO_STATION_TAG_PROPERTY, stationId);
    } catch (error) {
      logger.debug(`radio station tag not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Whether the live queue holds a radio stream, meaning any entry with no
   * Navidrome song id. `enqueue` uses it to keep radio and songs apart.
   *
   * Reads the live playlist, since the observed `playlist-count` can lag a load
   * that just finished. Returns false when the engine isn't running.
   */
  async hasRadioStream(): Promise<boolean> {
    if (!this.isRunning()) return false;
    const playlist = await this.getQueue();
    return playlist.some(entry => entry.songId === null);
  }

  /** Lets per-position caches tell a new load at the same index from the previous one. */
  getQueueGeneration(): number {
    return this.queueGeneration;
  }

  /**
   * Randomize the order of items in the live queue via mpv's native
   * `playlist-shuffle` command. Atomic on mpv's side. Lazy-spawns mpv.
   *
   * The playing track keeps playing, since a shuffle must never restart on a
   * random track. `playlist-move` lifts it back to index 0 so the queue top
   * still shows what is audible. Pause state is preserved.
   *
   * The post-shuffle position is read fresh via IPC because the observed
   * `playlist-pos` cache may not have caught up to the shuffle yet.
   */
  async shuffleQueue(): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      await ipc.command('playlist-shuffle');
      const pos = await ipc.command('get_property', 'playlist-pos');
      if (typeof pos === 'number' && pos > 0) {
        await ipc.command('playlist-move', pos, 0);
      }
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Shuffle the whole queue and make the new top track current, keeping the
   * play or pause state. The web remote's shuffle restarts from the top, while
   * `shuffleQueue` keeps the playing track on top for `shuffle_play_queue`.
   */
  async shuffleQueueFromTop(): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      // Read fresh because the observed cache can lag a just-finished mutation.
      const count = await ipc.command('get_property', 'playlist-count');
      const pos = await ipc.command('get_property', 'playlist-pos');
      const paused = await ipc.command('get_property', 'pause');
      if (typeof count !== 'number' || count <= 0) return;

      const wasPlaying = typeof pos === 'number' && pos >= 0 && paused === false;
      this.queueGeneration++;
      await ipc.command('playlist-shuffle');
      if (!wasPlaying) {
        await ipc.command('set_property', 'pause', true);
      }
      await ipc.command('set_property', 'playlist-pos', 0);
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Move the queue entry at `from` so it takes the place of `to`.
   * Index bounds are not pre-validated, which avoids a race with concurrent
   * queue mutations. The tool layer turns mpv's out-of-range error into one that names the index.
   *
   * Reordering never changes what is playing, since mpv tracks the play head
   * by entry, not by index. This matches Navidrome's own web UI.
   */
  async moveQueueEntry(from: number, to: number): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      await this.requireIpc().command('playlist-move', from, to);
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Remove the queue entry at the given index. mpv advances to the next
   * track when the current one is removed.
   */
  async removeQueueEntry(index: number): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      await this.requireIpc().command('playlist-remove', index);
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Skip to the next track in mpv's playlist. Uses the `force` flag so it
   * advances even if we are on the last entry (per mpv docs, `weak` does
   * nothing at the end). Lazy-spawns mpv if necessary.
   */
  async next(): Promise<void> {
    await this.ensureRunning();
    await this.requireIpc().command('playlist-next', 'force');
  }

  /**
   * Restarts the track on the first entry, since `playlist-prev force` there terminates playback.
   */
  async previous(): Promise<void> {
    await this.ensureRunning();
    const pos = await this.requireIpc().command('get_property', 'playlist-pos');
    if (typeof pos === 'number' && pos > 0) {
      await this.requireIpc().command('playlist-prev');
      return;
    }
    if (pos === 0) {
      await this.seek(0, 'absolute');
    }
  }

  /**
   * Seek within the current track. `mode` selects between absolute (jump to
   * given second within the track) and relative (offset from current
   * position, negative seeks backwards). Lazy-spawns mpv if necessary.
   */
  async seek(seconds: number, mode: 'absolute' | 'relative'): Promise<void> {
    await this.ensureRunning();
    const ipc = this.requireIpc();
    for (let attempt = 1; attempt <= SEEK_MAX_ATTEMPTS; attempt++) {
      try {
        await ipc.command('seek', seconds, mode);
        if (attempt > 1) {
          logger.debug(`seek ${seconds} ${mode} succeeded on retry ${attempt}/${SEEK_MAX_ATTEMPTS}`);
        }
        return;
      } catch (err) {
        // Only the transient transcode rejection clears on retry. Any other
        // failure is deterministic, so rethrow at once.
        const retryable = err instanceof Error && /error running command/i.test(err.message);
        if (!retryable || attempt === SEEK_MAX_ATTEMPTS) throw err;
        logger.debug(`seek ${seconds} ${mode} attempt ${attempt}/${SEEK_MAX_ATTEMPTS} failed, retrying: ${err.message}`);
        await new Promise<void>((resolve) => setTimeout(resolve, SEEK_RETRY_DELAY_MS));
      }
    }
  }

  /**
   * Jump the play head to the play-queue entry at `index`, like clicking a
   * row in a media player's queue. Queue contents are not mutated.
   *
   * Unpauses, because a jump means play this now. Mirrors the unpause in enqueue(replace).
   *
   * mpv accepts an index past the end and stops playback, so the tool layer checks the bound first.
   * No `emitStateChange` is needed, since mpv's
   * `playlist-pos` change event reaches subscribers.
   */
  async jumpToQueueEntry(index: number): Promise<void> {
    await this.ensureRunning();
    const ipc = this.requireIpc();
    await ipc.command('set_property', 'playlist-pos', index);
    await ipc.command('set_property', 'pause', false);
  }

  /** Live reads, since a cached property event can lag a loadfile sent just before. mpv reports -1 with no current entry. */
  async readQueueState(): Promise<{ position: number; count: number }> {
    const ipc = this.requireIpc();
    const position = await ipc.command('get_property', 'playlist-pos');
    const count = await ipc.command('get_property', 'playlist-count');
    return {
      position: typeof position === 'number' ? position : -1,
      count: typeof count === 'number' ? count : 0,
    };
  }

  /**
   * Read a property from the engine's local observed-property cache. Returns
   * `undefined` if the property has never been observed.
   */
  getCachedProperty(name: string): unknown {
    return this.propertyCache.get(name);
  }

  /**
   * Register a subscriber for engine state-change events (mpv property
   * updates + queue mutations). Returns an unsubscribe function, which
   * long-lived callers (e.g. SSE clients) must call to avoid a handler leak.
   *
   * Handlers run synchronously in registration order. A throwing handler is
   * logged and skipped so it cannot deny notifications to others. Events are
   * not buffered, so a caller needing a baseline reads the getters after subscribing.
   */
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.push(handler);
    return () => {
      const idx = this.stateChangeHandlers.indexOf(handler);
      if (idx !== -1) this.stateChangeHandlers.splice(idx, 1);
    };
  }

  /**
   * Read engine status. Does NOT trigger lazy spawn. If the engine has not
   * been started yet, returns `{ engineRunning: false, ... }`.
   */
  getStatus(): PlaybackStatus {
    if (!this.isRunning()) {
      return {
        engineRunning: false,
        mpvPath: this.mpvBinary,
        mpvVersion: null,
        volume: null,
        idle: null,
      };
    }
    const volume = this.propertyCache.get('volume');
    const idle = this.propertyCache.get('idle-active');
    return {
      engineRunning: true,
      mpvPath: this.mpvBinary,
      mpvVersion: this.mpvVersion,
      volume: typeof volume === 'number' ? volume : null,
      idle: typeof idle === 'boolean' ? idle : null,
    };
  }

  songIdForPath(path: string): string | null {
    return this.parseSongIdCached(path, 0);
  }

  // ---------- internals ----------

  /**
   * Parse the Navidrome song id out of a stream URL, with per-session caching.
   * Only an http(s) URL whose path ends in `/rest/stream` yields an id. The
   * path is matched, not the configured origin, so songs loaded before a
   * Navidrome URL change still parse.
   */
  private parseSongIdCached(filename: string, queueLength: number): string | null {
    const cached = this.filenameCache.get(filename);
    if (cached !== undefined) return cached;

    let songId: string | null = null;
    // The prefilter skips `new URL()`, the only costly step, for filenames that cannot carry an id.
    const isHttp = filename.startsWith('http://') || filename.startsWith('https://');
    if (isHttp && filename.includes('id=')) {
      try {
        const url = new URL(filename);
        songId = url.pathname.endsWith(SUBSONIC_STREAM_PATH) ? url.searchParams.get('id') : null;
      } catch {
        songId = null;
      }
    }

    if (this.filenameCache.size >= Math.max(FILENAME_CACHE_LIMIT, queueLength)) {
      // FIFO is enough once the cap covers the queue being read, so no LRU bookkeeping.
      const oldest = this.filenameCache.keys().next().value;
      if (oldest !== undefined) this.filenameCache.delete(oldest);
    }
    this.filenameCache.set(filename, songId);
    return songId;
  }

  /**
   * Best effort. Builds without `mpv-version` fall back to the client API
   * version, and null means neither source answered.
   */
  private async readMpvVersion(ipc: MpvIpc): Promise<string | null> {
    try {
      const property = await ipc.command('get_property', 'mpv-version');
      if (typeof property === 'string' && property !== '') {
        return property;
      }
    } catch {
      // Older mpv builds may lack the property. Fall through to the fallback.
    }
    try {
      const fallback = await ipc.command('get_version');
      if (typeof fallback === 'number' && Number.isFinite(fallback)) {
        const major = (fallback >>> 16) & 0xff;
        const minor = (fallback >>> 8) & 0xff;
        const patch = fallback & 0xff;
        return `client-api ${major}.${minor}.${patch}`;
      }
      if (fallback !== null && fallback !== undefined) {
        return typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
      }
    } catch {
      // No version is available.
    }
    return null;
  }

  /** Sends a `script-message` that every client attached to this mpv receives. Never spawns mpv. */
  async broadcastMessage(args: string[]): Promise<void> {
    await this.requireIpc().command('script-message', ...args);
  }

  private requireIpc(): MpvIpc {
    if (this.ipc?.isConnected() !== true) {
      throw new Error('mpv IPC is not connected');
    }
    return this.ipc;
  }

  /**
   * Dispatch a state-change event to every registered subscriber. A handler
   * that throws is logged and skipped, so one dead SSE client cannot deny
   * notifications to the others.
   */
  private emitStateChange(event: StateChangeEvent): void {
    if (this.stateChangeHandlers.length === 0) return;
    for (const handler of this.stateChangeHandlers) {
      try {
        handler(event);
      } catch (err) {
        logger.debug(`state-change handler threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Build a Subsonic-compatible stream URL for the given song ID using the
   * configured Navidrome credentials and transcode settings. Credentials
   * travel localhost → mpv → Navidrome (LAN), so query-param auth is fine
   * for this path.
   */
  private buildStreamUrl(songId: string): string {
    if (this.config === null) {
      throw new Error('PlaybackEngine has not been configured. Call configure(config) first.');
    }
    // mpv cannot compute auth, so salted-MD5 params ride in the URL and a leaked
    // URL cannot recover the password. `format=raw` is fully byte-range
    // seekable, and `maxBitRate` applies only when transcoding.
    const isRaw = this.config.playbackTranscodeFormat === 'raw';
    const streamParams: Record<string, string> = isRaw
      ? { id: songId, format: 'raw' }
      : {
          id: songId,
          format: this.config.playbackTranscodeFormat,
          maxBitRate: this.config.playbackTranscodeBitrate,
        };
    const params = buildSubsonicAuthParams(
      this.config.navidromeUsername,
      this.config.navidromePassword,
      streamParams,
    );
    return `${this.config.navidromeUrl}${SUBSONIC_STREAM_PATH}?${params.toString()}`;
  }

  /**
   * Run a mutating queue operation under the engine-wide mutation lock so
   * concurrent callers serialize. The stored lock swallows rejections, so one
   * failed task does not poison the chain.
   */
  private withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationLock.then(() => fn());
    this.mutationLock = next.catch(() => undefined);
    return next;
  }

  private async startOrAttach(): Promise<void> {
    if (this.config === null) {
      throw new Error('PlaybackEngine has not been configured. Call configure(config) first.');
    }
    if (this.mpvBinary === null) {
      throw new Error(ErrorFormatter.configMissing('Playback', 'mpv binary'));
    }

    this.ipcPath = getDefaultIpcPath();

    // Attaching to a running mpv is what makes playback persist across MCP restarts.
    if (await this.attachExistingShared()) {
      logger.info(`Playback engine attached to existing mpv (ipc=${this.ipcPath})`);
      return;
    }

    if (await cleanupStaleSocket(this.ipcPath)) {
      throw new Error(`mpv is running at ${this.ipcPath} but did not respond to IPC. Retry shortly, or quit that mpv.`);
    }
    await this.spawnAndConnect();
    logger.info(`Playback engine started (mpv ${this.mpvVersion ?? '?'}, ipc=${this.ipcPath})`);
  }

  /**
   * Share one in-flight attach between concurrent callers, so they never open
   * two connections that each relay every property change.
   */
  private attachExistingShared(): Promise<boolean> {
    this.attachPromise ??= this.tryAttachExisting().finally(() => {
      this.attachPromise = null;
    });
    return this.attachPromise;
  }

  /**
   * Try to connect to an mpv that's already listening on the well-known IPC
   * socket. Returns true if successful (engine state is fully populated),
   * false if no usable mpv was found.
   */
  private async tryAttachExisting(): Promise<boolean> {
    if (process.platform !== 'win32' && !existsSync(this.ipcPath)) {
      return false;
    }
    const ipc = new MpvIpc();
    try {
      await ipc.connect(this.ipcPath, MPV_ATTACH_CONNECT_RETRIES, MPV_ATTACH_CONNECT_DELAY_MS);
      this.mpvVersion = await this.readMpvVersion(ipc);

      // installObservers rejects on an unresponsive socket, which fails the attach.
      await this.installObservers(ipc);
      this.ipc = ipc;
      if (this.visualizerKeepsInSync) void this.queueVisualizerSync(ipc, {});
      return true;
    } catch (err) {
      logger.debug(`Could not attach to existing mpv at ${this.ipcPath}: ${err instanceof Error ? err.message : String(err)}`);
      try { ipc.close(); } catch { /* noop */ }
      return false;
    }
  }

  /**
   * Spawn, connect and install observers. On failure, roll back state and kill the child so a failed spawn never leaves an orphan mpv holding the audio device.
   */
  private async spawnAndConnect(): Promise<void> {
    if (this.mpvBinary === null) {
      throw new Error(ErrorFormatter.configMissing('Playback', 'mpv binary'));
    }
    // quitMpv has already run, so a child spawned now would outlive the exit with no owner.
    if (this.shuttingDown) {
      throw new Error('mpv was not started because the playback engine is quitting');
    }

    let ipc: MpvIpc | null = null;
    let expectedExit = false;
    // Runs beside the spawn, so the filter is checked by the time the new mpv answers.
    if (this.readVisualizerWanted()) void validateVisualizerFilter(this.mpvBinary);
    const child: ChildProcess = spawnMpv(this.mpvBinary, this.ipcPath);
    this.pendingSpawn = child;

    // A deliberate rollback kill or quit is expected, so it logs no warning.
    child.on('exit', (code, signal) => {
      if (!this.shuttingDown && !expectedExit) {
        logger.warn(`mpv exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      }
    });

    try {
      ipc = new MpvIpc();
      await ipc.connect(this.ipcPath);

      this.mpvVersion = await this.readMpvVersion(ipc);

      await this.installObservers(ipc);
      // Before the caller's first load, so the first track already plays through the filter.
      await this.queueVisualizerSync(ipc, { checkWaitMs: MPV_VISUALIZER_SPAWN_WAIT_MS });

      this.ipc = ipc;
    } catch (err) {
      // mpv exits cleanly on SIGTERM.
      expectedExit = true;
      try { child.kill('SIGTERM'); } catch { /* already exited */ }
      if (ipc !== null) {
        try { ipc.close(); } catch { /* noop */ }
      }
      this.ipc = null;
      this.mpvVersion = null;
      this.propertyCache.clear();
      throw err;
    } finally {
      this.pendingSpawn = null;
    }
  }

  /**
   * Install property observers, event handlers, and disconnect recovery.
   * Prime so the cache is filled when this resolves, since observe's initial emits
   * can arrive after its replies. The handler is registered before observe_property,
   * so mpv's initial emit is the freshest write.
   */
  private async installObservers(ipc: MpvIpc): Promise<void> {
    // Registered first so no event during the prime and observe sequence is missed.
    ipc.onEvent((evt) => {
      const args = evt['args'];
      if (evt.event === 'client-message' && Array.isArray(args)) {
        this.emitStateChange({ kind: 'message', args: args.filter((a): a is string => typeof a === 'string') });
        return;
      }
      if (evt.event === 'playback-restart') this.playbackRestarts++;
      // Every track start, not only a pending one, since mpv disables a filter that fails for one track.
      if (evt.event === 'start-file' && this.visualizerKeepsInSync) {
        const restarts = this.playbackRestarts;
        void this.queueVisualizerSync(ipc, { stillSafe: () => this.playbackRestarts === restarts });
      }
      const reason = typeof evt['reason'] === 'string' ? ` (${evt['reason']})` : '';
      logger.debug(`mpv event: ${evt.event}${reason}`);
    });
    ipc.onDisconnect(() => {
      // mpv may still be alive, so the next call re-attaches. An orphaned
      // connection must not detach the engine from the live one.
      logger.debug('mpv IPC disconnected. The engine will re-attach on the next call.');
      if (this.ipc === ipc) this.ipc = null;
    });

    for (const [, name] of [...OBSERVED_PROPERTIES, ...OPTIONAL_OBSERVED_PROPERTIES]) {
      try {
        const value = await ipc.command('get_property', name);
        this.propertyCache.set(name, value);
      } catch {
        // Some properties (e.g. duration with no file loaded) error out. Leave them unset.
      }
    }

    ipc.onPropertyChange((evt) => {
      this.propertyCache.set(evt.name, evt.data);
      this.emitStateChange({ kind: 'property', name: evt.name, data: evt.data });
      const quietNow = (evt.name === 'pause' || evt.name === 'idle-active') && evt.data === true;
      if (quietNow && this.visualizerPending && this.visualizerKeepsInSync) void this.queueVisualizerSync(ipc, {});
    });

    // mpv sends no property events before observe_property, so this precedes the new instance's snapshot.
    this.emitStateChange({ kind: 'attach' });
    for (const [id, name] of OBSERVED_PROPERTIES) {
      await ipc.observeProperty(id, name);
    }
    for (const [id, name] of OPTIONAL_OBSERVED_PROPERTIES) {
      try {
        await ipc.observeProperty(id, name);
      } catch (error) {
        logger.debug(`mpv cannot observe ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Never rejects, so a failed sync cannot fail the spawn that awaits it.
  private queueVisualizerSync(ipc: MpvIpc, request: VisualizerSyncRequest): Promise<void> {
    this.visualizerSyncChain = this.visualizerSyncChain
      .then(() => this.applyVisualizerFilter(ipc, request))
      .catch((err: unknown) => {
        logger.debug(`visualizer filter sync failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    return this.visualizerSyncChain;
  }

  // Safety is read when the sync runs, since a sync can wait in the chain past the moment that queued it.
  private async applyVisualizerFilter(ipc: MpvIpc, request: VisualizerSyncRequest): Promise<void> {
    const wanted = this.readVisualizerWanted();
    const installed = hasVisualizerFilter(await ipc.command('get_property', 'af'));
    // A working filter proves this mpv runs it, whichever process added it.
    if (installed) this.setVisualizerRefusal(null);
    const action = decideVisualizerAction({ wanted, installed, safe: this.isSafeForFilterChange(request) });
    this.visualizerPending = action === 'defer';
    // Warms the check, so the deferred install at the next track start does not wait on it.
    if (action === 'defer' && wanted) void validateVisualizerFilter(this.mpvBinary);
    if (action === 'install') await this.installVisualizerFilter(ipc, request);
    if (action === 'remove') await ipc.command('af', 'remove', `@${VISUALIZER_FILTER_LABEL}`);
  }

  private async installVisualizerFilter(ipc: MpvIpc, request: VisualizerSyncRequest): Promise<void> {
    const validation = await this.awaitVisualizerCheck(request.checkWaitMs);
    if (validation === undefined) {
      this.visualizerPending = true;
      return;
    }
    const refusal = validation.ok ? await this.checkLiveBuild(ipc, validation.build) : validation.reason;
    this.setVisualizerRefusal(refusal);
    if (refusal !== null) return;
    // The check can outlast the safe moment, so a track playing by now gets the filter at the next one.
    if (!this.isSafeForFilterChange(request)) {
      this.visualizerPending = true;
      return;
    }
    await ipc.command('af', 'add', visualizerFilterSpec());
  }

  /** Undefined when the check outlasts `waitMs`. */
  private async awaitVisualizerCheck(waitMs: number | undefined): Promise<VisualizerValidation | undefined> {
    const settled = settledVisualizerValidation(this.mpvBinary);
    if (settled !== undefined) return settled;
    const check = validateVisualizerFilter(this.mpvBinary);
    if (waitMs === undefined) return check;
    let timer: NodeJS.Timeout | undefined;
    const giveUp = new Promise<undefined>((resolve) => { timer = setTimeout(() => { resolve(undefined); }, waitMs); });
    try {
      return await Promise.race([check, giveUp]);
    } finally {
      clearTimeout(timer);
    }
  }

  // The check ran the configured binary, and an mpv started from another one may lack what the filter needs.
  private async checkLiveBuild(ipc: MpvIpc, checkedBuild: string): Promise<string | null> {
    const ffmpegVersion: unknown = await ipc.command('get_property', 'ffmpeg-version').catch(() => null);
    const liveBuild = mpvBuildId(this.mpvVersion, ffmpegVersion);
    if (liveBuild === checkedBuild) return null;
    return `the running mpv (${liveBuild ?? 'unknown build'}) is not the checked ${checkedBuild}`;
  }

  private setVisualizerRefusal(refusal: string | null): void {
    if (refusal === this.visualizerRefusal) return;
    if (refusal !== null) logger.warn(`The visualizer is off: ${refusal}`);
    this.visualizerRefusal = refusal;
    this.emitStateChange({ kind: 'visualizer' });
  }

  private isSafeForFilterChange(request: VisualizerSyncRequest): boolean {
    return request.stillSafe?.() === true || this.isIdleOrPaused();
  }

  private readVisualizerWanted(): boolean {
    try {
      return this.visualizerWanted();
    } catch (err) {
      logger.debug(`visualizer setting unreadable, treating it as off: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private isIdleOrPaused(): boolean {
    return this.propertyCache.get('idle-active') === true || this.propertyCache.get('pause') === true;
  }

  /**
   * Quit the mpv process, then tear down our IPC state. The entry points
   * (src/index.ts and src/web/main.ts) own process shutdown and call this to
   * stop mpv. Contrast with `shutdown()`, which leaves mpv running.
   *
   * A one-shot connection delivers `quit` even when our own connection is
   * gone. Bounded and best effort, so it is a no-op when nothing is listening.
   * A spawn still connecting is killed directly, since waiting for it can outlast
   * the caller's exit and leave its detached child running.
   */
  async quitMpv(): Promise<void> {
    this.shuttingDown = true;
    try { this.pendingSpawn?.kill('SIGTERM'); } catch { /* already exited */ }
    await quitMpvViaSocket(this.ipcPath);
    this.shutdown();
  }

  /**
   * Disconnect our IPC from mpv and reset all engine session state (cache,
   * subscribers, version). Does NOT kill the mpv process, so playback persists
   * across restarts. Contrast with {@link quitMpv}, which stops the audio.
   *
   * Idempotent. The engine can start again afterward, but subscribers are dropped and must re-subscribe.
   */
  shutdown(): void {
    const ipc = this.ipc;
    if (ipc?.isConnected() === true) {
      try { ipc.close(); } catch { /* noop */ }
    }

    this.ipc = null;
    this.mpvVersion = null;
    this.propertyCache.clear();
    this.filenameCache.clear();
    this.metadataCache.clear();
    this.liveSongIds = new Set();
    this.startPromise = null;
    this.visualizerPending = false;
    this.visualizerRefusal = null;
    // Subscribers belong to the prior session.
    this.stateChangeHandlers.length = 0;
  }
}

/**
 * Send mpv `quit` over a one-shot connection to its IPC socket. mpv accepts
 * concurrent IPC clients, so this works beside a live engine connection or
 * after it closed. Resolves quietly when nothing is listening.
 */
function quitMpvViaSocket(path: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    let sock: ReturnType<typeof createConnection>;
    try {
      sock = createConnection({ path });
    } catch {
      done();
      return;
    }
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch { /* noop */ }
      done();
    }, MPV_QUIT_SOCKET_TIMEOUT_MS);
    timer.unref();
    sock.once('error', () => { clearTimeout(timer); done(); });
    sock.once('close', () => { clearTimeout(timer); done(); });
    sock.once('connect', () => {
      // `end()` flushes the command then half-closes, so mpv reads `quit` and exits.
      try { sock.end('{ "command": ["quit"] }\n'); } catch { /* noop */ }
    });
  });
}

/**
 * Resolves true when a listener holds the path. A live listener fails the start, since unlinking its
 * socket orphans that mpv while it holds the audio device and a spawn beside it starts a second player.
 */
async function cleanupStaleSocket(path: string): Promise<boolean> {
  const isWindows = process.platform === 'win32';
  // A named pipe has no file to stat or unlink.
  if (!isWindows && !existsSync(path)) return false;

  const someoneListening = await new Promise<boolean>((resolve) => {
    const probe = createConnection({ path });
    let done = false;
    const finish = (alive: boolean): void => {
      if (done) return;
      done = true;
      try { probe.destroy(); } catch { /* ignore */ }
      resolve(alive);
    };
    const timer = setTimeout(() => finish(false), MPV_STALE_SOCKET_PROBE_MS);
    timer.unref();
    probe.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    probe.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });

  if (someoneListening || isWindows) return someoneListening;
  try {
    await unlink(path);
  } catch {
    // Best effort. mpv fails to bind if the file is still busy, which surfaces a real error.
  }
  return false;
}

export const playbackEngine = PlaybackEngine.getInstance();
