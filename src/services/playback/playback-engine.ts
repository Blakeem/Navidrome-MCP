/**
 * Navidrome MCP Server - Playback Engine
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';
import type { Config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import {
  AUDIO_OUTPUT_RESUME_WINDOW_MS,
  MPV_ATTACH_CONNECT_DELAY_MS,
  MPV_ATTACH_CONNECT_RETRIES,
  MPV_QUIT_SOCKET_TIMEOUT_MS,
  MPV_STALE_SOCKET_PROBE_MS,
  MPV_VISUALIZER_SPAWN_WAIT_MS,
} from '../../constants/timeouts.js';
import { MAX_QUEUE_READ_PAGES, QUEUE_READ_PAGE_SIZE } from '../../constants/defaults.js';
import { buildSubsonicAuthParams } from '../../utils/subsonic-auth.js';
import {
  AUTO_DEVICE_ID,
  findReplacementDevice,
  NULL_AUDIO_OUTPUT,
  parseAudioDeviceList,
  probeAudioDevices,
  resolveSavedDevice,
  type AudioDevice,
} from './audio-devices.js';
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
 * The row cap of one paged queue read. An enqueue can carry more, such as an album set. Both caches
 * grow past it for a longer live queue, since evicting a live entry forces a refetch on every read.
 */
const FILENAME_CACHE_LIMIT = MAX_QUEUE_READ_PAGES * QUEUE_READ_PAGE_SIZE;

const SUBSONIC_STREAM_PATH = '/rest/stream';

/** Cached locally, so consumers read state without an IPC round trip. */
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
  [14, 'audio-device'],
  [15, 'audio-device-list'],
  [16, 'current-ao'],
];

const AUDIO_OUTPUT_PROPERTIES: ReadonlySet<string> = new Set(['audio-device', 'audio-device-list', 'current-ao']);

// Names the saved station a radio stream was played from, since saved stations can share a URL.
// Observed so every process sharing mpv sees a change. Optional, since mpv before 0.36 lacks it.
const RADIO_STATION_TAG_PROPERTY = 'user-data/navidrome-mcp/radio-station-id';
// A song replace sets the pending mark before it clears the queue and raises the generation once
// it completes, so the web player process tells songs a replace removed from songs a clear removed.
export const REPLACE_PENDING_PROPERTY = 'user-data/navidrome-mcp/replace-pending';
export const REPLACE_GENERATION_PROPERTY = 'user-data/navidrome-mcp/replace-generation';
const OPTIONAL_OBSERVED_PROPERTIES: ReadonlyArray<readonly [number, string]> = [
  [13, RADIO_STATION_TAG_PROPERTY],
  [17, REPLACE_PENDING_PROPERTY],
  [18, REPLACE_GENERATION_PROPERTY],
];

// On a transcoded stream mpv can briefly reject a valid seek while its cache settles, and a retry
// of the same command clears it.
const SEEK_MAX_ATTEMPTS = 4;
const SEEK_RETRY_DELAY_MS = 250;

interface SelectedAudioDevice {
  id: string;
  name: string | null;
  connected: boolean;
}

export interface MissingAudioOutput {
  id: string;
  name: string | null;
}

export interface AudioDeviceReport {
  selected: SelectedAudioDevice;
  output: string | null;
  devices: AudioDevice[];
  source: 'player' | 'probe';
}

interface AudioOutputValues {
  audioDevice: unknown;
  devices: AudioDevice[];
  currentAo: unknown;
}

export interface PlaybackStatus {
  engineRunning: boolean;
  mpvPath: string | null;
  mpvVersion: string | null;
  volume: number | null;
  idle: boolean | null;
  audioDevice: SelectedAudioDevice | null;
  audioOutputLost: boolean | null;
}

export interface QueueEntry {
  index: number;
  /** Null for any filename the engine did not build, such as a radio stream. */
  songId: string | null;
  /** mpv's per-entry id survives a move, so it tells a shifted entry from a new one. */
  entryId?: number;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  isCurrent: boolean;
  isPlaying: boolean;
}

/** mpv loads metadata only for tracks it touches, so without this, future entries are bare IDs. */
export interface QueueTrackMetadata {
  songId: string;
  title?: string;
  artist?: string;
  album?: string;
  /** Seconds, matching mpv's `duration`. */
  duration?: number;
}

/** A caller that must never replace the queue, such as a guest add, gets this instead of a demotion. */
export class RadioQueueRefusedError extends Error {
  constructor() {
    super('The queue holds a radio stream, so the append was refused instead of replacing the queue.');
    this.name = 'RadioQueueRefusedError';
  }
}

/** A guarded removal found its entry playing, and only the host may skip a playing song. */
export class QueueEntryStartedError extends Error {
  constructor(entryId: number) {
    super(`Queue entry ${String(entryId)} is playing, so the removal was refused instead of skipping it.`);
    this.name = 'QueueEntryStartedError';
  }
}

/** An mpv without user-data, or a replace from a release that never marks one, reads as no replace. */
export interface ReplaceMarks {
  generation: number;
  pending: boolean;
}

/** Any entry without a song id counts as radio. */
export function holdsRadioStream(entries: readonly QueueEntry[]): boolean {
  return entries.some((entry) => entry.songId === null);
}

interface LoadedEntry {
  url: string;
  entryId: number | null;
}

// mpv answers `loadfile` with `{ playlist_entry_id }`.
function entryIdFromLoadReply(reply: unknown): number | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const entryId = (reply as Record<string, unknown>)['playlist_entry_id'];
  return typeof entryId === 'number' ? entryId : null;
}

