/**
 * Navidrome MCP Server - Scrobble Tracker
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { randomUUID } from 'node:crypto';

import { SCROBBLE_CLAIM_ECHO_TIMEOUT_MS } from '../../constants/timeouts.js';
import { logger } from '../../utils/logger.js';
import type { StateChangeEvent } from './playback-engine.js';
import type { RetryPolicy } from '../../utils/fetch-with-timeout.js';

// Last.fm counts a play of a track 30s or longer after half its duration or 4 minutes, whichever
// comes first.
const MIN_DURATION_SECONDS = 30;
const MAX_THRESHOLD_SECONDS = 240;

/** The script-message topic for a claim. Its args are the play key and the claimant id. */
const SCROBBLE_CLAIM_TOPIC = 'navidrome-mcp-scrobble-claim';

interface ScrobbleQueueEntry {
  index: number;
  songId: string | null;
  entryId?: number;
  isCurrent?: boolean;
  duration?: number;
}

/** Lets tests pass a minimal fake instead of constructing the full playback engine. */
export interface ScrobbleEngine {
  onStateChange(handler: (event: StateChangeEvent) => void): () => void;
  getQueue(): Promise<ScrobbleQueueEntry[]>;
  getCachedProperty(name: string): unknown;
  broadcastMessage(args: string[]): Promise<void>;
}

export interface ScrobbleClient {
  subsonicRequest(
    endpoint: string,
    params?: Record<string, string>,
    options?: { retryPolicy?: RetryPolicy },
  ): Promise<unknown>;
}

/**
 * Every process attached to one mpv runs a tracker. mpv delivers every claim to every client in
 * one order, so the first claim for a play wins and one process submits it.
 */
export class ScrobbleTracker {
  private readonly client: ScrobbleClient;
  private readonly engine: ScrobbleEngine;
  private readonly onTrackStart: () => Promise<void>;
  private readonly claimantId = randomUUID();
  private unsubscribe: (() => void) | null = null;

  private currentSongId: string | null = null;
  private currentEntryId: number | null = null;
  private currentDuration: number | null = null;
  private startedAtMs: number | null = null;
  private submitted = false;
  // The first claimant seen for the current play, this process included.
  private firstClaimant: string | null = null;
  private claimSent = false;
  // Fails the claim open when mpv never echoes it, since a lost scrobble is worse than a double.
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  // Tracked per play instead of read from the engine cache, so the previous track's time-pos never
  // reaches the new play's threshold check before the new file's first time-pos event.
  private lastTimePos: number | null = null;
  // Set on a playlist-pos or path change until a playlist read names the playing entry, so the new
  // file's time-pos never counts toward the displaced play.
  private transitionPending = false;
  // The file playing at attach, while the play adopted for it lasts.
  private inheritedPath: string | null = null;

  private lastPlaylistPos: number | null | 'unknown' = 'unknown';
  // Undefined until the first path event after attach, which is mpv's observe snapshot.
  private lastPath: string | null | undefined = undefined;
  // Bumped per attach and detach, so an in-flight adoption never lands on a later instance.
  private attachEpoch = 0;

  // Bumped on every real transition, so a read resolving after a newer one is dropped.
  private generation = 0;

  /**
   * @param onTrackStart Runs once per tracked play without gating it. The MCP injects a web-port
   *   probe that keeps the owner lease alive.
   */
  constructor(
    client: ScrobbleClient,
    engine: ScrobbleEngine,
    onTrackStart: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.client = client;
    this.engine = engine;
    this.onTrackStart = onTrackStart;
  }

  attach(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.engine.onStateChange((event) => {
      this.handleEvent(event);
    });
  }

  /** Test isolation only, since a production tracker lives as long as its process. */
  detach(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.reset();
    // Attach-lifetime state resets too, so a detach then attach starts clean.
    this.lastPlaylistPos = 'unknown';
    this.lastPath = undefined;
    this.attachEpoch++;
    this.generation = 0;
  }

