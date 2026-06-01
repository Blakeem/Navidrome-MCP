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
import { MPV_STALE_SOCKET_PROBE_MS } from '../../constants/timeouts.js';
import { sanitizeFilename } from '../../utils/sanitize-url.js';
import { buildSubsonicAuthParams } from '../../utils/subsonic-auth.js';
import { MpvIpc } from './mpv-ipc.js';
import { getDefaultIpcPath, spawnMpv } from './mpv-process.js';

/**
 * Soft upper bound for the per-engine `filenameCache` (used by `getPlaylist`
 * to avoid re-parsing the same Subsonic stream URLs on every poll). When the
 * cache reaches this size, the oldest entries are evicted FIFO. 4096 covers
 * even very large Navidrome libraries played in a single session without
 * thrashing — and at ~100 bytes/entry stays well under 1MB.
 */
const FILENAME_CACHE_LIMIT = 4096;

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
];

// Seek robustness. On a transcoded HTTP stream, mpv can intermittently reject a
// seek ("error running command") when the demuxer/cache is momentarily settling
// after prior transport churn (skips, pauses, earlier seeks). The seek is
// otherwise valid — a brief wait + retry of the *same* command clears it,
// without touching mpv's clock (so scrobble/now-playing position bookkeeping is
// unaffected). Raw streams are fully seekable and never hit this path.
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
 * `songId` is parsed out of the stream URL's `id` query parameter when the
 * filename is one of our Subsonic stream URLs (see `buildStreamUrl`). It is
 * `null` if the URL doesn't parse or doesn't carry an `id` — e.g. when
 * something else has loaded a track into mpv via the shared IPC socket.
 *
 * `filename` is the (sanitized) stream URL that was loaded into mpv. It is
 * retained on the internal entry shape so the engine can answer questions
 * like `hasRadioStream`, but it is stripped from the LLM-facing
 * `get_play_queue` response — internal mpv plumbing has no business in the
 * model's context window, and even sanitized URLs leak LAN topology.
 *
 * `title`/`artist`/`album`/`duration` come from one of two sources:
 *   1. mpv's own metadata (only for tracks it has loaded — current + recent).
 *   2. The engine's per-session metadata cache, populated by `enqueue` from
 *      the song DTOs the tool layer already has on hand. This makes
 *      future-queue tracks reportable too.
 */
export interface PlaylistEntry {
  index: number;
  songId: string | null;
  filename: string;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  isCurrent: boolean;
  isPlaying: boolean;
}

/**
 * Track metadata the tool layer passes to the engine at enqueue time so the
 * engine can answer `get_play_queue` with full titles/artists for every
 * queue entry — not just the currently-playing one. mpv only loads metadata
 * for tracks it touches, so without this cache future-queue entries surface
 * as bare song IDs.
 */
export interface QueueTrackMetadata {
  songId: string;
  title?: string;
  artist?: string;
  album?: string;
  /** Duration in seconds; matches mpv's own `duration` units. */
  duration?: number;
}

/**
 * Engine state-change event delivered to subscribers of `onStateChange`.
 *
 * `kind === 'property'` is forwarded from mpv's own observe-property stream;
 * `name` is the mpv property (`pause`, `volume`, `time-pos`, `playlist-pos`,
 * `playlist-count`, `duration`, `media-title`, `metadata`, `idle-active`,
 * `eof-reached`) and `data` is the new value (unknown JSON shape).
 *
 * `kind === 'queue'` fires after a queue-mutating IPC sequence completes
 * (enqueue/clear/shuffle/move/remove/enqueueRadio). It carries no payload —
 * subscribers are expected to re-read state from the public getters.
 */
export type StateChangeEvent =
  | { kind: 'property'; name: string; data: unknown }
  | { kind: 'queue' };

type StateChangeHandler = (event: StateChangeEvent) => void;

/**
 * Singleton playback engine wrapping mpv.
 *
 * Lifecycle:
 *   - The engine is constructed in `not-running` state at module load time.
 *   - `ensureRunning()` lazy-spawns mpv on first call, connects IPC, observes
 *     the standard property set, fetches the mpv version, and registers
 *     shutdown handlers.
 *   - Subsequent `ensureRunning()` calls are no-ops while the engine is alive.
 *   - On SIGINT/SIGTERM/exit, mpv is asked to quit via IPC, then SIGTERM/SIGKILL
 *     escalates if it does not exit promptly.
 *
 * Thread safety: Node is single-threaded; concurrent `ensureRunning()` calls
 * are coalesced via a stored start promise.
 */
class PlaybackEngine {
  private static instance: PlaybackEngine | null = null;

