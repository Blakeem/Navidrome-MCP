/**
 * Navidrome MCP Server - Scrobble Tracker
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

import { randomUUID } from 'node:crypto';

import { SCROBBLE_CLAIM_ECHO_TIMEOUT_MS } from '../../constants/timeouts.js';
import { logger } from '../../utils/logger.js';
import type { StateChangeEvent } from './playback-engine.js';
import type { RetryPolicy } from '../../utils/fetch-with-timeout.js';

// Last.fm scrobble rules: track must be at least 30s long, and counts as
// played after the user has listened to half the duration OR 4 minutes,
// whichever comes first.
const MIN_DURATION_SECONDS = 30;
const MAX_THRESHOLD_SECONDS = 240;

/** The script-message topic for a claim. Its args are the play key and the claimant id. */
const SCROBBLE_CLAIM_TOPIC = 'navidrome-mcp-scrobble-claim';

/** One live queue entry as the tracker reads it. `entryId` and `isCurrent` come from mpv. */
interface ScrobbleQueueEntry {
  index: number;
  songId: string | null;
  entryId?: number;
  isCurrent?: boolean;
  duration?: number;
}

/**
 * Subset of the playback engine the tracker depends on. Defined here so
 * tests can pass a minimal fake without constructing the full engine.
 */
export interface ScrobbleEngine {
  onStateChange(handler: (event: StateChangeEvent) => void): () => void;
  getQueue(): Promise<ScrobbleQueueEntry[]>;
  getCachedProperty(name: string): unknown;
  broadcastMessage(args: string[]): Promise<void>;
}

/**
 * Subset of the Navidrome client the tracker depends on.
 */
export interface ScrobbleClient {
  subsonicRequest(
    endpoint: string,
    params?: Record<string, string>,
    options?: { retryPolicy?: RetryPolicy },
  ): Promise<unknown>;
}

/**
 * Watches the playback engine and submits Subsonic `/scrobble` calls to
 * Navidrome, mirroring the web UI / Last.fm rules:
 *
 *   1. On track start → `submission=false` (now-playing notification).
 *   2. After listening past half the duration OR 4 minutes (whichever first),
 *      once per play → `submission=true&time=<startedAt-ms>`.
 *
 * Tracks shorter than 30s, and radio streams (no `songId`), never scrobble.
 *
 * The tracker is fire-and-forget: every Subsonic call is dispatched async
 * with errors logged at warn level. It never blocks playback or surfaces
 * errors to tool callers.
 *
 * Attach semantics: mpv is intentionally configured to outlive the MCP
 * process, so when MCP starts the engine often attaches to an mpv that's
 * already mid-track. The engine's `installObservers` triggers mpv to emit
 * immediate "current value" change events for every observed property,
 * which look identical to real transitions. The first `playlist-pos`
 * event after attach is therefore treated as initial state — it hydrates
 * a sentinel but does NOT trigger now-playing or scrobble tracking. Only
 * subsequent events that actually change the value are real transitions.
 * The engine's `attach` event marks every later attach, so a re-attach to a
 * new mpv instance starts from the same sentinel.
 *
 * Every process attached to one mpv runs a tracker. At the threshold, a tracker
 * that counted the play broadcasts a claim through mpv, which delivers every
 * claim to every client in one order. The first claim for a play wins, so exactly
 * one process submits it. An adopted play never claims.
 */
export class ScrobbleTracker {
  private readonly client: ScrobbleClient;
  private readonly engine: ScrobbleEngine;
  private readonly shouldSubmit: () => Promise<boolean>;
  private readonly claimantId = randomUUID();
  private unsubscribe: (() => void) | null = null;

  private currentSongId: string | null = null;
  private currentEntryId: number | null = null;
  private currentDuration: number | null = null;
  private startedAtMs: number | null = null;
  private submitted = false;
  // Per-play verdict from the injected `shouldSubmit` check, decided once at track start.
  // 'notMine' defers to an older web owner that submits without claiming. 'undecided'
  // while the check is in flight, so maybeSubmit waits and resolveOwnership re-drives it.
  private submitVerdict: 'undecided' | 'mine' | 'notMine' = 'undecided';
  // The first claimant seen for the current play, this process included.
  private firstClaimant: string | null = null;
  private claimSent = false;
  // Fails the claim open when mpv never echoes it, since a lost scrobble is worse than a rare double.
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  // Latest mpv time-pos value observed for the current play, in seconds.
  // Tracked here (rather than read from the engine cache) so a stale
  // time-pos belonging to the previous track can't leak into the new
  // play's threshold check during the brief window between a playlist-pos
  // change and the first time-pos event for the new file.
  private lastTimePos: number | null = null;
  // Set when playlist-pos moves, until the playlist read shows whether the entry
  // at the new index is the same play. A queue edit can shift the playing entry's
  // index, so submissions wait rather than count that play twice.
  private transitionPending = false;
  // The file playing at attach, while the play adopted for it lasts.
  private inheritedPath: string | null = null;