  private handleEvent(event: StateChangeEvent): void {
    if (event.kind === 'attach') {
      this.onEngineAttach();
      return;
    }
    if (event.kind === 'queue') {
      this.onQueueMutation();
      return;
    }
    if (event.kind === 'message') {
      this.onMessage(event.args);
      return;
    }
    if (event.kind === 'visualizer') return;
    switch (event.name) {
      case 'playlist-pos':
        this.onPlaylistPos(event.data);
        return;
      case 'path':
        this.onPath(event.data);
        return;
      case 'duration':
        this.onDuration(event.data);
        return;
      case 'time-pos':
        this.onTimePos(event.data);
        return;
      default:
        return;
    }
  }

  /**
   * A new mpv instance restarts entry ids and replays its state as fresh emits,
   * so the previous instance's play ends here and is not counted by this process.
   */
  private onEngineAttach(): void {
    this.reset();
    this.lastPlaylistPos = 'unknown';
    this.lastPath = undefined;
    this.attachEpoch++;
    // Orphans playlist reads begun against the previous instance.
    this.generation++;
  }

  private onPlaylistPos(data: unknown): void {
    const next = typeof data === 'number' ? data : null;
    const prev = this.lastPlaylistPos;
    this.lastPlaylistPos = next;
    // The first event since attach is mpv's observe snapshot. The play it names
    // may already be scrobbled by the previous owner, so it is adopted, not started.
    if (prev === 'unknown') {
      // The engine primes path before this snapshot, so the cache names the file playing at attach.
      const snapshotPath = this.engine.getCachedProperty('path');
      if (next !== null && next >= 0 && typeof snapshotPath === 'string') void this.adoptInFlightPlay(snapshotPath);
      return;
    }
    // A same-value emit is not a track change, so the current play continues.
    if (prev === next) return;
    if (next === null || next < 0) {
      this.reset();
      return;
    }
    this.transitionPending = true;
    void this.hydrateAndStart(next, ++this.generation);
  }

  /**
   * Records the in-flight play as submitted, so a later queue edit confirms it instead of counting
   * it again. The attach-time file is its identity, since this read can land after a move or swap.
   */
  private async adoptInFlightPlay(snapshotPath: string): Promise<void> {
    const epoch = this.attachEpoch;
    let playlist: ScrobbleQueueEntry[];
    try {
      playlist = await this.engine.getQueue();
    } catch (err) {
      logger.warn(`scrobble: failed to read playlist to adopt the in-flight play: ${String(err)}`);
      return;
    }
    if (epoch !== this.attachEpoch || this.currentSongId !== null) return;
    // A replaced file makes the current entry a new play, which the transition path starts.
    if (this.engine.getCachedProperty('path') !== snapshotPath) return;
    const entry = playlist.find((e) => e.isCurrent === true);
    if (typeof entry?.songId !== 'string') return;
    this.currentSongId = entry.songId;
    this.currentEntryId = entry.entryId ?? null;
    this.inheritedPath = snapshotPath;
    this.submitted = true;
  }

  /**
   * Path is the only signal for a new file at the same index or from another process. mpv reports
   * path before duration, so the pending flag keeps the new file's events off the displaced play.
   */
  private onPath(data: unknown): void {
    const next = typeof data === 'string' ? data : null;
    const prev = this.lastPath;
    this.lastPath = next;
    const leftInheritedFile = this.inheritedPath !== null && next !== this.inheritedPath;
    if (!leftInheritedFile && (prev === undefined || prev === next)) return;
    // The adoption read can show the entry that replaced the inherited file, so that play ends.
    if (leftInheritedFile) this.reset();
    this.transitionPending = true;
    void this.maybeRehydrateAfterQueue();
  }

  private onQueueMutation(): void {
    // mpv emits no playlist-pos event when the index stays the same, such as a replace at index 0.
    void this.maybeRehydrateAfterQueue();
  }