  private config: Config | null = null;
  private mpvBinary: string | null = null;
  private ipcPath: string = getDefaultIpcPath();
  // We deliberately do not retain a ChildProcess reference. mpv is spawned
  // detached + unref'd so it outlives the MCP server, and we never kill it
  // from here — the IPC connection is the only handle we need.
  private ipc: MpvIpc | null = null;
  private startPromise: Promise<void> | null = null;
  private mpvVersion: string | null = null;
  private signalsRegistered = false;
  private shuttingDown = false;
  private readonly propertyCache = new Map<string, unknown>();
  // Tracks the currently-loaded radio station so `now_playing` can surface
  // the human-readable name. Set by `enqueueRadio`; cleared by any operation
  // that replaces the queue with songs (`enqueue`) or empties it
  // (`clearPlaylist`). Session-scoped — does not survive MCP restart, but
  // an attached MCP can derive `isRadio` from `getPlaylist()` entries whose
  // `songId` is null.
  private currentRadioStation: { name: string } | null = null;
  // Serializes mutating queue operations (enqueue, enqueueRadio, clear,
  // shuffle, move, remove). Without this, two concurrent play_* calls
  // interleave their IPC commands and can violate the radio/songs
  // mutual-exclusion invariant — e.g. play_songs racing play_radio_station
  // can leave a hybrid queue. Reads bypass the lock; mpv's own atomicity
  // covers single-command operations.
  private mutationLock: Promise<unknown> = Promise.resolve();
  // Per-session cache of filename → songId (or null when no id is present).
  // getPlaylist() is hot — called by now_playing/get_play_queue which an LLM
  // may poll many times per minute, with 100+ entries each. Re-parsing every
  // filename through `new URL()` is wasteful, and the parser cost grows with
  // URL length. mpv playlist filenames are stable for the queue's lifetime,
  // so caching the parsed result is safe. Capped at FILENAME_CACHE_LIMIT
  // entries to bound memory; if a user churns through that many distinct
  // tracks in one session, we re-parse — still O(1) amortized.
  private readonly filenameCache = new Map<string, string | null>();
  // Per-session metadata cache keyed by songId. Populated by `enqueue` when
  // the tool layer hands us song DTOs alongside the IDs, so `getPlaylist()`
  // can report title/artist/album/duration for every queue entry — not just
  // the one mpv is currently spinning. Cleared on full replace and on
  // shutdown; entries are NOT evicted when an item is removed from the queue
  // (the cost of a stale entry is just bytes — there's no correctness hazard
  // and the next enqueue overwrites it). Cap mirrors FILENAME_CACHE_LIMIT.
  private readonly metadataCache = new Map<string, QueueTrackMetadata>();
  // Subscribers that want to know when engine-observable state changes. Two
  // kinds of events fan out here: `'property'` events relay mpv's own
  // property-change notifications (volume, pause, time-pos, playlist-pos,
  // etc.); `'queue'` events fire after a queue-mutating IPC sequence completes
  // (enqueue, clear, shuffle, move, remove, enqueueRadio) because mpv's own
  // property events don't always cover the full set of changes a mutation
  // produces. Subscribers should treat the payload as advisory and re-derive
  // any state they care about from the public getters. See `onStateChange`.
  private readonly stateChangeHandlers: Array<StateChangeHandler> = [];

  private constructor() {}

  static getInstance(): PlaybackEngine {
    PlaybackEngine.instance ??= new PlaybackEngine();
    return PlaybackEngine.instance;
  }

  /**
   * Configure the engine with the loaded application config. Must be called
   * once at startup before any tool invocation. Idempotent — subsequent
   * calls overwrite the config reference.
   */
  configure(config: Config): void {
    this.config = config;
    this.mpvBinary = config.mpvPath ?? null;
  }

  /**
   * Whether the engine has a live IPC connection to mpv. The presence of a
   * `child` reference is intentionally NOT required here — when we've
   * attached to an existing mpv (e.g. one spawned by a prior MCP server),
   * `child` is null but the engine is fully operational via IPC.
   */
  isRunning(): boolean {
    return this.ipc?.isConnected() === true;
  }

  /**
   * Whether mpv is actively playing audio, derived purely from the cached
   * observed properties (no IPC round-trip, no lazy spawn). A best-effort
   * snapshot biased toward "playing" — NOT a general truth source for other
   * features. (Formerly fed the idle reaper, which has since been removed; the
   * web owner now unconditionally quits mpv on shutdown — spec §B.1.)
   *
   * Predicate: a live IPC connection AND `playlist-count > 0` AND
   * `pause === false` AND `idle-active !== true` AND not end-of-file.
   *
   * **Biased toward "keep playing."** Each property is treated as "playing"
   * unless it definitively says otherwise (`=== true` / `!== false`), so any
   * not-yet-known value (`undefined` before `installObservers` primes it, or a
   * transient gap) keeps mpv alive rather than risking killing a playing one.
   * Consequently a radio stream (playlist-count === 1, never EOF) reads as
   * perpetually playing — intended; such mpv instances are never auto-killed.
   */
  isPlaying(): boolean {
    if (!this.isRunning()) return false;
    const count = this.propertyCache.get('playlist-count');
    if (typeof count !== 'number' || count <= 0) return false;
    if (this.propertyCache.get('pause') !== false) return false;
    if (this.propertyCache.get('idle-active') === true) return false;
    if (this.propertyCache.get('eof-reached') === true) return false;
    return true;
  }

  /**
   * Path to the mpv binary the engine will use, or null if unconfigured.
   */
  getMpvPath(): string | null {
    return this.mpvBinary;
  }

  /**
   * Try to attach to an already-running mpv via the well-known IPC socket,
   * but do NOT spawn a new one if attach fails. Used by read-only tools
   * (`now_playing`, `playback_status`) so they can recover after an MCP
   * restart without taking on the cost of spawning mpv themselves.
   *
   * Resolves silently in all cases — caller checks `isRunning()` afterwards.
   */
  async ensureAttached(): Promise<void> {
    if (this.isRunning()) return;
    if (this.config === null) return;
    this.ipcPath = getDefaultIpcPath();
    await this.tryAttachExisting();
  }

