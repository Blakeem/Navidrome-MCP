/**
 * Navidrome MCP Server - mpv shutdown decision
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

/**
 * Decide whether the web port owner should kill mpv on its own graceful
 * shutdown (standalone-web spec §8.1).
 *
 * Playing → keep mpv (it is detached and survives a web restart, so music
 * keeps going). Stopped/idle → kill it to reclaim the audio device.
 *
 * This is the single mpv-shutdown authority: **only the web port owner** ever
 * calls it, and **MCP exit never kills mpv** (preserving the deliberate
 * "survives parent" design). Pair the input with `playbackEngine.isPlaying()`.
 *
 * The consumer is the standalone web server's `onOwnerExit()` shutdown path
 * (spec §8.5), paired with the idle reaper below.
 */
export function shouldKillMpvOnOwnerShutdown(isPlaying: boolean): boolean {
  return !isPlaying;
}

/**
 * Minimal engine surface the reaper needs — kept narrow so the reaper is
 * unit-testable with a fake (no real mpv/IPC).
 */
export interface ReaperEngine {
  isRunning(): boolean;
  getCachedProperty(name: string): unknown;
  quitMpv(): Promise<void>;
}

/**
 * "Genuinely idle" = a live mpv that has reached end-of-playlist / has nothing
 * loaded (`idle-active === true`). This deliberately EXCLUDES a paused-mid-track
 * mpv (whose `idle-active` is false/undefined) — the user may resume, so we
 * never reap it. Radio streams never set `idle-active`, so they're never idle
 * here either (intended — they read as perpetually playing, spec §8.2).
 */
export function isGenuinelyIdle(engine: ReaperEngine): boolean {
  return engine.isRunning() && engine.getCachedProperty('idle-active') === true;
}

/**
 * Pure consecutive-idle counter (separated from the timer for unit testing).
 * Increments while idle, resets to 0 the moment a non-idle tick is seen — so
 * the reaper only fires after the mpv has been *continuously* idle across the
 * whole window, never on a play→idle→play flap.
 */
export function nextIdleStreak(prev: number, idleNow: boolean): number {
  return idleNow ? prev + 1 : 0;
}

export interface IdleReaper {
  stop(): void;
}

/** Idle reaper cadence (internal, not user-facing). mpv must be continuously
 * idle for `IDLE_REAPER_TICKS` ticks of `IDLE_REAPER_INTERVAL_MS` each — i.e.
 * ~10 minutes — before being reaped. Bias toward not reaping. */
export const IDLE_REAPER_INTERVAL_MS = 60_000;
export const IDLE_REAPER_TICKS = 10;

/**
 * Idle reaper (spec §8.3). While the active host runs, polls mpv every
 * `intervalMs`; once mpv has been continuously idle for `ticksToReap`
 * consecutive ticks, quits it to reclaim the audio device. Crash-orphan
 * coverage: a host that adopts a since-abandoned idle mpv reaps it on its next
 * window. Biased toward NOT reaping (genuine idle only; never paused-mid-track).
 *
 * After a reap the streak resets; mpv stops running, so subsequent ticks read
 * as not-idle and the counter stays at 0 until a new mpv spawns and goes idle
 * again — no double-quit, and a future idle session is still reapable.
 */
export function startIdleReaper(
  engine: ReaperEngine,
  options: { intervalMs: number; ticksToReap: number },
  onReap?: () => void,
): IdleReaper {
  let streak = 0;
  const timer = setInterval(() => {
    streak = nextIdleStreak(streak, isGenuinelyIdle(engine));
    if (streak >= options.ticksToReap) {
      streak = 0;
      void engine
        .quitMpv()
        .then(() => onReap?.())
        .catch(() => {
          /* best-effort; a failed quit just retries next window */
        });
    }
  }, options.intervalMs);
  // Don't keep the event loop alive solely for the reaper.
  if (typeof timer.unref === 'function') timer.unref();
  return { stop: (): void => clearInterval(timer) };
}