  private async maybeRehydrateAfterQueue(): Promise<void> {
    const gen = ++this.generation;
    const cachedPos = this.engine.getCachedProperty('playlist-pos');
    if (typeof cachedPos !== 'number' || cachedPos < 0) {
      this.reset();
      this.lastPlaylistPos = typeof cachedPos === 'number' ? cachedPos : null;
      return;
    }
    let entry: ScrobbleQueueEntry | undefined;
    try {
      const playlist = await this.engine.getQueue();
      if (gen !== this.generation) return;
      // The playlist-pos cache can lag the mutation that just finished, so mpv's
      // current flag from this same read names the playing entry when present.
      entry = playlist.find((e) => e.isCurrent === true) ?? playlist.find((e) => e.index === cachedPos);
    } catch (err) {
      logger.warn(`scrobble: failed to read playlist after queue mutation: ${String(err)}`);
      // A pending file change leaves the playing file unknown and ends the play.
      // A plain queue edit keeps it.
      if (gen === this.generation && this.transitionPending) this.reset();
      return;
    }
    if (entry === undefined) {
      this.reset();
      return;
    }
    if (this.isSamePlay(entry)) {
      this.confirmSamePlay();
      return;
    }
    this.reset();
    this.lastPlaylistPos = entry.index;
    if (entry.songId === null) return;
    this.startTrackingTrack(entry.songId, entry.entryId, entry.duration);
  }

  private async hydrateAndStart(pos: number, gen: number): Promise<void> {
    let entry: ScrobbleQueueEntry | undefined;
    try {
      const playlist = await this.engine.getQueue();
      if (gen !== this.generation) return;
      entry = playlist.find((e) => e.index === pos);
    } catch (err) {
      logger.warn(`scrobble: failed to read playlist for pos=${pos}: ${String(err)}`);
      if (gen === this.generation) this.reset();
      return;
    }
    if (entry !== undefined && this.isSamePlay(entry)) {
      this.confirmSamePlay();
      return;
    }
    this.reset();
    if (entry === undefined) return;
    if (entry.songId === null) return;
    this.startTrackingTrack(entry.songId, entry.entryId, entry.duration);
  }

  /**
   * mpv's entry id survives an index shift. Without one, songId is the only identity, so a
   * back-to-back replay of one song counts once.
   */
  private isSamePlay(entry: ScrobbleQueueEntry): boolean {
    if (this.currentSongId === null) return false;
    if (entry.entryId !== undefined && this.currentEntryId !== null) {
      return entry.entryId === this.currentEntryId;
    }
    return entry.songId === this.currentSongId;
  }

  private confirmSamePlay(): void {
    this.transitionPending = false;
    this.maybeSubmit(this.lastTimePos);
  }

  private startTrackingTrack(songId: string, entryId: number | undefined, duration: number | undefined): void {
    this.currentSongId = songId;
    this.currentEntryId = entryId ?? null;
    this.startedAtMs = Date.now();
    this.submitted = false;
    this.lastTimePos = null;
    this.currentDuration = null;
    void this.runTrackStartHook();
    if (typeof duration === 'number' && duration > 0) {
      this.currentDuration = duration;
    } else {
      // After an MCP restart the metadata cache is empty, so the entry may carry no duration.
      const cachedDuration = this.engine.getCachedProperty('duration');
      if (typeof cachedDuration === 'number' && cachedDuration > 0) {
        this.currentDuration = cachedDuration;
      }
    }
    // Now-playing needs no claim, since it is last-writer-wins and a duplicate is harmless.
    this.sendNowPlaying(songId);
  }

  private async runTrackStartHook(): Promise<void> {
    try {
      await this.onTrackStart();
    } catch (err) {
      logger.warn(`scrobble: track-start hook failed: ${String(err)}`);
    }
  }

  private onDuration(data: unknown): void {
    if (typeof data !== 'number' || data <= 0) return;
    this.currentDuration = data;
    // Duration can arrive after a time-pos that already passed the threshold.
    this.maybeSubmit(this.lastTimePos);
  }