  // Sentinel 'unknown' until the first playlist-pos event after attach.
  // That first event is mpv's observe-emitted snapshot of current state —
  // it must NOT trigger hydration, because the engine may have just
  // attached to an mpv already mid-track from a previous MCP session.
  // Subsequent events that change this value are real transitions.
  private lastPlaylistPos: number | null | 'unknown' = 'unknown';
  // Undefined until the first path event after attach, which is mpv's observe snapshot.
  private lastPath: string | null | undefined = undefined;
  // Bumped per attach and detach, so an in-flight adoption never lands on a later instance.
  private attachEpoch = 0;

  // Bumped on every real transition, so a playlist read that resolves after a newer one is dropped.
  // Persists across reset(), since it is attach-lifetime state.
  private generation = 0;

  /**
   * @param shouldSubmit Resolves to whether THIS process may claim the play it
   *   is about to start tracking. Called once per track (at track start).
   *   Defaults to always-true. MCP injects a web-port probe so it defers to an
   *   older navidrome-web that submits without claiming.
   */
  constructor(
    client: ScrobbleClient,
    engine: ScrobbleEngine,
    shouldSubmit: () => Promise<boolean> = () => Promise.resolve(true),
  ) {
    this.client = client;
    this.engine = engine;
    this.shouldSubmit = shouldSubmit;
  }

  /**
   * Subscribe to engine state changes. Idempotent — a second call while
   * already attached is a no-op.
   */
  attach(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.engine.onStateChange((event) => {
      this.handleEvent(event);
    });
  }

  /**
   * Unsubscribe and reset state. Used by tests; in production the tracker's
   * lifetime is the process lifetime.
   */
  detach(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.reset();
    // Reset attach-lifetime state too so detach-then-reattach starts clean.
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
    // Orphans playlist reads and ownership checks begun against the previous instance.
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
    // mpv re-emit at the same value (or jumpToQueueEntry to current
    // index): not a real track change. Last.fm wouldn't accept a
    // re-scrobble within minutes anyway, so silently ignore.
    if (prev === next) return;
    if (next === null || next < 0) {
      this.reset();
      return;
    }
    this.transitionPending = true;
    void this.hydrateAndStart(next, ++this.generation);
  }

  /**
   * Records the in-flight play as already submitted, so a later queue edit or index shift confirms
   * it instead of counting it again. The attach-time file is its identity, since this read can land
   * after the command that triggered the attach moved the entry or replaced the file.
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
    if (typeof entry?.songId !== 'string') return; // nothing current, or radio
    this.currentSongId = entry.songId;
    this.currentEntryId = entry.entryId ?? null;
    this.inheritedPath = snapshotPath;
    this.submitted = true;
    this.submitVerdict = 'notMine';
  }

  /**
   * A path change is the one signal for a file change that keeps the index or comes from another
   * process. mpv reports path before duration, so the pending flag keeps the new file's events off the displaced play.
   */
  private onPath(data: unknown): void {
    const next = typeof data === 'string' ? data : null;
    const prev = this.lastPath;
    this.lastPath = next;
    const leftInheritedFile = this.inheritedPath !== null && next !== this.inheritedPath;
    if (!leftInheritedFile && (prev === undefined || prev === next)) return;
    // The adoption read can show the entry that replaced the inherited file, so that play ends here.
    if (leftInheritedFile) this.reset();
    this.transitionPending = true;
    void this.maybeRehydrateAfterQueue();
  }

