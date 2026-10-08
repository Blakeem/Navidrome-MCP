// The clock the lyrics highlight is drawn at. It slews toward each snapshot instead of jumping,
// which the progress bar's clock must not do, so the two are separate clocks.

import { createSeekDetector } from './lyrics-sync.js';
import { isPaused } from './playback-clock.js';

/** How far the clock may run fast or slow while it absorbs a correction. A quarter of real
 *  time clears a small drift in about two seconds, which the reader does not see as a change of pace. */
const SLEW_RATE = 0.25;

const seekDetector = createSeekDetector();

let baseMs = 0;
let baseWallMs = 0;
// The outstanding correction, drained toward zero so a disagreeing snapshot does not twitch the highlight.
let slewMs = 0;
// Set by a seek, a reconnect or a return to visibility, so the next snapshot lands the clock
// instead of animating a scroll through the song.
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

// Every snapshot rebases this clock, overlay open or not, so the seek detector
// keeps an unbroken view of the position and a reopen is already in step.
export function rebaseLyricsClock(np) {
  // INPUT
  const nowMs = Date.now();
  const running = np !== null && np.engineRunning === true;
  const mediaMs = running && typeof np.position === 'number' ? Math.round(np.position * 1000) : 0;
  const shownMs = lyricsShownMs(nowMs);
  const seeked = seekDetector.check(mediaMs, nowMs, !isPaused());

  // PROCESS
  baseMs = mediaMs;
  baseWallMs = nowMs;
  slewMs = snapNext || seeked || !running ? 0 : shownMs - mediaMs;

  // OUTPUT
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
