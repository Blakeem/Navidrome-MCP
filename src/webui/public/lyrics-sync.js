// Navidrome MCP web UI: lyrics timing arithmetic. Vanilla ES2020, no deps, no build step.
//
// Every export is pure and takes the clock it needs as a parameter, so vitest can
// run the whole module under its `node` environment where no browser global exists.

/**
 * Largest media-versus-clock drift a healthy snapshot may show before the
 * position counts as a jump. Sized for the player's 1 Hz snapshots and the
 * 2-to-3-second line gaps of a typical LRC, not borrowed from a 60 Hz loop.
 */
export const SEEK_THRESHOLD_MS = 500;

// A paused player must not move at all, so only rounding noise is tolerated.
const PAUSED_JITTER_MS = 100;

/**
 * Stateful detector over successive player snapshots. The caller supplies both
 * the media position and its own monotonic clock reading, which is what keeps
 * the arithmetic deterministic under test.
 */
export function createSeekDetector() {
  let lastMediaMs = null;
  let lastClockMs = null;

  return {
    check(mediaMs, clockMs, isPlaying) {
      // INPUT
      const previousMediaMs = lastMediaMs;
      const previousClockMs = lastClockMs;
      let mediaDelta = 0;
      let clockDelta = 0;

      lastMediaMs = mediaMs;
      lastClockMs = clockMs;

      // PROCESS
      // The first snapshot has nothing to interpolate from, so the caller must snap.
      if (previousMediaMs === null || previousClockMs === null) return true;

      mediaDelta = mediaMs - previousMediaMs;
      if (mediaDelta < 0) return true;
      if (!isPlaying) return mediaDelta > PAUSED_JITTER_MS;

      clockDelta = clockMs - previousClockMs;

      // OUTPUT
      return Math.abs(mediaDelta - clockDelta) > SEEK_THRESHOLD_MS;
    },
  };
}

function searchActiveLine(lines, timeMs) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  let mid = 0;

  while (low <= high) {
    mid = Math.floor((low + high) / 2);
    if (lines[mid].timeMs <= timeMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/**
 * Index of the line that owns `timeMs`, meaning the last line that has started.
 * A line stays current through the gap after it, so whether that gap is worth
 * showing as a break is the separate question `isInterlude` answers.
 *
 * Feed the previous call's `cursor` back in: ordinary playback then costs a step
 * or two, and any other movement falls back to a search.
 */
export function findActiveLine(lines, timeMs, cursor) {
  // INPUT
  const count = Array.isArray(lines) ? lines.length : 0;
  let cursorUsable = false;
  let index = -1;

  if (count === 0) return { index: -1, cursor: null };
  if (timeMs < lines[0].timeMs) return { index: -1, cursor: null };

  // PROCESS
  cursorUsable =
    Number.isInteger(cursor) && cursor >= 0 && cursor < count && lines[cursor].timeMs <= timeMs;

  if (cursorUsable) {
    index = cursor;
    while (index + 1 < count && lines[index + 1].timeMs <= timeMs) index += 1;
  } else {
    index = searchActiveLine(lines, timeMs);
  }

  // OUTPUT
  return { index, cursor: index };
}

/**
 * Whether the player sits in a real instrumental break: the active line has
 * already ended and the next one is still further off than `thresholdMs`. The
 * distance is measured from now, so the break clears as the next line nears.
 */
export function isInterlude(lines, index, timeMs, thresholdMs) {
  // INPUT
  const hasLines = Array.isArray(lines);
  const active = hasLines ? lines[index] : undefined;
  const next = hasLines ? lines[index + 1] : undefined;

  // PROCESS
  if (active === undefined || next === undefined) return false;
  if (timeMs <= active.endMs) return false;

  // OUTPUT
  return next.timeMs - timeMs > thresholdMs;
}

/**
 * Shift a media position by the user's manual offset. Clamped at zero because a
 * negative position matches no line.
 */
export function applyOffset(timeMs, offsetMs) {
  return Math.max(0, timeMs + offsetMs);
}