  private onQueueMutation(): void {
    // A queue-mutating engine operation just completed (enqueue / clear /
    // shuffle / move / remove / enqueueRadio). mpv does not emit a
    // playlist-pos change event when the index stays the same (e.g.
    // enqueue('replace') while at index 0 — the most common case for
    // play_songs called on an attached mpv that's already playing).
    // Force a re-hydration. The same-play check inside the async path
    // makes this a no-op when the current track wasn't actually displaced
    // (shuffle that left index 0 alone), and the generation token makes
    // concurrent transitions safe.
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
      if (gen !== this.generation) return; // superseded by a newer transition
      // The playlist-pos cache can lag the mutation that just finished, so mpv's
      // current flag from this same read names the playing entry when present.
      entry = playlist.find((e) => e.isCurrent === true) ?? playlist.find((e) => e.index === cachedPos);
    } catch (err) {
      logger.warn(`scrobble: failed to read playlist after queue mutation: ${String(err)}`);
      // A pending file change leaves the playing file unknown, so the play ends. A plain queue edit keeps it.
      if (gen === this.generation && this.transitionPending) this.reset();
      return;
    }
    if (entry === undefined) {
      this.reset();
      return;
    }
    // The same entry means the current play was not displaced, so tracking continues.
    // Without an mpv entry id, a back-to-back replay of the same song is not counted again.
    if (this.isSamePlay(entry)) {
      this.confirmSamePlay();
      return;
    }
    this.reset();
    this.lastPlaylistPos = entry.index;
    if (entry.songId === null) return; // radio
    this.startTrackingTrack(entry.songId, entry.entryId, entry.duration);
  }

  private async hydrateAndStart(pos: number, gen: number): Promise<void> {
    let entry: ScrobbleQueueEntry | undefined;
    try {
      const playlist = await this.engine.getQueue();
      if (gen !== this.generation) return; // superseded by a newer transition
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
    if (entry.songId === null) return; // radio stream
    this.startTrackingTrack(entry.songId, entry.entryId, entry.duration);
  }

  /** mpv's entry id survives an index shift. Without one, the songId is the only identity. */
  private isSamePlay(entry: ScrobbleQueueEntry): boolean {
    if (this.currentSongId === null) return false;
    if (entry.entryId !== undefined && this.currentEntryId !== null) {
      return entry.entryId === this.currentEntryId;
    }
    return entry.songId === this.currentSongId;
  }

  /**
   * The playing entry only moved, so its play continues. The transition that
   * got here bumped `generation`, which orphans an in-flight verdict, so an
   * undecided verdict is resolved again.
   */
  private confirmSamePlay(): void {
    this.transitionPending = false;
    if (this.submitVerdict === 'undecided') void this.resolveOwnership(this.generation);
    this.maybeSubmit(this.lastTimePos);
  }

  private startTrackingTrack(songId: string, entryId: number | undefined, duration: number | undefined): void {
    this.currentSongId = songId;
    this.currentEntryId = entryId ?? null;
    this.startedAtMs = Date.now();
    this.submitted = false;
    this.lastTimePos = null;
    this.currentDuration = null;
    // Decide who counts this play, live, at track start. startTrackingTrack is
    // always reached under a freshly-bumped `generation` (onPlaylistPos /
    // maybeRehydrateAfterQueue), so `this.generation` is this track's token —
    // capture it so a verdict that resolves after a skip can't latch onto the
    // wrong track. now-playing below is intentionally NOT gated (see comment).
    this.submitVerdict = 'undecided';
    void this.resolveOwnership(this.generation);
    if (typeof duration === 'number' && duration > 0) {
      this.currentDuration = duration;
    } else {
      // Fall back to mpv's cached duration if the playlist entry didn't
      // carry one (e.g. post-MCP-restart attach where the metadata cache
      // is empty).
      const cachedDuration = this.engine.getCachedProperty('duration');
      if (typeof cachedDuration === 'number' && cachedDuration > 0) {
        this.currentDuration = cachedDuration;
      }
    }
    // now-playing (submission=false) is intentionally NOT gated on the verdict:
    // it overwrites the server's current now-playing (idempotent, last-writer-
    // wins), so two processes both sending it is harmless — and gating it would
    // stall the now-playing ping behind the probe for no benefit.
    this.sendNowPlaying(songId);
  }

  /**
   * Resolve this track's scrobble-ownership verdict, then catch up if the
   * threshold was already crossed while the check was in flight. Mirrors the
   * `onDuration` catch-up: re-invoke `maybeSubmit(this.lastTimePos)` once the
   * verdict lands. The post-await `gen !== this.generation` guard (same pattern
   * as `hydrateAndStart`) drops a verdict for a track that has since been
   * superseded by a skip, so it can't latch onto the new play.
   */
  private async resolveOwnership(gen: number): Promise<void> {
    let mine = true;
    try {
      mine = await this.shouldSubmit();
    } catch (err) {
      // The probe never rejects in practice (probeHealthz always resolves), but
      // the injected contract allows it. Default to submitting: a missed scrobble
      // is less recoverable than a rare double, and an unreachable probe almost
      // certainly means no web owner is up.
      logger.warn(`scrobble: ownership check failed, defaulting to submit: ${String(err)}`);
      mine = true;
    }
    if (gen !== this.generation) return; // superseded by a newer transition
    this.submitVerdict = mine ? 'mine' : 'notMine';
    if (mine) this.maybeSubmit(this.lastTimePos);
  }

  private onDuration(data: unknown): void {
    if (typeof data !== 'number' || data <= 0) return;
    this.currentDuration = data;
    // Re-evaluate threshold against the last time-pos we observed for
    // this play. Handles the (rare) case where duration arrives after a
    // qualifying time-pos tick.
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

    // Ownership gate (decided once per track in resolveOwnership). 'notMine':
    // another process (the web port owner) counts this play — latch `submitted`
    // so later time-pos ticks short-circuit cheaply. 'undecided': the probe is
    // still in flight — DEFER without latching; resolveOwnership re-invokes
    // maybeSubmit when the verdict lands. 'mine' falls through to submit.
    if (this.submitVerdict === 'notMine') {
      this.submitted = true;
      return;
    }
    if (this.submitVerdict === 'undecided') return;

    // Another process claimed this play first.
    if (this.firstClaimant !== null) {
      this.submitted = true;
      return;
    }
    if (!this.claimSent) this.sendClaim();
  }

  /** Identifies one play across processes, since every client of one mpv reads the same entry ids. */
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
    this.submitVerdict = 'undecided';
    this.firstClaimant = null;
    this.claimSent = false;
    this.clearClaimTimer();
    // lastPlaylistPos and generation are intentionally preserved across
    // reset() — they track attach-lifetime state, not per-play state.
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