  private onTimePos(data: unknown): void {
    if (typeof data === 'number') this.lastTimePos = data;
    this.maybeSubmit(data);
  }

  private maybeSubmit(timePos: unknown): void {
    if (this.submitted) return;
    if (this.transitionPending) return;
    if (this.currentSongId === null) return;
    if (this.startedAtMs === null) return;
    if (this.currentDuration === null || this.currentDuration < MIN_DURATION_SECONDS) return;
    if (typeof timePos !== 'number') return;
    if (timePos < this.currentDuration / 2 && timePos < MAX_THRESHOLD_SECONDS) return;

    // Another process claimed this play first.
    if (this.firstClaimant !== null) {
      this.submitted = true;
      return;
    }
    if (!this.claimSent) this.sendClaim();
  }

  /** Identifies a play across processes, since every client of one mpv reads the same entry ids. */
  private playKey(): string | null {
    if (this.currentSongId === null) return null;
    return `${this.currentEntryId ?? '-'}:${this.currentSongId}`;
  }

  private sendClaim(): void {
    const key = this.playKey();
    if (key === null) return;
    this.claimSent = true;
    this.claimTimer = setTimeout(() => {
      logger.warn(`scrobble: claim for ${key} got no echo from mpv, submitting`);
      this.settleClaim(key, true);
    }, SCROBBLE_CLAIM_ECHO_TIMEOUT_MS);
    this.claimTimer.unref();
    this.engine.broadcastMessage([SCROBBLE_CLAIM_TOPIC, key, this.claimantId]).catch((err: unknown) => {
      logger.warn(`scrobble: claim broadcast failed for ${key}, submitting: ${String(err)}`);
      this.settleClaim(key, true);
    });
  }

  private onMessage(args: string[]): void {
    const [topic, key, claimant] = args;
    if (topic !== SCROBBLE_CLAIM_TOPIC || claimant === undefined) return;
    if (key !== this.playKey()) return;
    this.firstClaimant ??= claimant;
    if (claimant === this.claimantId) this.settleClaim(key, this.firstClaimant === this.claimantId);
  }

  /** The key check keeps a late settle for a skipped play off the next one. */
  private settleClaim(key: string, won: boolean): void {
    if (key !== this.playKey() || this.submitted || this.startedAtMs === null) return;
    this.clearClaimTimer();
    this.submitted = true;
    if (won && this.currentSongId !== null) this.sendSubmission(this.currentSongId, this.startedAtMs);
  }

  private clearClaimTimer(): void {
    if (this.claimTimer === null) return;
    clearTimeout(this.claimTimer);
    this.claimTimer = null;
  }

  private reset(): void {
    this.currentSongId = null;
    this.currentEntryId = null;
    this.transitionPending = false;
    this.inheritedPath = null;
    this.currentDuration = null;
    this.startedAtMs = null;
    this.submitted = false;
    this.lastTimePos = null;
    this.firstClaimant = null;
    this.claimSent = false;
    this.clearClaimTimer();
    // lastPlaylistPos, lastPath, attachEpoch and generation outlive reset(), since they are
    // attach-lifetime state.
  }

  private sendNowPlaying(songId: string): void {
    this.client
      .subsonicRequest('/scrobble', { id: songId, submission: 'false' })
      .then(() => {
        logger.debug(`scrobble: now-playing sent for ${songId}`);
      })
      .catch((err: unknown) => {
        logger.warn(`scrobble: now-playing failed for ${songId}: ${String(err)}`);
      });
  }

  private sendSubmission(songId: string, startedAtMs: number): void {
    this.client
      .subsonicRequest(
        '/scrobble',
        { id: songId, submission: 'true', time: String(startedAtMs) },
        { retryPolicy: 'never' },
      )
      .then(() => {
        logger.debug(`scrobble: submission sent for ${songId} (started ${startedAtMs})`);
      })
      .catch((err: unknown) => {
        logger.warn(`scrobble: submission failed for ${songId}: ${String(err)}`);
      });
  }
}
