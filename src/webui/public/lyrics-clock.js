// The lyrics highlight slews toward each snapshot instead of jumping. The progress bar must not
// slew, so the two read separate clocks.

import { createSeekDetector } from './lyrics-sync.js';
import { isPaused } from './playback-clock.js';

/** The clock runs up to a quarter fast or slow while it absorbs a correction. That clears a 500 ms
 *  drift in two seconds, which the reader does not see as a change of pace. */
const SLEW_RATE = 0.25;

const seekDetector = createSeekDetector();

let baseMs = 0;
let baseWallMs = 0;
// Drained toward zero, so a snapshot that disagrees never makes the highlight jump.
let slewMs = 0;
// Set when the clock may be far off, such as after a reconnect or a hidden tab, so the next
// snapshot snaps the clock instead of scrolling through the song.
let snapNext = true;

export function lyricsShownMs(nowMs) {
  const elapsedMs = isPaused() ? 0 : nowMs - baseWallMs;
  return Math.max(0, baseMs + elapsedMs + slewMs);
}

export function drainSlew(frameDeltaMs) {
  const step = frameDeltaMs * SLEW_RATE;
  if (slewMs > step) slewMs -= step;
  else if (slewMs < -step) slewMs += step;
  else slewMs = 0;
}

// Every snapshot rebases this clock, overlay open or not, so the seek detector sees every position
// and a reopened overlay is already in step.
export function rebaseLyricsClock(np) {
  const nowMs = Date.now();
  const running = np !== null && np.engineRunning === true;
  const mediaMs = running && typeof np.position === 'number' ? Math.round(np.position * 1000) : 0;
  const shownMs = lyricsShownMs(nowMs);
  const seeked = seekDetector.check(mediaMs, nowMs, !isPaused());

  baseMs = mediaMs;
  baseWallMs = nowMs;
  slewMs = snapNext || seeked || !running ? 0 : shownMs - mediaMs;

  snapNext = false;
}

export function snapLyricsClock() {
  snapNext = true;
}

export function clearLyricsSlew() {
  slewMs = 0;
}

// A tapped line moves the clock at once, so the highlight does not wait for a snapshot.
export function jumpLyricsClock(timeMs) {
  baseMs = timeMs;
  baseWallMs = Date.now();
  slewMs = 0;
  snapNext = true;
}