  /**
   * Lazy-connect to mpv: first try to attach to an already-running mpv via
   * the well-known IPC socket (e.g. one spawned by a previous MCP server
   * that has since exited), then fall back to spawning a fresh mpv if
   * nothing's there. Returns once IPC is connected and baseline property
   * observation is in place. Concurrent callers share the same start promise.
   */
  async ensureRunning(): Promise<void> {
    if (this.isRunning()) return;

    this.startPromise ??= this.startOrAttach();
    try {
      await this.startPromise;
    } finally {
      // Clear the promise reference once it has settled, so a future spawn
      // attempt (after a crash, say) is not blocked by a stale promise.
      if (!this.isRunning()) {
        this.startPromise = null;
      }
    }
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
    this.propertyCache.set('volume', clamped);
    return clamped;
  }

  /**
   * Load the given ordered list of song stream URLs into mpv's playlist.
   *
   * - `mode='replace'`: clear the existing playlist, replace with the new
   *   tracks (first via `loadfile <url> replace`, remaining via `append`),
   *   and unpause so playback starts immediately.
   * - `mode='append'`: append each new track to the existing playlist via
   *   `loadfile <url> append`. Does NOT clear the queue and does NOT unpause —
   *   existing playback state (including pause) is preserved.
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

      // Radio mutual exclusion: a radio stream and songs cannot coexist in the
      // queue — radio is infinite and breaks queue semantics. If the queue
      // currently holds a radio stream, any append is demoted to replace so
      // the radio is cleanly evicted before songs load. Logged at WARN AND
      // returned to the caller so the LLM can tell its requested mode wasn't
      // honored without us echoing the input mode (which would lie when
      // demotion happens).
      let effectiveMode = mode;
      let demoted = false;
      if (effectiveMode === 'append' && await this.hasRadioStream()) {
        logger.warn('enqueue: append demoted to replace because queue contains a radio stream');
        effectiveMode = 'replace';
        demoted = true;
      }

      // Loading songs always evicts any radio context; clear the station name
      // so `now_playing` doesn't show a stale radio header.
      this.currentRadioStation = null;

      if (effectiveMode === 'replace') {
        // Replace-mode is a multi-command sequence (clear → loadfile* → unpause)
        // and not atomic on mpv's side. If any loadfile mid-sequence fails
        // (network blip, mpv ENOMEM, transcoder hiccup), the prior queue is
        // already gone and we'd leave the user with a half-loaded queue and
        // no signal to the LLM that "queue cleared, load failed". Recovery:
        // on any failure after the initial clear, issue `stop` so we land
        // in a clean idle state (empty queue, no playback) and surface a
        // structured error mentioning the partial-state recovery — better
        // than letting `now_playing` show one paused track that contradicts
        // the failure response.
        const [first, ...rest] = songIds;
        if (first === undefined) {
          throw new Error('enqueue requires at least one song ID');
        }
        // Replace wipes any prior metadata — the previous queue's titles are
        // no longer reachable and shouldn't bleed into the new queue's view.
        this.metadataCache.clear();
        this.ingestMetadata(metadata);
        // Issue an explicit playlist-clear before loading. `loadfile ... replace`
        // would clear implicitly, but doing it up-front guarantees the prior
        // queue is wiped even if the first loadfile fails.
        await ipc.command('playlist-clear');
        try {
          await ipc.command('loadfile', this.buildStreamUrl(first), 'replace');
          for (const id of rest) {
            await ipc.command('loadfile', this.buildStreamUrl(id), 'append');
          }
          await ipc.command('set_property', 'pause', false);
        } catch (err) {
          // Land in a clean idle state so subsequent reads aren't lying
          // about a half-loaded queue. `stop` only halts playback — it does
          // NOT clear the playlist — so we must issue `playlist-clear`
          // first to make the "queue cleared and is now empty" error
          // message below actually true. Both calls are best-effort: if
          // the IPC connection is itself dead, the next ensureRunning()
          // will re-attach and mpv will resync state on its own.
          try {
            await ipc.command('playlist-clear');
          } catch {
            // Connection is gone; the cache-zero below + next attach handle it.
          }
          try {
            await ipc.command('stop');
          } catch {
            // Connection is gone; tearing down further is the IPC layer's job.
          }
          this.currentRadioStation = null;
          // Proactively zero the cached counts so a `now_playing` call between
          // this throw and mpv's async property-change event for `playlist-count`
          // doesn't report a stale non-zero queue length. mpv will overwrite
          // these via the change event shortly with the same values.
          this.propertyCache.set('playlist-count', 0);
          this.propertyCache.set('playlist-pos', null);
          // Re-throwing exits withMutationLock before the success-path
          // `emitStateChange` below runs, so subscribers (e.g. the SSE web-UI)
          // would never learn the queue was just cleared. Emit the same queue
          // event the success path emits, AFTER the clear/stop/cache-zero and
          // BEFORE re-throwing, so the cleared state is broadcast even on failure.
          this.emitStateChange({ kind: 'queue' });
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`enqueue failed mid-sequence; queue was cleared and is now empty: ${reason}`);
        }
      } else {
        // Append-only: do NOT clear the playlist; do NOT unpause. Respect the
        // existing pause state so an append while paused keeps the queue paused.
        // Merge the new batch's metadata over any prior entries — duplicates
        // are overwritten with the freshest values from the caller.
        this.ingestMetadata(metadata);
        for (const id of songIds) {
          await ipc.command('loadfile', this.buildStreamUrl(id), 'append');
        }
      }

      return { demoted };
    });
    this.emitStateChange({ kind: 'queue' });
    return result;
  }

  /**
   * Read the live mpv playlist as a normalized array of `PlaylistEntry`.
   *
   * Read-method semantics: uses `ensureAttached()` (does NOT spawn mpv).
   * If no mpv is running/attachable, returns `[]` so callers see an empty
   * queue rather than spawning a fresh, empty mpv. SongId extraction
   * tolerates URLs we didn't build ourselves (parse failures yield
   * `songId: null` rather than throwing — someone could have loaded a
   * file path or non-stream URL via the shared IPC socket).
   */
  async getPlaylist(): Promise<PlaylistEntry[]> {
    await this.ensureAttached();
    if (!this.isRunning()) return [];

    const rawResult = await this.requireIpc().command('get_property', 'playlist');
    if (!Array.isArray(rawResult)) return [];
    const raw: unknown[] = rawResult;

    const entries: PlaylistEntry[] = [];
    for (let index = 0; index < raw.length; index++) {
      const item = raw[index];
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;

      const filename = typeof record['filename'] === 'string' ? record['filename'] : '';
      const isCurrent = record['current'] === true;
      const isPlaying = record['playing'] === true;
      const titleRaw = record['title'];
      const mpvTitle = typeof titleRaw === 'string' && titleRaw !== '' ? titleRaw : undefined;

      const songId = filename === '' ? null : this.parseSongIdCached(filename);

      // Merge engine-side metadata (populated by `enqueue` from song DTOs) on
      // top of mpv's own bookkeeping. mpv only knows about tracks it has
      // touched — current + recent. Our cache covers the rest of the queue
      // so an LLM polling `get_play_queue` sees titles all the way down the
      // line, not just for the actively-playing entry. mpv wins where it has
      // a value (it sees ICY updates for radio, dynamic title changes, etc.);
      // our cache fills in everything mpv left blank.
      const cached = songId !== null ? this.metadataCache.get(songId) : undefined;

      const entry: PlaylistEntry = {
        index,
        songId,
        // Strip Subsonic auth params (u/p/s/t) before exposing the URL via
        // get_play_queue — we don't want any credential-shaped data in the
        // LLM transcript.
        filename: sanitizeFilename(filename),
        isCurrent,
        isPlaying,
      };
      const resolvedTitle = mpvTitle ?? cached?.title;
      if (resolvedTitle !== undefined && resolvedTitle !== '') entry.title = resolvedTitle;
      if (cached?.artist !== undefined && cached.artist !== '') entry.artist = cached.artist;
      if (cached?.album !== undefined && cached.album !== '') entry.album = cached.album;
      if (cached?.duration !== undefined && cached.duration > 0) entry.duration = cached.duration;
      entries.push(entry);
    }
    return entries;
  }

