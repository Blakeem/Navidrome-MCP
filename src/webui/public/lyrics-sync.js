// Every export takes its clock as a parameter and keeps no module state, so vitest runs this module
// under node with no browser global.

/** A larger drift between the media position and the clock counts as a seek. Sized for 1 Hz
 *  snapshots and the 2 to 3 second line gaps of a typical LRC file. */
export const SEEK_THRESHOLD_MS = 500;

// A paused player must not move at all, so only rounding noise is tolerated.
const PAUSED_JITTER_MS = 100;

/** The caller supplies the clock reading, which keeps the arithmetic deterministic under test. */
export function createSeekDetector() {
  let lastMediaMs = null;
  let lastClockMs = null;

  return {
    check(mediaMs, clockMs, isPlaying) {
      const previousMediaMs = lastMediaMs;
      const previousClockMs = lastClockMs;
      let mediaDelta = 0;
      let clockDelta = 0;

      lastMediaMs = mediaMs;
      lastClockMs = clockMs;

      // The first snapshot has nothing to interpolate from, so the caller must snap.
      if (previousMediaMs === null || previousClockMs === null) return true;

      mediaDelta = mediaMs - previousMediaMs;
      if (mediaDelta < 0) return true;
      if (!isPlaying) return mediaDelta > PAUSED_JITTER_MS;

      clockDelta = clockMs - previousClockMs;

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

/** A line stays current through the gap after it, and `isInterlude` decides if the gap is a break.
 *  Passing back the previous `cursor` makes ordinary playback cost a step or two. */
export function findActiveLine(lines, timeMs, cursor) {
  const count = Array.isArray(lines) ? lines.length : 0;
  let cursorUsable = false;
  let index = -1;

  if (count === 0) return { index: -1, cursor: null };
  if (timeMs < lines[0].timeMs) return { index: -1, cursor: null };

  cursorUsable =
    Number.isInteger(cursor) && cursor >= 0 && cursor < count && lines[cursor].timeMs <= timeMs;

  if (cursorUsable) {
    index = cursor;
    while (index + 1 < count && lines[index + 1].timeMs <= timeMs) index += 1;
  } else {
    index = searchActiveLine(lines, timeMs);
  }

  return { index, cursor: index };
}

/** The distance to the next line is measured from `timeMs`, so the break clears as it nears. */
export function isInterlude(lines, index, timeMs, thresholdMs) {
  const hasLines = Array.isArray(lines);
  const active = hasLines ? lines[index] : undefined;
  const next = hasLines ? lines[index + 1] : undefined;

  if (active === undefined || next === undefined) return false;
  if (timeMs <= active.endMs) return false;

  return next.timeMs - timeMs > thresholdMs;
}

/** Clamped at zero, since a negative position matches no line. */
export function applyOffset(timeMs, offsetMs) {
  return Math.max(0, timeMs + offsetMs);
}