export type StateChangeEvent =
  | { kind: 'property'; name: string; data: unknown }
  // Follows a queue mutation, since mpv's property events miss some of the changes it makes.
  | { kind: 'queue' }
  // Precedes a new mpv instance's observe snapshot, so subscribers drop the old instance's state.
  | { kind: 'attach' }
  // mpv delivers a client-message to every IPC client, the sender included, in one order.
  | { kind: 'message'; args: string[] }
  // No mpv event announces a change in isVisualizerUnsupported().
  | { kind: 'visualizer' };

type StateChangeHandler = (event: StateChangeEvent) => void;

interface VisualizerSyncRequest {
  // A track start is safe until its audio begins, which mpv announces with playback-restart.
  stillSafe?: () => boolean;
  // Set by the spawn path, whose caller holds a play request until the sync finishes.
  checkWaitMs?: number;
}

class PlaybackEngine {
  private static instance: PlaybackEngine | null = null;

  private config: Config | null = null;
  private mpvBinary: string | null = null;
  private ipcPath: string = getDefaultIpcPath();
  // mpv runs detached so playback survives a restart. Once a spawn connects, the engine keeps no
  // child handle, and the IPC connection is its only link to mpv.
  private ipc: MpvIpc | null = null;
  private startPromise: Promise<void> | null = null;
  private attachPromise: Promise<boolean> | null = null;
  private mpvVersion: string | null = null;
  // Set by quitMpv. It silences the child's exit handler and refuses any later spawn.
  private shuttingDown = false;
  private readonly propertyCache = new Map<string, unknown>();
  // Bumped whenever a new track can next land at index 0, so a per-position cache in a consumer,
  // such as now_playing's duration repair, never matches the previous track at that index.
  private queueGeneration = 0;
  // Interleaved IPC sequences can leave a hybrid queue. The lock does not span processes, so loads
  // from the MCP and the web remote at once can still interleave.
  private mutationLock: Promise<unknown> = Promise.resolve();
  // Set by every control path and never cleared. Reads and the startup attach leave it unset, so
  // an MCP that only observed mpv does not quit another MCP's playback on exit.
  private controlledMpv = false;
  // The spawned child until its connect commits. It runs detached, with no socket to receive quit.
  private pendingSpawn: ChildProcess | null = null;
  // getQueue() is polled often with 100+ entries, and mpv filenames are stable for the queue's
  // lifetime, so parsed song IDs are cached.
  private readonly filenameCache = new Map<string, string | null>();
  // Lets getQueue() report titles for entries mpv has not loaded. A removed entry stays until the
  // cache passes its cap, since a stale entry costs only bytes.
  private readonly metadataCache = new Map<string, QueueTrackMetadata>();
  // Song IDs in the playlist the last getQueue() read, which metadata eviction never drops.
  private liveSongIds: ReadonlySet<string> = new Set();
  private readonly stateChangeHandlers: Array<StateChangeHandler> = [];
  // Each entry point says how it reads the visualizer setting. Off until one does, so a bare engine
  // adds no filter.
  private visualizerWanted: () => boolean = () => false;
  private visualizerKeepsInSync = false;
  private visualizerPending = false;
  // Why the filter cannot run on the current mpv, or null when it can.
  private visualizerRefusal: string | null = null;
  // Lets a track-start sync that waited in the chain tell whether that track's audio has begun.
  private playbackRestarts = 0;
  // A pause and a track start can land together, and each reads the af list before it writes.
  private visualizerSyncChain: Promise<void> = Promise.resolve();
  // None until an entry point names the saved device, so a bare engine opens mpv's default output.
  private audioDeviceSource: () => Config['playbackAudioDevice'] = () => null;
  private saveAudioDevice: (device: AudioDevice) => boolean = () => false;
  private audioOutputWasLost = false;
  // A device's return is the change from unlisted to listed, so the previous state is kept.
  private selectedDeviceWasConnected = true;
  // Every id ever listed beside the selected device, since none of them can be its re-registered id.
  private lastListedSelection: { device: AudioDevice; listedBeside: ReadonlySet<string> } | null = null;
  private replacingDeviceId: string | null = null;
  // Kept per engine, so only an engine that wrote a loss pause resumes it.
  private lostOutputPause: { at: number; deviceId: string } | null = null;

  private constructor() {}

  static getInstance(): PlaybackEngine {
    PlaybackEngine.instance ??= new PlaybackEngine();
    return PlaybackEngine.instance;
  }

  configure(config: Config): void {
    this.config = config;
    this.mpvBinary = config.mpvPath ?? null;
  }

  /**
   * Every engine adds the filter to an mpv it spawns, so the first track plays through it. Only an
   * engine with `keepInSync` changes it later, so two processes that read the setting differently
   * never undo each other.
   */
  setVisualizerSource(source: () => boolean, options: { keepInSync?: boolean } = {}): void {
    this.visualizerWanted = source;
    this.visualizerKeepsInSync = options.keepInSync === true;
  }

  syncVisualizerFilter(): Promise<void> {
    const ipc = this.ipc;
    return ipc === null || !this.visualizerKeepsInSync ? Promise.resolve() : this.queueVisualizerSync(ipc, {});
  }

  isVisualizerUnsupported(): boolean {
    return this.visualizerRefusal !== null;
  }

  /**
   * Read at each spawn, so a device saved after this process started applies. `save` stores the new
   * id when Windows re-registers the saved device.
   */
  setAudioDeviceSource(
    source: () => Config['playbackAudioDevice'],
    options: { save?: (device: AudioDevice) => boolean } = {},
  ): void {
    this.audioDeviceSource = source;
    this.saveAudioDevice = options.save ?? ((): boolean => false);
  }

  isRunning(): boolean {
    return this.ipc?.isConnected() === true;
  }

  /** A spawn still connecting counts, since its detached child outlives an exit without quitMpv. */
  hasControlledMpv(): boolean {
    return this.controlledMpv || this.pendingSpawn !== null;
  }