  /**
   * Public ingress for filling the metadata cache after engine
   * construction — used by `get_play_queue` to back-fill entries the engine
   * never saw (post-MCP-restart attach, or radio entries with no `songId`
   * to key by but with a freshly-fetched DTO). Internally delegates to the
   * same `ingestMetadata` path the enqueue methods use, so cap and overwrite
   * semantics are identical.
   */
  ingestQueueMetadata(metadata: ReadonlyArray<QueueTrackMetadata>): void {
    this.ingestMetadata(metadata);
  }

  /**
   * Merge a batch of caller-supplied track metadata into the per-session cache.
   * Entries missing `songId` are skipped (no key to index by). Existing keys
   * are overwritten with the freshest values — re-enqueueing a track with
   * updated metadata wins.
   */
  private ingestMetadata(metadata: ReadonlyArray<QueueTrackMetadata> | undefined): void {
    if (metadata === undefined || metadata.length === 0) return;
    for (const m of metadata) {
      if (typeof m.songId !== 'string' || m.songId === '') continue;
      this.metadataCache.set(m.songId, m);
    }
    // Bound the cache so a long-running session that churns through tracks
    // doesn't grow unbounded. Cap mirrors filenameCache.
    while (this.metadataCache.size > FILENAME_CACHE_LIMIT) {
      const oldest = this.metadataCache.keys().next().value;
      if (oldest === undefined) break;
      this.metadataCache.delete(oldest);
    }
  }

