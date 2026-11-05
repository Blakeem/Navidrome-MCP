/**
 * Navidrome MCP Server - e2e scrobble guard
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The instance submits a scrobble once a track of 30 s or longer passes min(duration / 2, 240) seconds, and no
 * setting turns that off. Navidrome play counts must not change, so the guard pauses mpv before
 * that point and records the trip, which fails the test.
 */

import { MAX_THRESHOLD_SECONDS, MIN_DURATION_SECONDS } from '../../../src/services/playback/scrobble-tracker.js';
import type { MpvProbe } from './mpv-probe.js';

const TRIP_FRACTION = 0.8;
const SAMPLE_INTERVAL_MS = 250;
// The tracker may take a duration from Navidrome while mpv reports none, and the shortest track it
// counts gives the earliest scrobble point.
const UNKNOWN_DURATION_SECONDS = MIN_DURATION_SECONDS;
// The tracker skips a track under MIN_DURATION_SECONDS, but it may keep Navidrome's duration while mpv
// reports a shorter one, so a track within the trip margin of that minimum stays guarded.
export const SHORT_TRACK_SECONDS = TRIP_FRACTION * MIN_DURATION_SECONDS;

export function scrobbleTripSeconds(durationSeconds: number): number {
  return TRIP_FRACTION * Math.min(durationSeconds / 2, MAX_THRESHOLD_SECONDS);
}

export class ScrobbleGuard {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private tripMessage: string | null = null;

  /** `tripAt` maps a track duration to the position that trips the guard. */
  constructor(
    private readonly mpv: MpvProbe,
    private readonly tripAt: (durationSeconds: number) => number = scrobbleTripSeconds,
  ) {}

  get trip(): string | null {
    return this.tripMessage;
  }

  start(): void {
    if (this.timer !== null) return;
    // A tick that overlaps a slow one is skipped, so samples never queue up behind a stalled pipe.
    this.timer = setInterval(() => {
      this.inFlight ??= this.sample().finally(() => {
        this.inFlight = null;
      });
    }, SAMPLE_INTERVAL_MS);
  }

  /**
   * Pauses mpv, so no track plays on between tests. A running sample finishes first, so its trip
   * is recorded before the caller reads `trip` and the probe closes.
   */
  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
    await this.mpv.pauseIfRunning();
  }

  // Every crossing pauses mpv, so playback resumed after a trip is stopped again. The first message is kept.
  private async sample(): Promise<void> {
    try {
      if (!(await this.mpv.isRunning())) return;
      const position = await this.mpv.readNumber('time-pos');
      const duration = await this.mpv.readNumber('duration');
      if (duration !== null && duration < SHORT_TRACK_SECONDS) return;
      const tripPoint = this.tripAt(duration ?? UNKNOWN_DURATION_SECONDS);
      if (position === null || position < tripPoint) return;
      await this.mpv.set('pause', true);
      if (this.tripMessage !== null) return;
      const title = await this.mpv.read('media-title');
      const length = duration === null ? 'an unknown length' : `${duration.toFixed(1)} s`;
      this.tripMessage =
        `The scrobble guard paused "${String(title)}" at ${position.toFixed(1)} s of ${length}, ` +
        `past ${tripPoint.toFixed(1)} s. Keep each track's playing time short, since a scrobble changes Navidrome play counts.`;
    } catch {
      // mpv may quit between two reads, which the next sample sees as not running.
    }
  }
}
