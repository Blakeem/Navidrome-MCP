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

import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { ErrorFormatter } from '../../utils/error-formatter.js';
import { MpvIpc } from './mpv-ipc.js';
import { getDefaultIpcPath, spawnMpv } from './mpv-process.js';

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
 */
export interface PlaylistEntry {
  index: number;
  songId: string | null;
  filename: string;
  title?: string;
  isCurrent: boolean;
  isPlaying: boolean;
}

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
  async enqueue(songIds: readonly string[], mode: 'replace' | 'append'): Promise<void> {
    if (songIds.length === 0) {
      throw new Error('enqueue requires at least one song ID');
    }
    await this.ensureRunning();
    const ipc = this.requireIpc();

    if (mode === 'replace') {
      // Issue an explicit playlist-clear before loading. `loadfile ... replace`
      // would clear implicitly, but doing it up-front guarantees the prior
      // queue is wiped even if the first loadfile fails.
      await ipc.command('playlist-clear');
      const [first, ...rest] = songIds;
      if (first === undefined) {
        throw new Error('enqueue requires at least one song ID');
      }
      await ipc.command('loadfile', this.buildStreamUrl(first), 'replace');
      for (const id of rest) {
        await ipc.command('loadfile', this.buildStreamUrl(id), 'append');
      }
      await ipc.command('set_property', 'pause', false);
    } else {
      // Append-only: do NOT clear the playlist; do NOT unpause. Respect the
      // existing pause state so an append while paused keeps the queue paused.
      for (const id of songIds) {
        await ipc.command('loadfile', this.buildStreamUrl(id), 'append');
      }
    }
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

    const raw = await this.requireIpc().command('get_property', 'playlist');
    if (!Array.isArray(raw)) return [];

    const entries: PlaylistEntry[] = [];
    for (let index = 0; index < raw.length; index++) {
      const item = raw[index];
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;

      const filename = typeof record['filename'] === 'string' ? record['filename'] : '';
      const isCurrent = record['current'] === true;
      const isPlaying = record['playing'] === true;
      const titleRaw = record['title'];
      const title = typeof titleRaw === 'string' && titleRaw !== '' ? titleRaw : undefined;

      let songId: string | null = null;
      if (filename !== '') {
        try {
          songId = new URL(filename).searchParams.get('id');
        } catch {
          // Filename isn't a parseable URL (e.g. a local path); leave songId null.
          songId = null;
        }
      }

      const entry: PlaylistEntry = {
        index,
        songId,
        filename,
        isCurrent,
        isPlaying,
      };
      if (title !== undefined) entry.title = title;
      entries.push(entry);
    }
    return entries;
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
    await this.requireIpc().command('stop');
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
    const ipc = this.requireIpc();
    await ipc.command('playlist-shuffle');
    const count = this.getCachedProperty('playlist-count');
    if (typeof count === 'number' && count > 0) {
      await ipc.command('set_property', 'playlist-pos', 0);
    }
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
    const ipc = this.requireIpc();
    await ipc.command('playlist-move', from, to);
    if (from === 0 || to === 0) {
      await ipc.command('set_property', 'playlist-pos', 0);
    }
  }

  /**
   * Remove the playlist entry at the given index. mpv natively handles the
   * "currently-playing" case by auto-advancing to the next track — no
   * special tool-side logic needed.
   */
  async removePlaylistEntry(index: number): Promise<void> {
    await this.ensureRunning();
    await this.requireIpc().command('playlist-remove', index);
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
    await this.requireIpc().command('seek', seconds, mode);
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

  private requireIpc(): MpvIpc {
    if (this.ipc?.isConnected() !== true) {
      throw new Error('mpv IPC is not connected');
    }
    return this.ipc;
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
    const params = new URLSearchParams({
      id: songId,
      format: this.config.playbackTranscodeFormat,
      maxBitRate: this.config.playbackTranscodeBitrate,
      u: this.config.navidromeUsername,
      p: this.config.navidromePassword,
      v: '1.16.1',
      c: 'navidrome-mcp',
      f: 'json',
    });
    // Trim a single trailing slash so we don't end up with `//rest/stream`.
    const base = this.config.navidromeUrl.replace(/\/+$/, '');
    return `${base}/rest/stream?${params.toString()}`;
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
      // Verify mpv is actually responsive on this socket
      const versionRaw = await Promise.race([
        ipc.command('get_version'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('get_version timeout')), 500)),
      ]);
      this.mpvVersion = versionRaw === null || versionRaw === undefined
        ? null
        : String(versionRaw);

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
   * fully rolled back. We don't retain a child reference — the spawn is
   * detached + unref'd; the IPC socket is the only handle we use.
   */
  private async spawnAndConnect(): Promise<void> {
    let ipc: MpvIpc | null = null;
    try {
      if (this.mpvBinary === null) {
        throw new Error(ErrorFormatter.configMissing('Playback', 'mpv binary'));
      }
      const child = spawnMpv(this.mpvBinary, this.ipcPath);
      // We don't track this handle — if mpv exits unexpectedly the IPC
      // 'close' event will fire and trigger our recovery path.
      child.on('exit', (code, signal) => {
        if (!this.shuttingDown) {
          logger.warn(`mpv exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        }
      });

      ipc = new MpvIpc();
      await ipc.connect(this.ipcPath);

      // Fetch the mpv version once for status reporting
      try {
        const version = await ipc.command('get_version');
        if (version !== null && version !== undefined) {
          this.mpvVersion = String(version);
        }
      } catch (err) {
        logger.debug('Failed to read mpv version:', err);
      }

      await this.installObservers(ipc);

      this.ipc = ipc;
    } catch (err) {
      // Roll back partial state on failure. We do NOT kill the child even on
      // rollback — if the spawn succeeded but observe failed, the next call
      // will attach to it instead of leaving it orphaned + spawning another.
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
   */
  private async installObservers(ipc: MpvIpc): Promise<void> {
    for (const [id, name] of OBSERVED_PROPERTIES) {
      await ipc.observeProperty(id, name);
    }

    ipc.onPropertyChange((evt) => {
      this.propertyCache.set(evt.name, evt.data);
    });
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

    // Prime the cache with current values so consumers see populated state
    // immediately after startup/attach without waiting for changes.
    for (const [, name] of OBSERVED_PROPERTIES) {
      try {
        const value = await ipc.command('get_property', name);
        this.propertyCache.set(name, value);
      } catch {
        // Some properties (e.g. duration with no file loaded) error out;
        // leave them unset.
      }
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
      const code = signal === 'SIGINT' ? 130 : 143;
      process.exit(code);
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    // No 'exit' handler kills mpv — by design, mpv outlives the MCP server.
  }

  /**
   * Disconnect IPC from mpv. Does NOT kill the mpv process — mpv is intended
   * to outlive the MCP server so playback persists across restarts. Use
   * `pkill mpv` (or a future `stop_playback` tool) if you actually want to
   * stop the audio.
   *
   * Idempotent.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const ipc = this.ipc;
    if (ipc?.isConnected() === true) {
      try { ipc.close(); } catch { /* noop */ }
    }

    this.ipc = null;
    this.mpvVersion = null;
    this.propertyCache.clear();
    this.startPromise = null;

    // Allow restarting after an explicit shutdown
    this.shuttingDown = false;
  }
}

async function cleanupStaleSocket(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    if (existsSync(path)) {
      await unlink(path);
    }
  } catch {
    // Best-effort; mpv will fail to bind if it's actually busy and the user
    // will see a real error then.
  }
}

export const playbackEngine = PlaybackEngine.getInstance();