  /**
   * Never spawns, so a read after an MCP restart re-attaches to a running mpv without starting an
   * empty one. It never rejects, and the caller checks isRunning() after.
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

  async pause(): Promise<void> {
    await this.ensureRunning();
    await this.requireIpc().command('set_property', 'pause', true);
  }

  async resume(): Promise<{ outputMissing: MissingAudioOutput | null }> {
    await this.ensureRunning();
    const ipc = this.requireIpc();
    const outputMissing = await this.checkAudioOutput(ipc);
    if (outputMissing === null) await ipc.command('set_property', 'pause', false);
    return { outputMissing };
  }

  async setVolume(level: number): Promise<number> {
    const clamped = Math.max(0, Math.min(100, level));
    await this.ensureRunning();
    await this.requireIpc().command('set_property', 'volume', clamped);
    return clamped;
  }

  /** `entryIds` lists the mpv ids of the loaded entries in load order, leaving out any id mpv never reported. */
  async enqueue(
    songIds: readonly string[],
    mode: 'replace' | 'append',
    metadata?: ReadonlyArray<QueueTrackMetadata>,
    options: { refuseRadioQueue?: boolean } = {},
  ): Promise<{ demoted: boolean; outputMissing: MissingAudioOutput | null; entryIds: number[] }> {
    if (songIds.length === 0) {
      throw new Error('enqueue requires at least one song ID');
    }
    await this.ensureRunning();
    const result = await this.withMutationLock(async () => {
      const ipc = this.requireIpc();

      // An infinite radio stream breaks queue semantics, so an append onto radio becomes a replace.
      // `demoted` tells the LLM its requested mode was not honored.
      let effectiveMode = mode;
      let demoted = false;
      // An append never unpauses, so only a replace checks the output.
      let outputMissing: MissingAudioOutput | null = null;
      const loaded: LoadedEntry[] = [];
      if (effectiveMode === 'append' && await this.hasRadioStream()) {
        if (options.refuseRadioQueue === true) throw new RadioQueueRefusedError();
        logger.warn('enqueue: append demoted to replace because queue contains a radio stream');
        effectiveMode = 'replace';
        demoted = true;
      }

      if (effectiveMode === 'replace') {
        this.queueGeneration++;
        // Replace is not atomic on mpv's side. A mid-sequence failure stops and clears, so the
        // queue never shows a half-load that contradicts the error.
        const [first, ...rest] = songIds;
        if (first === undefined) {
          throw new Error('enqueue requires at least one song ID');
        }
        outputMissing = await this.checkAudioOutput(ipc);
        this.metadataCache.clear();
        this.ingestMetadata(metadata);
        // Paused before the load, so the first track never plays on the null output.
        if (outputMissing !== null) await ipc.command('set_property', 'pause', true);
        await this.writeUserData(ipc, REPLACE_PENDING_PROPERTY, true);
        // Clear up front so the prior queue is gone even if the first loadfile fails.
        await ipc.command('playlist-clear');
        try {
          await this.loadEntry(ipc, first, 'replace', loaded);
          for (const id of rest) {
            await this.loadEntry(ipc, id, 'append', loaded);
          }
          if (outputMissing === null) await ipc.command('set_property', 'pause', false);
        } catch (err) {
          // Both are best effort, since a dead connection re-attaches on the next call.
          try {
            await ipc.command('playlist-clear');
          } catch {
            // The cache reset below and the next attach cover a dead connection.
          }
          try {
            await ipc.command('stop');
          } catch {
            // The IPC layer tears down a dead connection.
          }
          // Cleared with no generation rise, so the web player drops the guest songs as on a clear.
          await this.writeUserData(ipc, REPLACE_PENDING_PROPERTY, false);
          // A read before mpv's async change event must see the empty queue.
          this.propertyCache.set('playlist-count', 0);
          this.propertyCache.set('playlist-pos', null);
          // The rethrow skips the success-path emit, so broadcast the cleared queue here.
          this.emitStateChange({ kind: 'queue' });
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`enqueue failed mid-sequence; queue was cleared and is now empty: ${reason}`);
        }
        // The generation rises before the pending mark clears, so no reader sees neither mark.
        await this.raiseReplaceGeneration(ipc);
        await this.writeUserData(ipc, REPLACE_PENDING_PROPERTY, false);
      } else {
        this.ingestMetadata(metadata);
        // mpv selects nothing for tracks appended with no current entry. The first one is selected
        // paused, since an append never starts playback. Reads are fresh, since the cache lags.
        const posBeforeAppend = await ipc.command('get_property', 'playlist-pos');
        const countBeforeAppend = await ipc.command('get_property', 'playlist-count');
        for (const id of songIds) {
          await this.loadEntry(ipc, id, 'append', loaded);
        }
        const hadNoCurrentEntry = typeof posBeforeAppend === 'number' && posBeforeAppend < 0;
        if (hadNoCurrentEntry && typeof countBeforeAppend === 'number') {
          await ipc.command('set_property', 'pause', true);
          await ipc.command('set_property', 'playlist-pos', countBeforeAppend);
        }
      }

      const entryIds = await this.resolveEntryIds(ipc, loaded);
      return { demoted, outputMissing, entryIds };
    });
    this.emitStateChange({ kind: 'queue' });
    return result;
  }

  private async loadEntry(ipc: MpvIpc, songId: string, mode: 'replace' | 'append', loaded: LoadedEntry[]): Promise<void> {
    const url = this.buildStreamUrl(songId);
    const reply = await ipc.command('loadfile', url, mode);
    loaded.push({ url, entryId: entryIdFromLoadReply(reply) });
  }

  /**
   * An older mpv answers a loadfile without the entry id. Each stream URL carries a fresh
   * auth salt, so its filename names one entry in the playlist. The songs already loaded, so a
   * failed read leaves those ids out instead of failing the enqueue.
   */
  private async resolveEntryIds(ipc: MpvIpc, loaded: readonly LoadedEntry[]): Promise<number[]> {
    const reported = loaded.map((entry) => entry.entryId);
    if (reported.every((id): id is number => id !== null)) return reported;
    let playlist: unknown = null;
    try {
      playlist = await ipc.command('get_property', 'playlist');
    } catch (err) {
      logger.debug(`enqueue: playlist read for entry ids failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const idByFilename = new Map<string, number>();
    for (const item of Array.isArray(playlist) ? (playlist as unknown[]) : []) {
      const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
      if (typeof record['filename'] === 'string' && typeof record['id'] === 'number') idByFilename.set(record['filename'], record['id']);
    }
    return loaded
      .map((entry) => entry.entryId ?? idByFilename.get(entry.url))
      .filter((id): id is number => id !== undefined);
  }

  /** A foreign filename yields a null songId, not an error, since any client can load anything. */
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

      // mpv's title wins, since it sees ICY and dynamic title updates. The cache fills the tracks
      // mpv has not loaded.
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

  /** Back-fills metadata for entries the engine never saw, such as after an attach. */
  ingestQueueMetadata(metadata: ReadonlyArray<QueueTrackMetadata>): void {
    this.ingestMetadata(metadata);
  }

  private ingestMetadata(metadata: ReadonlyArray<QueueTrackMetadata> | undefined): void {
    if (metadata === undefined || metadata.length === 0) return;
    const batchSongIds = new Set<string>();
    for (const m of metadata) {
      if (typeof m.songId !== 'string' || m.songId === '') continue;
      // Map.set keeps an existing key's slot, so a delete first makes the re-ingested key newest.
      this.metadataCache.delete(m.songId);
      this.metadataCache.set(m.songId, m);
      batchSongIds.add(m.songId);
    }
    for (const songId of this.metadataCache.keys()) {
      if (this.metadataCache.size <= FILENAME_CACHE_LIMIT) break;
      if (!this.liveSongIds.has(songId) && !batchSongIds.has(songId)) this.metadataCache.delete(songId);
    }
  }

  /** Uses mpv `stop`, since `playlist-clear` keeps the playing entry and its audio. */
  async clearQueue(): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      this.queueGeneration++;
      await this.requireIpc().command('stop');
      this.metadataCache.clear();
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Always replaces the entire queue, as Navidrome's web UI does, since an infinite stream among
   * finite tracks breaks skip, queue position and scrobbling.
   */
  async enqueueRadio(streamUrl: string, stationId: string): Promise<{ outputMissing: MissingAudioOutput | null }> {
    if (streamUrl.trim() === '') {
      throw new Error('enqueueRadio requires a non-empty stream URL');
    }
    await this.ensureRunning();
    const result = await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      this.queueGeneration++;
      const outputMissing = await this.checkAudioOutput(ipc);
      // Tagged before the load, so a poll never pairs the new stream with the prior station's tag.
      // Without the tag, the name falls back to the first saved station on the stream URL.
      await this.writeUserData(ipc, RADIO_STATION_TAG_PROPERTY, stationId);
      // Paused before the load, so the stream never plays on the null output.
      if (outputMissing !== null) await ipc.command('set_property', 'pause', true);
      await ipc.command('loadfile', streamUrl, 'replace');
      if (outputMissing === null) await ipc.command('set_property', 'pause', false);
      return { outputMissing };
    });
    this.emitStateChange({ kind: 'queue' });
    return result;
  }

  getRadioStationTag(): string | null {
    const tag = this.propertyCache.get(RADIO_STATION_TAG_PROPERTY);
    return typeof tag === 'string' && tag !== '' ? tag : null;
  }

  // Best effort, since mpv before 0.36 has no user-data property.
  private async writeUserData(ipc: MpvIpc, name: string, value: string | number | boolean): Promise<void> {
    try {
      await ipc.command('set_property', name, value);
    } catch (error) {
      logger.debug(`mpv ${name} not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // mpv answers an unset user-data key, and an mpv before 0.36 any user-data key, with a command
  // error. A dropped connection still rejects, so a reader never takes it for an unset key.
  private async readUserData(ipc: MpvIpc, name: string): Promise<unknown> {
    try {
      return await ipc.command('get_property', name);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('mpv command error')) return null;
      throw error;
    }
  }

  // Best effort, so a failed raise never fails a replace that already loaded. Read live, since the
  // observed value can lag another process's raise.
  private async raiseReplaceGeneration(ipc: MpvIpc): Promise<void> {
    let generation = 0;
    try {
      generation = await this.readGeneration(ipc);
    } catch (error) {
      logger.debug(`mpv ${REPLACE_GENERATION_PROPERTY} not read: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    await this.writeUserData(ipc, REPLACE_GENERATION_PROPERTY, generation + 1);
  }

  private async readGeneration(ipc: MpvIpc): Promise<number> {
    const generation = await this.readUserData(ipc, REPLACE_GENERATION_PROPERTY);
    return typeof generation === 'number' ? generation : 0;
  }

  /**
   * Live reads, since the observed values can lag a mark another process just wrote. The pending
   * mark is read first, since a replace raises the generation before it clears the pending mark.
   */
  async readReplaceMarks(): Promise<ReplaceMarks> {
    if (!this.isRunning()) return { generation: 0, pending: false };
    const ipc = this.requireIpc();
    const pending = await this.readUserData(ipc, REPLACE_PENDING_PROPERTY);
    const generation = await this.readGeneration(ipc);
    return { generation, pending: pending === true };
  }

  /** A live read of the generation alone. Zero when unset or when mpv is not attached. */
  async readReplaceGeneration(): Promise<number> {
    if (!this.isRunning()) return 0;
    return this.readGeneration(this.requireIpc());
  }

  /** Reads the live playlist, since the observed `playlist-count` can lag a load that just finished. */
  async hasRadioStream(): Promise<boolean> {
    if (!this.isRunning()) return false;
    return holdsRadioStream(await this.getQueue());
  }

  /** A live read, since the observed `pause` can lag a set_property sent just before. Null when unknown. */
  async readPaused(): Promise<boolean | null> {
    if (!this.isRunning()) return null;
    const paused = await this.requireIpc().command('get_property', 'pause');
    return typeof paused === 'boolean' ? paused : null;
  }

  getQueueGeneration(): number {
    return this.queueGeneration;
  }

  /**
   * The playing track keeps playing and moves to index 0, so the queue top shows what is audible.
   * The position is read fresh, since the observed `playlist-pos` can lag the shuffle.
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
   * The web remote's shuffle restarts from the top, while shuffleQueue keeps the playing track for
   * shuffle_play_queue.
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

  /** mpv tracks the play head by entry, not by index, so a move never changes what is playing. */
  async moveQueueEntry(from: number, to: number): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      await this.requireIpc().command('playlist-move', from, to);
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /** mpv starts the next entry when the current one is removed. */
  async removeQueueEntry(index: number): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      await this.requireIpc().command('playlist-remove', index);
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * The entry is checked and resolved inside the lock, since a track change or a move before it would
   * start or shift the entry. Returns false when the entry is gone or now names another song.
   * `refuseStarted` throws QueueEntryStartedError while the entry is current and not paused.
   * It never spawns, since a new mpv instance cannot hold the entry.
   */
  async removeQueueEntryById(entryId: number, options: { songId?: string; refuseStarted?: boolean } = {}): Promise<boolean> {
    await this.ensureAttached();
    if (!this.isRunning()) return false;
    const removed = await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      const playlist = await ipc.command('get_property', 'playlist');
      const items: unknown[] = Array.isArray(playlist) ? playlist : [];
      const index = items.findIndex((item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>)['id'] === entryId);
      if (index < 0) return false;
      const record = items[index] as Record<string, unknown>;
      const filename = typeof record['filename'] === 'string' ? record['filename'] : '';
      // A new mpv instance numbers its entries from 1 again, so the id can name another song.
      if (options.songId !== undefined && this.parseSongIdCached(filename, items.length) !== options.songId) return false;
      if (options.refuseStarted === true && record['current'] === true) {
        // An unknown pause state refuses, since removing a playing entry skips it.
        if (await ipc.command('get_property', 'pause') !== true) throw new QueueEntryStartedError(entryId);
      }
      await ipc.command('playlist-remove', index);
      return true;
    });
    if (removed) this.emitStateChange({ kind: 'queue' });
    return removed;
  }

  /** `force` stops playback on the last entry, where the default `weak` does nothing. */
  async next(): Promise<void> {
    await this.ensureRunning();
    await this.requireIpc().command('playlist-next', 'force');
  }

  /**
   * Restarts the track on the first entry, where `playlist-prev` does nothing and
   * `playlist-prev force` stops playback.
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
        // Only the transient transcode rejection clears on retry. Any other failure is
        // deterministic, so it rethrows at once.
        const retryable = err instanceof Error && /error running command/i.test(err.message);
        if (!retryable || attempt === SEEK_MAX_ATTEMPTS) throw err;
        logger.debug(`seek ${seconds} ${mode} attempt ${attempt}/${SEEK_MAX_ATTEMPTS} failed, retrying: ${err.message}`);
        await new Promise<void>((resolve) => setTimeout(resolve, SEEK_RETRY_DELAY_MS));
      }
    }
  }

  /**
   * mpv stops playback on an index past the end, so the tool layer checks the bound first. No queue
   * event is emitted, since mpv's `playlist-pos` event reaches subscribers.
   */
  async jumpToQueueEntry(index: number): Promise<{ outputMissing: MissingAudioOutput | null }> {
    await this.ensureRunning();
    const ipc = this.requireIpc();
    const outputMissing = await this.checkAudioOutput(ipc);
    // An idle mpv can hold pause=false, so the jump would start the track on the null output.
    if (outputMissing !== null) await ipc.command('set_property', 'pause', true);
    await ipc.command('set_property', 'playlist-pos', index);
    if (outputMissing === null) await ipc.command('set_property', 'pause', false);
    return { outputMissing };
  }

  /**
   * Live reads, since a cached property event can lag a loadfile sent just before. mpv reports -1
   * with no current entry.
   */
  async readQueueState(): Promise<{ position: number; count: number }> {
    const ipc = this.requireIpc();
    const position = await ipc.command('get_property', 'playlist-pos');
    const count = await ipc.command('get_property', 'playlist-count');
    return {
      position: typeof position === 'number' ? position : -1,
      count: typeof count === 'number' ? count : 0,
    };
  }

  getCachedProperty(name: string): unknown {
    return this.propertyCache.get(name);
  }

  /**
   * Events are not buffered, so a subscriber reads the getters for a baseline. A long-lived
   * subscriber, such as an SSE client, must call the returned unsubscribe to avoid a leak.
   */
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.push(handler);
    return () => {
      const idx = this.stateChangeHandlers.indexOf(handler);
      if (idx !== -1) this.stateChangeHandlers.splice(idx, 1);
    };
  }

  getStatus(): PlaybackStatus {
    if (!this.isRunning()) {
      return {
        engineRunning: false,
        mpvPath: this.mpvBinary,
        mpvVersion: null,
        volume: null,
        idle: null,
        audioDevice: null,
        audioOutputLost: null,
      };
    }
    const volume = this.propertyCache.get('volume');
    const idle = this.propertyCache.get('idle-active');
    const audioOutput = this.readCachedAudioOutput();
    return {
      engineRunning: true,
      mpvPath: this.mpvBinary,
      mpvVersion: this.mpvVersion,
      volume: typeof volume === 'number' ? volume : null,
      idle: typeof idle === 'boolean' ? idle : null,
      audioDevice: audioOutput.device,
      audioOutputLost: audioOutput.lost,
    };
  }

  /** Never spawns mpv. Without a running mpv the devices come from a headless probe of the binary. */
  async describeAudioDevices(): Promise<AudioDeviceReport> {
    await this.ensureAttached();
    if (this.isRunning()) {
      const live = await this.readLiveAudioOutput(this.requireIpc());
      return {
        selected: this.describeSelectedDevice(live.audioDevice, live.devices),
        output: typeof live.currentAo === 'string' ? live.currentAo : null,
        devices: live.devices,
        source: 'player',
      };
    }
    if (this.mpvBinary === null) {
      throw new Error(ErrorFormatter.configMissing('Playback', 'mpv binary'));
    }
    const devices = await probeAudioDevices(this.mpvBinary);
    const saved = this.readAudioDeviceSource();
    const target = saved === null ? null : resolveSavedDevice(saved, devices);
    const id = target?.id ?? AUTO_DEVICE_ID;
    const listedName = devices.find((device) => device.id === id)?.name;
    return {
      selected: { id, name: listedName ?? target?.name ?? null, connected: isDeviceConnected(id, devices) },
      output: null,
      devices,
      source: 'probe',
    };
  }

  /** Never spawns mpv, and returns false when none runs. The pause state stays as it is. */
  async selectAudioDevice(id: string): Promise<boolean> {
    await this.ensureAttached();
    if (!this.isRunning()) return false;
    const ipc = this.requireIpc();
    const live = await this.readLiveAudioOutput(ipc);
    if (live.audioDevice === id && live.currentAo === NULL_AUDIO_OUTPUT) {
      await this.reopenAudioOutput(ipc, id, live.devices);
      return true;
    }
    await ipc.command('set_property', 'audio-device', id);
    return true;
  }

  songIdForPath(path: string): string | null {
    return this.parseSongIdCached(path, 0);
  }

  /** Matches the path, not the configured origin, so songs loaded before a URL change parse. */
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

  /** Without `mpv-version`, it falls back to the client API version, or null if neither answers. */
  private async readMpvVersion(ipc: MpvIpc): Promise<string | null> {
    try {
      const property = await ipc.command('get_property', 'mpv-version');
      if (typeof property === 'string' && property !== '') {
        return property;
      }
    } catch {
      // Older mpv builds may lack the property.
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

  async broadcastMessage(args: string[]): Promise<void> {
    await this.requireIpc().command('script-message', ...args);
  }

  private requireIpc(): MpvIpc {
    if (this.ipc?.isConnected() !== true) {
      throw new Error('mpv IPC is not connected');
    }
    return this.ipc;
  }

  /** A throwing handler is skipped, so one dead SSE client cannot deny notifications to others. */
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

  /** mpv cannot compute auth, so salted-MD5 params ride in the URL, which omits the password. */
  private buildStreamUrl(songId: string): string {
    if (this.config === null) {
      throw new Error('PlaybackEngine has not been configured. Call configure(config) first.');
    }
    // `format=raw` serves the file with byte-range seeking. `maxBitRate` applies to a transcode.
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

  /** The stored lock swallows rejections, so one failed task does not poison the chain. */
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

  /** Concurrent callers share one attach, so no two connections each relay every event. */
  private attachExistingShared(): Promise<boolean> {
    this.attachPromise ??= this.tryAttachExisting().finally(() => {
      this.attachPromise = null;
    });
    return this.attachPromise;
  }

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

  /** A failed spawn kills its child, since a detached orphan mpv would hold the audio device. */
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
      await this.applySavedAudioDevice(ipc);
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
   * Primes the cache, since observe's initial emits can arrive after its replies. The change
   * handler registers before observe_property, so mpv's initial emit is the latest write.
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
      // Every track start, not only a pending one, since mpv disables a filter that fails a track.
      if (evt.event === 'start-file' && this.visualizerKeepsInSync) {
        const restarts = this.playbackRestarts;
        void this.queueVisualizerSync(ipc, { stillSafe: () => this.playbackRestarts === restarts });
      }
      const reason = typeof evt['reason'] === 'string' ? ` (${evt['reason']})` : '';
      logger.debug(`mpv event: ${evt.event}${reason}`);
    });
    ipc.onDisconnect(() => {
      // An orphaned connection must not detach the engine from the live one.
      logger.debug('mpv IPC disconnected. The engine will re-attach on the next call.');
      if (this.ipc === ipc) this.ipc = null;
    });

    for (const [, name] of [...OBSERVED_PROPERTIES, ...OPTIONAL_OBSERVED_PROPERTIES]) {
      try {
        const value = await ipc.command('get_property', name);
        this.propertyCache.set(name, value);
      } catch {
        // Some properties, such as duration with no file loaded, error out and stay unset.
      }
    }

    ipc.onPropertyChange((evt) => {
      this.propertyCache.set(evt.name, evt.data);
      this.emitStateChange({ kind: 'property', name: evt.name, data: evt.data });
      const playStateEvent = evt.name === 'pause' || evt.name === 'idle-active';
      const quietNow = playStateEvent && evt.data === true;
      if (quietNow && this.visualizerPending && this.visualizerKeepsInSync) void this.queueVisualizerSync(ipc, {});
      if (AUDIO_OUTPUT_PROPERTIES.has(evt.name)) this.onAudioOutputChange(ipc);
      if (evt.name === 'pause' && evt.data === false) this.lostOutputPause = null;
      if (playStateEvent && evt.data === false) void this.pauseOnStartOverLostOutput(ipc);
    });

    // mpv sends no property events before observe_property, so this precedes the new snapshot.
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

  // Safety is read when the sync runs, since the sync can wait in the chain after it is queued.
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
    // A track that started playing during the check gets the filter at the next track start.
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

  // The check ran the configured binary, and an mpv from another binary may lack filter support.
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
   * Written even for a device mpv does not list, so mpv opens the null output and never a different
   * speaker. A device re-registered under a new id is matched by name. An attach skips this, since
   * the spawning process applied it.
   */
  private async applySavedAudioDevice(ipc: MpvIpc): Promise<void> {
    const saved = this.readAudioDeviceSource();
    if (saved === null) return;
    try {
      const deviceList: unknown = await ipc.command('get_property', 'audio-device-list').catch(() => null);
      const target = resolveSavedDevice(saved, parseAudioDeviceList(deviceList));
      await ipc.command('set_property', 'audio-device', target.id);
      if (target.id !== saved.id) this.storeReplacementDevice(saved.id, { id: target.id, name: target.name ?? saved.id });
    } catch (err) {
      logger.warn(`audio device ${saved.id} not applied: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Every attached engine runs this. Each write it makes repeats harmlessly from a second engine.
  private onAudioOutputChange(ipc: MpvIpc): void {
    const values = this.readCachedAudioOutputValues();
    const id = selectedDeviceId(values.audioDevice);
    const connected = isDeviceConnected(id, values.devices);
    const returned = connected && !this.selectedDeviceWasConnected;
    this.selectedDeviceWasConnected = connected;
    if (connected) this.rememberListedSelection(id, values.devices);

    const replacement = connected ? null : this.findReplacement(id, values.devices);
    if (replacement !== null) {
      void this.adoptReplacementDevice(ipc, id, replacement);
      return;
    }
    this.pauseOnLostOutput(ipc, values);
    if (returned) void this.recoverReturnedOutput(ipc, id);
  }

  private pauseOnLostOutput(ipc: MpvIpc, values: AudioOutputValues): void {
    const lost = isAudioOutputLost(values);
    const newlyLost = lost && !this.audioOutputWasLost;
    this.audioOutputWasLost = lost;
    if (newlyLost) {
      const device = this.describeSelectedDevice(values.audioDevice, values.devices);
      logger.info(`Audio output lost on device ${device.name ?? device.id}`);
    }
    if (!lost || this.isIdleOrPaused()) return;
    this.lostOutputPause = { at: Date.now(), deviceId: selectedDeviceId(values.audioDevice) };
    void ipc.command('set_property', 'pause', true).catch((err: unknown) => {
      logger.debug(`pause on lost audio output failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** A twin that left the list before the selected device did is still a different output. */
  private rememberListedSelection(id: string, devices: readonly AudioDevice[]): void {
    const device = devices.find((candidate) => candidate.id === id);
    if (id === AUTO_DEVICE_ID || device === undefined) return;
    const earlier = this.lastListedSelection?.device.id === id ? this.lastListedSelection.listedBeside : [];
    const listedBeside = new Set([...earlier, ...devices.map((candidate) => candidate.id)]);
    this.lastListedSelection = { device, listedBeside };
  }

  private findReplacement(id: string, devices: readonly AudioDevice[]): AudioDevice | null {
    if (id === AUTO_DEVICE_ID) return null;
    const last = this.lastListedSelection?.device.id === id ? this.lastListedSelection : null;
    const name = last?.device.name ?? this.savedDeviceName(id);
    if (name === null) return null;
    return findReplacementDevice({ id, name }, devices, last?.listedBeside ?? new Set());
  }

  /**
   * The pause moves to the new id before the write, so the write's own event can resume it. A failed
   * write leaves the lost device selected, so it gets the pause a plain loss gets.
   */
  private async adoptReplacementDevice(ipc: MpvIpc, lostId: string, replacement: AudioDevice): Promise<void> {
    if (this.replacingDeviceId === replacement.id) return;
    this.replacingDeviceId = replacement.id;
    logger.info(`Audio device ${replacement.name} moved from ${lostId} to ${replacement.id}`);
    if (this.lostOutputPause?.deviceId === lostId) this.lostOutputPause.deviceId = replacement.id;
    try {
      await ipc.command('set_property', 'audio-device', replacement.id);
      this.storeReplacementDevice(lostId, replacement);
    } catch (err) {
      logger.warn(`audio device ${replacement.id} not adopted: ${err instanceof Error ? err.message : String(err)}`);
      if (this.lostOutputPause?.deviceId === replacement.id) this.lostOutputPause.deviceId = lostId;
      this.pauseOnLostOutput(ipc, this.readCachedAudioOutputValues());
    } finally {
      this.replacingDeviceId = null;
    }
  }

  /** Only a saved choice is updated, so a device picked while no store exists stays unsaved. */
  private storeReplacementDevice(lostId: string, replacement: AudioDevice): void {
    if (this.readAudioDeviceSource()?.id !== lostId) return;
    if (!this.saveAudioDevice(replacement)) {
      logger.warn(`audio device ${replacement.name} moved to ${replacement.id}, but the new id was not saved`);
    }
  }

  /**
   * mpv keeps a returned device on its null output until the output is re-opened. Playback resumes
   * only when this engine paused for that device moments ago, since a longer outage may be on purpose.
   */
  private async recoverReturnedOutput(ipc: MpvIpc, id: string): Promise<void> {
    const pause = this.lostOutputPause;
    this.lostOutputPause = null;
    const resume = pause !== null && pause.deviceId === id && Date.now() - pause.at <= AUDIO_OUTPUT_RESUME_WINDOW_MS;
    try {
      const missing = await this.checkAudioOutput(ipc);
      if (missing === null && resume) await ipc.command('set_property', 'pause', false);
    } catch (err) {
      logger.debug(`returned audio output not recovered: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * A loss while paused raised no pause, and mpv sends no new output event when playback starts.
   * The live read keeps a stale cached `null` output from pausing an output a re-open restored.
   */
  private async pauseOnStartOverLostOutput(ipc: MpvIpc): Promise<void> {
    if (this.isIdleOrPaused() || !isAudioOutputLost(this.readCachedAudioOutputValues())) return;
    try {
      const live = await this.readLiveAudioOutput(ipc);
      if (!isAudioOutputLost(live)) return;
      await ipc.command('set_property', 'pause', true);
    } catch (err) {
      logger.debug(`pause on a start over a lost audio output failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private readCachedAudioOutput(): { device: SelectedAudioDevice; lost: boolean } {
    const cached = this.readCachedAudioOutputValues();
    return { device: this.describeSelectedDevice(cached.audioDevice, cached.devices), lost: isAudioOutputLost(cached) };
  }

  private readCachedAudioOutputValues(): AudioOutputValues {
    return {
      audioDevice: this.propertyCache.get('audio-device'),
      devices: parseAudioDeviceList(this.propertyCache.get('audio-device-list')),
      currentAo: this.propertyCache.get('current-ao'),
    };
  }

  /** A rejected `current-ao` read means no output is open, which is not a loss. */
  private async readLiveAudioOutput(ipc: MpvIpc): Promise<AudioOutputValues> {
    const audioDevice = await ipc.command('get_property', 'audio-device');
    const deviceList = await ipc.command('get_property', 'audio-device-list');
    const currentAo = await ipc.command('get_property', 'current-ao').catch(() => null);
    return { audioDevice, devices: parseAudioDeviceList(deviceList), currentAo };
  }

  /** Reads live values, since the cache can lag a device change. */
  private async checkAudioOutput(ipc: MpvIpc): Promise<MissingAudioOutput | null> {
    const live = await this.readLiveAudioOutput(ipc);
    const id = selectedDeviceId(live.audioDevice);
    if (!isDeviceConnected(id, live.devices)) return { id, name: this.savedDeviceName(id) };
    if (live.currentAo !== NULL_AUDIO_OUTPUT) return null;
    const reopened = await this.reopenAudioOutput(ipc, id, live.devices);
    return reopened ? null : { id, name: this.savedDeviceName(id) };
  }

  /**
   * mpv ignores a write of the value it holds, so a named device is re-opened through `auto`. No
   * documented write re-opens `auto` itself, so it takes `ao-reload`.
   */
  private async reopenAudioOutput(ipc: MpvIpc, id: string, devices: readonly AudioDevice[]): Promise<boolean> {
    const isAuto = id === AUTO_DEVICE_ID;
    if (isAuto && !devices.some((device) => device.id !== AUTO_DEVICE_ID)) return false;
    try {
      if (isAuto) {
        await ipc.command('ao-reload');
      } else {
        await ipc.command('set_property', 'audio-device', AUTO_DEVICE_ID);
        await ipc.command('set_property', 'audio-device', id);
      }
      return true;
    } catch (err) {
      logger.debug(`audio output ${id} not re-opened: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  // The source is read only for an unlisted device, since it can read the settings file and
  // getStatus runs on every status poll.
  private describeSelectedDevice(audioDevice: unknown, devices: readonly AudioDevice[]): SelectedAudioDevice {
    const id = selectedDeviceId(audioDevice);
    const listed = devices.find((device) => device.id === id);
    const name = listed !== undefined ? listed.name : this.savedDeviceName(id);
    return { id, name, connected: isDeviceConnected(id, devices) };
  }

  private savedDeviceName(id: string): string | null {
    const saved = this.readAudioDeviceSource();
    return saved !== null && saved.id === id ? saved.name : null;
  }

  private readAudioDeviceSource(): Config['playbackAudioDevice'] {
    try {
      return this.audioDeviceSource();
    } catch (err) {
      logger.debug(`audio device setting unreadable, treating it as none: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * A spawn still connecting is killed directly, since waiting for it can outlast the caller's exit
   * and leave its detached child running.
   */
  async quitMpv(): Promise<void> {
    this.shuttingDown = true;
    try { this.pendingSpawn?.kill('SIGTERM'); } catch { /* already exited */ }
    await quitMpvViaSocket(this.ipcPath);
    this.shutdown();
  }

  /**
   * Leaves mpv running, so playback persists across restarts. Subscribers are dropped and must
   * subscribe again.
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
    this.audioOutputWasLost = false;
    this.selectedDeviceWasConnected = true;
    this.lastListedSelection = null;
    this.replacingDeviceId = null;
    this.lostOutputPause = null;
    this.stateChangeHandlers.length = 0;
  }
}

function selectedDeviceId(audioDevice: unknown): string {
  return typeof audioDevice === 'string' ? audioDevice : AUTO_DEVICE_ID;
}

/** `auto` counts as connected, since mpv then opens whatever output the OS offers. */
function isDeviceConnected(id: string, devices: readonly AudioDevice[]): boolean {
  return id === AUTO_DEVICE_ID || devices.some((device) => device.id === id);
}

function isAudioOutputLost(values: AudioOutputValues): boolean {
  return values.currentAo === NULL_AUDIO_OUTPUT || !isDeviceConnected(selectedDeviceId(values.audioDevice), values.devices);
}

/**
 * mpv accepts concurrent IPC clients, so this one-shot connection works beside a live engine
 * connection or after it closed.
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
 * Resolves true when a live listener holds the path. Unlinking that socket would orphan its mpv on
 * the audio device while a new spawn starts a second player.
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