  /**
   * Clear the live playlist AND halt playback. Uses mpv `stop`, not
   * `playlist-clear`: `playlist-clear` removes everything *except* the
   * currently-playing track, so audio keeps coming out of the speakers.
   * `stop` empties the queue and silences output, which is what users
   * expect from a "clear" verb. Idempotent — safe when idle.
   */
  async clearPlaylist(): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      await this.requireIpc().command('stop');
      this.currentRadioStation = null;
      this.metadataCache.clear();
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Replace the live queue with a single radio stream and start playback.
   *
   * Radio is mutually exclusive with songs/albums: an mpv playlist that
   * mixes a (potentially infinite) radio stream with finite tracks behaves
   * unintuitively (skip/next semantics, queue position, scrobbling). Per
   * Navidrome's web UI convention, calling this method always replaces the
   * entire queue — regardless of what was previously loaded.
   *
   * `loadfile <url> replace` natively clobbers any prior queue contents,
   * so we don't need an explicit `playlist-clear` first.
   *
   * The optional `stationName` is stored on the engine so `now_playing`
   * can surface a human-readable header. If the MCP server restarts while
   * a radio stream is playing, the new server attaches to the running mpv
   * but the station name is lost — callers can derive `isRadio` from
   * `getPlaylist()` entries whose `songId` is null.
   */
  async enqueueRadio(streamUrl: string, stationName?: string): Promise<void> {
    if (streamUrl.trim() === '') {
      throw new Error('enqueueRadio requires a non-empty stream URL');
    }
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      await ipc.command('loadfile', streamUrl, 'replace');
      await ipc.command('set_property', 'pause', false);
      this.currentRadioStation = stationName !== undefined && stationName !== ''
        ? { name: stationName }
        : null;
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Whether the live queue currently contains a radio stream — defined as
   * any entry whose stream URL doesn't carry a Navidrome song `id`. Used
   * by `enqueue` to enforce the radio/songs mutual-exclusion rule.
   *
   * Returns false when the engine isn't running OR the queue is empty
   * (avoiding an unnecessary IPC roundtrip via the cached `playlist-count`).
   */
  async hasRadioStream(): Promise<boolean> {
    if (!this.isRunning()) return false;
    const count = this.getCachedProperty('playlist-count');
    if (typeof count !== 'number' || count === 0) return false;
    const playlist = await this.getPlaylist();
    return playlist.some(entry => entry.songId === null);
  }

  /**
   * Returns the human-readable name of the currently-loaded radio station,
   * or null if no radio is playing OR if the engine attached to a running
   * mpv where the station name was set in a previous MCP session (the
   * name is session-scoped; the URL is recoverable via `getPlaylist()`).
   */
  getCurrentRadioStation(): { name: string } | null {
    return this.currentRadioStation;
  }

  /**
   * Randomize the order of items in the live playlist via mpv's native
   * `playlist-shuffle` command. Atomic on mpv's side. Lazy-spawns mpv.
   *
   * Active-queue behavior: after the shuffle, the play head is reset to
   * index 0 so the new top of queue starts playing. Without this, mpv's
   * default keeps the previously-current track playing wherever it landed
   * in the new order, which contradicts the "active queue" model where the
   * queue's top reflects what's audibly playing. Setting `playlist-pos`
   * preserves any existing pause state — paused stays paused.
   */
  async shufflePlaylist(): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      await ipc.command('playlist-shuffle');
      const count = this.getCachedProperty('playlist-count');
      if (typeof count === 'number' && count > 0) {
        await ipc.command('set_property', 'playlist-pos', 0);
      }
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Move the playlist entry at `from` so it takes the place of `to`.
   * Index bounds are NOT validated client-side — mpv errors on out-of-range
   * indices and the message surfaces via `ErrorFormatter.toolExecution`.
   * Avoids races with concurrent queue mutations.
   *
   * Active-queue behavior: when the move involves index 0 (either source
   * or destination), the play head is reset to index 0 afterwards so the
   * new top-of-queue starts playing. This covers two user expectations:
   * moving a track TO the front should start playing it, and moving the
   * currently-playing track FROM the front should make the new front
   * track play. Other moves leave playback alone (lazy is fine when the
   * top of queue isn't affected). Pause state is preserved.
   */
  async movePlaylistEntry(from: number, to: number): Promise<void> {
    await this.ensureRunning();
    await this.withMutationLock(async () => {
      const ipc = this.requireIpc();
      await ipc.command('playlist-move', from, to);
      if (from === 0 || to === 0) {
        await ipc.command('set_property', 'playlist-pos', 0);
      }
    });
    this.emitStateChange({ kind: 'queue' });
  }

  /**
   * Remove the playlist entry at the given index. mpv natively handles the
   * "currently-playing" case by auto-advancing to the next track — no
   * special tool-side logic needed.
   */
  async removePlaylistEntry(index: number): Promise<void> {
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
   * Skip to the previous track in mpv's playlist. Uses the `force` flag.
   * Lazy-spawns mpv if necessary.
   */
  async previous(): Promise<void> {
    await this.ensureRunning();
    await this.requireIpc().command('playlist-prev', 'force');
  }

  /**
   * Seek within the current track. `mode` selects between absolute (jump to
   * given second within the track) and relative (offset from current
   * position; negative seeks backwards). Lazy-spawns mpv if necessary.
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
        // Only the transient transcode-stream rejection ("error running command")
        // is worth retrying — a brief wait + retry of the same command clears it
        // without touching mpv's clock. Anything else (closed socket, command
        // timeout, invalid args) is deterministic: rethrow at once rather than
        // burning the remaining attempts (and their delays) on a failure that
        // won't clear. The final attempt also rethrows, so the tool surfaces a
        // clean error (graceful degradation).
        const retryable = err instanceof Error && /error running command/i.test(err.message);
        if (!retryable || attempt === SEEK_MAX_ATTEMPTS) throw err;
        logger.debug(`seek ${seconds} ${mode} attempt ${attempt}/${SEEK_MAX_ATTEMPTS} failed, retrying: ${err.message}`);
        await new Promise<void>((resolve) => setTimeout(resolve, SEEK_RETRY_DELAY_MS));
      }
    }
  }

  /**
   * Jump the play head to the play-queue entry at `index`. Companion to
   * `next` / `previous` for non-adjacent navigation — equivalent to
   * clicking a row in a media player's queue. Queue contents are NOT
   * mutated; only the play position changes.
   *
   * Implicitly unpauses because the action signals "play this now" — a
   * paused engine that silently stays paused after a jump is consistently
   * the wrong behavior in every other media player I've seen. Mirrors the
   * unpause in `enqueue(replace)`.
   *
   * Out-of-range indices surface as mpv errors via the IPC layer; we don't
   * pre-validate (avoids a race with concurrent mutations that change the
   * length). Same approach as `movePlaylistEntry` / `removePlaylistEntry`.
   *
   * No explicit `emitStateChange` — mpv's own property-change event for
   * `playlist-pos` is already wired through the observer and will fan out
   * to subscribers on its own.
   */
  async jumpToPlaylistEntry(index: number): Promise<void> {
    await this.ensureRunning();
    const ipc = this.requireIpc();
    await ipc.command('set_property', 'playlist-pos', index);
    await ipc.command('set_property', 'pause', false);
  }

  /**
   * Read a property from the engine's local observed-property cache. Returns
   * `undefined` if the property has never been observed (or its value has
   * not yet changed from mpv's initial state — `idle-active` notably does
   * not emit until something actually plays).
   */
  getCachedProperty(name: string): unknown {
    return this.propertyCache.get(name);
  }

  /**
   * Register a subscriber for engine state-change events (mpv property
   * updates + queue mutations). Returns an unsubscribe function — callers
   * should invoke it on shutdown or when they no longer care, to avoid a
   * handler leak across long-running connections (e.g. SSE clients).
   *
   * Handlers are invoked synchronously in registration order; a throwing
   * handler is logged and skipped so it cannot deny notifications to others.
   * The engine does not buffer events: only changes that occur after the
   * subscription is in place are delivered. Callers that need a baseline
   * snapshot should read it via the public getters immediately after
   * subscribing.
   */
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.push(handler);
    return () => {
      const idx = this.stateChangeHandlers.indexOf(handler);
      if (idx !== -1) this.stateChangeHandlers.splice(idx, 1);
    };
  }

  /**
   * Read engine status. Does NOT trigger lazy spawn — if the engine has not
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

  // ---------- internals ----------

  /**
   * Parse the Navidrome song id out of a stream URL, with per-session caching.
   * Cheap prefilter avoids `new URL()` for non-HTTP filenames (local paths,
   * raw radio URLs without a query string) — `new URL()` is the only step
   * here that can be expensive on pathological input.
   */
  private parseSongIdCached(filename: string): string | null {
    const cached = this.filenameCache.get(filename);
    if (cached !== undefined) return cached;

    let songId: string | null = null;
    // Cheap prefilter: only attempt to parse as URL if the filename looks
    // URL-shaped. Non-URL filenames (local paths, raw radio URLs without
    // an `id` query param) all resolve to null; no need to construct URL.
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
      const idIdx = filename.indexOf('id=');
      if (idIdx !== -1) {
        try {
          songId = new URL(filename).searchParams.get('id');
        } catch {
          songId = null;
        }
      }
    }

    if (this.filenameCache.size >= FILENAME_CACHE_LIMIT) {
      // FIFO eviction: drop the oldest entry. Map preserves insertion order,
      // so .keys().next() yields the oldest. Cheap enough at our cap that we
      // don't need an LRU.
      const oldest = this.filenameCache.keys().next().value;
      if (oldest !== undefined) this.filenameCache.delete(oldest);
    }
    this.filenameCache.set(filename, songId);
    return songId;
  }

  /**
   * Read mpv's human-readable release version via the `mpv-version` property
   * (string, e.g. "mpv 0.39.0"). Falls back to decoding the integer
   * `get_version` command output when the property read fails or returns a
   * non-string: that command returns the *client API* version as
   * `(major << 16) | (minor << 8) | patch` packed in an int, which is not
   * the mpv release but is at least more readable than the raw number.
   *
   * Returns null if neither source is available — callers leave the field
   * unset rather than surfacing a bogus value.
   */
  private async readMpvVersion(ipc: MpvIpc): Promise<string | null> {
    try {
      const property = await ipc.command('get_property', 'mpv-version');
      if (typeof property === 'string' && property !== '') {
        return property;
      }
    } catch {
      // Property may not exist on older mpv builds; fall through to fallback.
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
      // ignore — no version available
    }
    return null;
  }

  private requireIpc(): MpvIpc {
    if (this.ipc?.isConnected() !== true) {
      throw new Error('mpv IPC is not connected');
    }
    return this.ipc;
  }

  /**
   * Dispatch a state-change event to every registered subscriber, isolating
   * each handler from the others. A handler that throws is logged and
   * skipped — the engine must not silently lose notifications because a
   * single misbehaving listener (e.g. a dead SSE client mid-flush) raised.
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
    // Subsonic salted-MD5 auth (s=/t=) — never plaintext password (p=). The
    // URL is handed to mpv, which loads it; mpv has no auth-computation
    // capability so credentials of some shape have to be in the URL. The
    // salted form means leaked URLs (access logs, etc.) cannot recover the
    // password, and getPlaylist() further sanitizes the URL before exposing
    // it to the LLM via get_play_queue.
    // `format=raw` streams the original file untouched — best quality and, more
    // importantly, fully byte-range seekable (mpv can jump anywhere). A real
    // transcode (mp3/opus/...) is generated on demand and seeks less reliably,
    // so it's opt-in for bandwidth-constrained setups. `maxBitRate` only applies
    // when transcoding, so we omit it for raw to keep the URL honest.
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
    // Trim a single trailing slash so we don't end up with `//rest/stream`.
    const base = this.config.navidromeUrl.replace(/\/+$/, '');
    return `${base}/rest/stream?${params.toString()}`;
  }

  /**
   * Run a mutating queue operation under the engine-wide mutation lock so
   * concurrent callers serialize cleanly. The lock is a promise queue: the
   * next task chains off the previous task's settle (success or failure).
   * Failures don't poison the chain — `.catch(() => undefined)` ensures the
   * stored lock resolves even if `fn` rejected.
   */
  private withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationLock.then(fn, fn);
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

    // Try to attach to a running mpv (spawned by a previous MCP server, or
    // sharing the well-known socket). This is what makes playback persist
    // across MCP restarts.
    if (await this.tryAttachExisting()) {
      logger.info(`Playback engine attached to existing mpv (ipc=${this.ipcPath})`);
      this.registerSignalHandlers();
      return;
    }

    // No reachable mpv on the well-known socket — spawn a fresh one.
    await cleanupStaleSocket(this.ipcPath);
    await this.spawnAndConnect();
    this.registerSignalHandlers();
    logger.info(`Playback engine started (mpv ${this.mpvVersion ?? '?'}, ipc=${this.ipcPath})`);
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
      // Short retry budget — if it's there, it answers fast; if it's a stale
      // socket file with no listener, we don't want to wait the full 5s.
      await ipc.connect(this.ipcPath, 3, 50);
      // Verify mpv is actually responsive on this socket AND read the
      // human-readable mpv release version (e.g. "mpv 0.39.0"). The
      // `mpv-version` *property* is a string; `get_version` is a different
      // command that returns the integer-encoded client-API version (e.g.
      // 131077 = 0x20005) which is meaningless to end users. The per-command
      // timeout inside MpvIpc.command() bounds the call.
      this.mpvVersion = await this.readMpvVersion(ipc);

      await this.installObservers(ipc);
      this.ipc = ipc;
      return true;
    } catch (err) {
      logger.debug(`Could not attach to existing mpv at ${this.ipcPath}: ${err instanceof Error ? err.message : String(err)}`);
      try { ipc.close(); } catch { /* noop */ }
      return false;
    }
  }

  /**
   * Spawn a fresh mpv child, connect IPC, install observers and event
   * handlers. Used only when attach fails. Throws on any failure with state
   * fully rolled back AND the spawned child killed — earlier versions left
   * the child running on rollback "in case the next call attaches", but in
   * practice that leaks an orphan idle mpv per failed spawn (it accumulates
   * over uptime and holds the audio device).
   */
  private async spawnAndConnect(): Promise<void> {
    if (this.mpvBinary === null) {
      throw new Error(ErrorFormatter.configMissing('Playback', 'mpv binary'));
    }

    let ipc: MpvIpc | null = null;
    let expectedExit = false;
    const child: ChildProcess = spawnMpv(this.mpvBinary, this.ipcPath);

    // The exit handler suppresses its "unexpected" warning when we deliberately
    // killed the child during rollback (expectedExit === true).
    child.on('exit', (code, signal) => {
      if (!this.shuttingDown && !expectedExit) {
        logger.warn(`mpv exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      }
    });

    try {
      ipc = new MpvIpc();
      await ipc.connect(this.ipcPath);

      // Fetch the mpv release version (e.g. "mpv 0.39.0") for status
      // reporting. Uses the `mpv-version` string property — NOT `get_version`,
      // which returns the integer client-API version (0x20005 etc.) that is
      // meaningless to end users.
      try {
        this.mpvVersion = await this.readMpvVersion(ipc);
      } catch (err) {
        logger.debug('Failed to read mpv version:', err);
      }

      await this.installObservers(ipc);

      this.ipc = ipc;
      // Success: leave the child detached + unref'd as designed; the IPC
      // connection is the only liveness handle from here on.
    } catch (err) {
      // Rollback path: kill the spawned child so we don't leak an orphan.
      // SIGTERM is sufficient — mpv handles it cleanly; if a future bug shows
      // it isn't enough, escalate to SIGKILL.
      expectedExit = true;
      try { child.kill('SIGTERM'); } catch { /* already exited */ }
      if (ipc !== null) {
        try { ipc.close(); } catch { /* noop */ }
      }
      this.ipc = null;
      this.mpvVersion = null;
      this.propertyCache.clear();
      throw err;
    }
  }

  /**
   * Install property observers, event handlers, and disconnect recovery on
   * the given IPC client. Also primes the property cache by reading current
   * values for each observed property — this is necessary because mpv only
   * emits property-change events when values *change* from the prior state,
   * so values that already match mpv's startup state would never populate.
   *
   * Ordering is load-bearing:
   *   1. PRIME the cache via `get_property` for each observed property.
   *   2. REGISTER the property-change handler.
   *   3. SUBSCRIBE via `observe_property`.
   *
   * If we subscribed first, mpv would start emitting change events
   * immediately — and any event arriving between subscribe and the prime
   * read for the same property would be overwritten by the (potentially
   * staler) get_property response. Doing prime → handler → subscribe means
   * the very first observe-triggered change event (mpv emits the current
   * value once on subscribe) is the freshest write into the cache, which is
   * the desired outcome.
   */
  private async installObservers(ipc: MpvIpc): Promise<void> {
    // Always-on event/disconnect handlers — set up first so we don't miss
    // events that fire during the prime/observe sequence.
    ipc.onEvent((evt) => {
      const reason = typeof evt['reason'] === 'string' ? ` (${evt['reason']})` : '';
      logger.debug(`mpv event: ${evt.event}${reason}`);
    });
    ipc.onDisconnect(() => {
      // Peer dropped the IPC socket but mpv may still be alive (orphan from a
      // prior run, kernel quirk, etc.). Clear our handle; the next call to
      // ensureRunning() will try tryAttachExisting() again and likely succeed.
      logger.debug('mpv IPC disconnected; engine will attempt re-attach on next call');
      this.ipc = null;
    });

    // 1. Prime the cache with current values FIRST. This is the snapshot
    //    that consumers see if they read before any property has changed.
    for (const [, name] of OBSERVED_PROPERTIES) {
      try {
        const value = await ipc.command('get_property', name);
        this.propertyCache.set(name, value);
      } catch {
        // Some properties (e.g. duration with no file loaded) error out;
        // leave them unset.
      }
    }

    // 2. Register the property-change handler BEFORE subscribing — otherwise
    //    the immediate change event mpv emits on observe would be lost.
    ipc.onPropertyChange((evt) => {
      this.propertyCache.set(evt.name, evt.data);
      this.emitStateChange({ kind: 'property', name: evt.name, data: evt.data });
    });

    // 3. Subscribe last. mpv emits a change event with the current value
    //    immediately after observe_property is acked; that overrides any
    //    stale prime value with mpv's freshest reading.
    for (const [id, name] of OBSERVED_PROPERTIES) {
      await ipc.observeProperty(id, name);
    }
  }

  private registerSignalHandlers(): void {
    if (this.signalsRegistered) return;
    this.signalsRegistered = true;

    const onSignal = (signal: NodeJS.Signals): void => {
      logger.debug(`Playback engine received ${signal}, releasing mpv (process kept alive)`);
      // Disconnect from mpv but DO NOT kill it. mpv has been spawned detached
      // and unref'd; it will keep playing across MCP restart, and the next
      // MCP server will attach to it via the well-known socket.
      this.shuttingDown = true;
      if (this.ipc !== null) {
        try { this.ipc.close(); } catch { /* noop */ }
      }
      this.ipc = null;
      // Set exitCode and let the event loop drain naturally — calling
      // process.exit() here truncates the MCP stdio transport (which is
      // line-buffered JSON-RPC), so the host loses the last response and
      // any final logger output. With the IPC socket closed and mpv
      // unref'd the loop should empty within milliseconds.
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
      // Release the stdin hold the MCP transport keeps for JSON-RPC reads.
      // Without this the loop stays alive until the host closes stdin (or
      // SIGKILLs us after a multi-second grace period), which makes Ctrl+C
      // in dev hang. unref() leaves the transport intact for any in-flight
      // response write while telling the loop "don't wait on stdin."
      try { process.stdin.unref(); } catch { /* noop */ }
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    // No 'exit' handler kills mpv — by design, mpv outlives the MCP server.
  }

  /**
   * Quit the mpv PROCESS itself (not just our IPC socket), then tear down our
   * IPC state. Used by the web port owner's shutdown and the MCP-only exit path
   * (standalone-web spec §B.1). Distinct from `shutdown()`, which closes our
   * connection but leaves mpv running — here we WANT mpv gone.
   *
   * Sends `quit` over a **one-shot connection** to the well-known socket rather
   * than reusing `this.ipc`. mpv accepts multiple concurrent IPC clients, and
   * critically this still works when our live connection was already torn down
   * by the engine's own release-on-signal handler (which can run before us when
   * both fire on the same SIGINT/SIGTERM). Bounded + best-effort: a no-op if
   * nothing is listening (mpv already gone / never started).
   */
  async quitMpv(): Promise<void> {
    await quitMpvViaSocket(this.ipcPath);
    this.shutdown();
  }

  /**
   * Disconnect our IPC from mpv and reset all engine session state (cache,
   * subscribers, version). Does NOT kill the mpv PROCESS — mpv is intended to
   * outlive the MCP server so playback persists across restarts. Contrast with
   * {@link quitMpv}, which sends `quit` to actually stop the audio before
   * tearing down our connection.
   *
   * Idempotent; the engine can be restarted after an explicit shutdown.
   */
  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const ipc = this.ipc;
    if (ipc?.isConnected() === true) {
      try { ipc.close(); } catch { /* noop */ }
    }

    this.ipc = null;
    this.mpvVersion = null;
    this.propertyCache.clear();
    this.filenameCache.clear();
    this.metadataCache.clear();
    this.currentRadioStation = null;
    this.startPromise = null;
    // Drop subscribers — they would point at handlers from the prior session
    // that have no business firing after a process-level restart-equivalent.
    this.stateChangeHandlers.length = 0;

    // Allow restarting after an explicit shutdown
    this.shuttingDown = false;
  }
}

/**
 * Send mpv `quit` over a one-shot connection to its IPC socket, independent of
 * the engine's own (possibly already-closed) connection. mpv accepts multiple
 * concurrent IPC clients, so this works alongside a live engine connection and
 * still delivers when that connection was torn down by the release-on-signal
 * handler. Bounded (~1s) and best-effort: resolves quietly when nothing is
 * listening (mpv already gone / never started). Works for both the unix socket
 * (POSIX) and the named pipe (Windows) that `getDefaultIpcPath()` returns.
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
    }, 1000);
    timer.unref();
    sock.once('error', () => { clearTimeout(timer); done(); });
    sock.once('close', () => { clearTimeout(timer); done(); });
    sock.once('connect', () => {
      // `end()` flushes the command then half-closes; mpv reads `quit` and exits.
      try { sock.end('{ "command": ["quit"] }\n'); } catch { /* noop */ }
    });
  });
}

/**
 * Probe-first stale-socket cleanup. The previous implementation blindly
 * unlinked the socket file whenever it existed — but `tryAttachExisting()`
 * can return false for transient reasons (slow get_version, scheduling
 * pause) while a live mpv is still bound. Unlinking under a live mpv on
 * Linux is a no-op for the binding but means the next spawn fails with
 * EADDRINUSE. So we probe first: try a one-shot connect with a short
 * timeout; only unlink if no one is listening.
 */
async function cleanupStaleSocket(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  if (!existsSync(path)) return;

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

  if (someoneListening) return;
  try {
    await unlink(path);
  } catch {
    // Best-effort; mpv will fail to bind if the file is somehow still busy
    // and the user will see a real error then.
  }
}

export const playbackEngine = PlaybackEngine.getInstance();
