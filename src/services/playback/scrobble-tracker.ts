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

import { logger } from '../../utils/logger.js';
import type { StateChangeEvent } from './playback-engine.js';

// Last.fm scrobble rules: track must be at least 30s long, and counts as
// played after the user has listened to half the duration OR 4 minutes,
// whichever comes first.
const MIN_DURATION_SECONDS = 30;
const MAX_THRESHOLD_SECONDS = 240;

/**
 * Subset of the playback engine the tracker depends on. Defined here so
 * tests can pass a minimal fake without constructing the full engine.
 */
export interface ScrobbleEngine {
  onStateChange(handler: (event: StateChangeEvent) => void): () => void;
  getPlaylist(): Promise<Array<{ index: number; songId: string | null; duration?: number }>>;
  getCachedProperty(name: string): unknown;
}

/**
 * Subset of the Navidrome client the tracker depends on.
 */
export interface ScrobbleClient {
  subsonicRequest(
    endpoint: string,
    params?: Record<string, string>,
    options?: { method?: 'GET' | 'POST' },
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
 */
export class ScrobbleTracker {
  private readonly client: ScrobbleClient;
  private readonly engine: ScrobbleEngine;
  private unsubscribe: (() => void) | null = null;

  private currentSongId: string | null = null;
  private currentDuration: number | null = null;
  private startedAtMs: number | null = null;
  private submitted = false;
  // Latest mpv time-pos value observed for the current play, in seconds.
  // Tracked here (rather than read from the engine cache) so a stale
  // time-pos belonging to the previous track can't leak into the new
  // play's threshold check during the brief window between a playlist-pos
  // change and the first time-pos event for the new file.
  private lastTimePos: number | null = null;

  // Sentinel 'unknown' until the first playlist-pos event after attach.
  // That first event is mpv's observe-emitted snapshot of current state —
  // it must NOT trigger hydration, because the engine may have just
  // attached to an mpv already mid-track from a previous MCP session.
  // Subsequent events that change this value are real transitions.
  private lastPlaylistPos: number | null | 'unknown' = 'unknown';

  // Bumped on every real transition (onPlaylistPos / onQueueMutation).
  // hydrateAndStart captures gen at call time and bails after each await
  // if it has advanced — guards against out-of-order playlist reads
  // under fast skips. Persists across reset() (attach-lifetime state).
  private generation = 0;

  constructor(client: ScrobbleClient, engine: ScrobbleEngine) {
    this.client = client;
    this.engine = engine;
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
    this.generation = 0;
  }

  private handleEvent(event: StateChangeEvent): void {
    if (event.kind === 'queue') {
      this.onQueueMutation();
      return;
    }
    switch (event.name) {
      case 'playlist-pos':
        this.onPlaylistPos(event.data);
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

  private onPlaylistPos(data: unknown): void {
    const next = typeof data === 'number' ? data : null;
    const prev = this.lastPlaylistPos;
    this.lastPlaylistPos = next;
    // First event since attach is mpv's observe-emitted current state —
    // hydrate the sentinel but do nothing else.
    if (prev === 'unknown') return;
    // mpv re-emit at the same value (or jumpToPlaylistEntry to current
    // index): not a real track change. Last.fm wouldn't accept a
    // re-scrobble within minutes anyway, so silently ignore.
    if (prev === next) return;
    this.reset();
    if (next === null || next < 0) return;
    void this.hydrateAndStart(next, ++this.generation);
  }

  private onQueueMutation(): void {
    // A queue-mutating engine operation just completed (enqueue / clear /
    // shuffle / move / remove / enqueueRadio). mpv does not emit a
    // playlist-pos change event when the index stays the same (e.g.
    // enqueue('replace') while at index 0 — the most common case for
    // play_songs called on an attached mpv that's already playing).
    // Force a re-hydration; the songId comparison inside the async path
    // makes this a no-op when the current track wasn't actually displaced
    // (shuffle that left index 0 alone), and the generation token makes
    // concurrent transitions safe.
    void this.maybeRehydrateAfterQueue();
  }

  private async maybeRehydrateAfterQueue(): Promise<void> {
    const cachedPos = this.engine.getCachedProperty('playlist-pos');
    if (typeof cachedPos !== 'number' || cachedPos < 0) {
      this.reset();
      this.lastPlaylistPos = typeof cachedPos === 'number' ? cachedPos : null;
      return;
    }
    let entry: { songId: string | null; duration?: number } | undefined;
    try {
      const playlist = await this.engine.getPlaylist();
      entry = playlist.find((e) => e.index === cachedPos);
    } catch (err) {
      logger.warn(`scrobble: failed to read playlist after queue mutation: ${String(err)}`);
      return;
    }
    if (entry === undefined) return;
    // Already tracking this exact song — either a concurrent property-change
    // handler hydrated, or the queue mutation didn't displace the current
    // track. No-op in either case.
    if (entry.songId !== null && entry.songId === this.currentSongId) return;
    this.reset();
    this.lastPlaylistPos = cachedPos;
    this.generation++;
    if (entry.songId === null) return; // radio
    this.startTrackingTrack(entry.songId, entry.duration);
  }

  private async hydrateAndStart(pos: number, gen: number): Promise<void> {
    let entry: { songId: string | null; duration?: number } | undefined;
    try {
      const playlist = await this.engine.getPlaylist();
      if (gen !== this.generation) return; // superseded by a newer transition
      entry = playlist.find((e) => e.index === pos);
    } catch (err) {
      logger.warn(`scrobble: failed to read playlist for pos=${pos}: ${String(err)}`);
      return;
    }
    if (entry === undefined) return;
    if (entry.songId === null) return; // radio stream
    if (gen !== this.generation) return; // defensive after the find
    this.startTrackingTrack(entry.songId, entry.duration);
  }

  private startTrackingTrack(songId: string, duration: number | undefined): void {
    this.currentSongId = songId;
    this.startedAtMs = Date.now();
    this.submitted = false;
    this.lastTimePos = null;
    this.currentDuration = null;
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
    this.sendNowPlaying(songId);
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
    if (this.currentSongId === null) return;
    if (this.startedAtMs === null) return;
    if (this.currentDuration === null || this.currentDuration < MIN_DURATION_SECONDS) return;
    if (typeof timePos !== 'number') return;
    if (timePos < this.currentDuration / 2 && timePos < MAX_THRESHOLD_SECONDS) return;

    // Set the flag BEFORE dispatching to prevent re-entry from a subsequent
    // time-pos tick before the async call resolves.
    this.submitted = true;
    this.sendSubmission(this.currentSongId, this.startedAtMs);
  }

  private reset(): void {
    this.currentSongId = null;
    this.currentDuration = null;
    this.startedAtMs = null;
    this.submitted = false;
    this.lastTimePos = null;
    // lastPlaylistPos and generation are intentionally preserved across
    // reset() — they track attach-lifetime state, not per-play state.
  }

  private sendNowPlaying(songId: string): void {
    this.client
      .subsonicRequest('/scrobble', { id: songId, submission: 'false' }, { method: 'POST' })
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
        { method: 'POST' },
      )
      .then(() => {
        logger.debug(`scrobble: submission sent for ${songId} (started ${startedAtMs})`);
      })
      .catch((err: unknown) => {
        logger.warn(`scrobble: submission failed for ${songId}: ${String(err)}`);
      });
  }
}
