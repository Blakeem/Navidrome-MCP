// Level math for the visualizer: matching measurements to the playback clock, mapping decibels to
// heights, and smoothing. It references no browser global, so unit tests import it in Node.

export const BAND_COUNT = 16;

// Band medians measured from -50 dB on a classical track to -21 dB on a pop master, so a fixed range
// pinned loud masters at full height. A reference that follows the music keeps every track in range.
const RANGE_DB = 24;
// The loudest band sits this far under the top, so a frame at the reference never pins.
const HEADROOM_DB = 2;
const ATTACK_SECONDS = 0.3;
// Slow enough that a quieter verse after a loud chorus shows lower for several seconds.
const RELEASE_DB_PER_SECOND = 2;
// Keeps a fade to silence from lifting noise to full height.
const MIN_REFERENCE_DB = -55;
// The bands are a constant fraction of an octave wide, and most music still falls off above the mids.
const TILT_FROM_BAND = 6;
const TILT_DB_PER_BAND = 1;

// Measurements arrive about 0.28 s before the sound, so a newer one than this is not playing yet.
const ARRIVAL_LEAD_MS = 280;
// A measurement this far from the playback position does not describe what is playing.
const MATCH_WINDOW_MS = 500;
// No measurement for this long means the feed stopped, so the bars fall.
const FEED_STALE_MS = 1000;
const BUFFER_MS = 8000;

const ATTACK_PER_SECOND = 35;
const DECAY_PER_SECOND = 12;
const PEAK_HOLD_SECONDS = 0.5;
const PEAK_FALL_PER_SECOND = 1.2;
const REST_THRESHOLD = 0.002;

/**
 * Maps band levels to heights from 0 to 1 against a reference that follows the loudest band, the way
 * cava's automatic sensitivity works. The reference rises fast and falls slowly, so a loud master never
 * pins the bars and a quieter passage still shows lower than the one before it.
 */
export function createLevelGain() {
  let reference = null;
  let segment = null;

  return {
    /** `sample` is `{ segment, levels }` from the timeline, with levels in decibels. */
    heights(sample, dtSeconds) {
      const tilted = sample.levels.map((db, band) => db + Math.max(0, band - TILT_FROM_BAND) * TILT_DB_PER_BAND);
      const loudest = Math.max(...tilted);
      // A new file starts from its own level, so a quiet track after a loud one is not dwarfed for a minute.
      if (reference === null || sample.segment !== segment) {
        segment = sample.segment;
        reference = loudest;
      } else if (loudest > reference) {
        reference += (loudest - reference) * (1 - Math.exp(-dtSeconds / ATTACK_SECONDS));
      } else {
        reference = Math.max(loudest, reference - RELEASE_DB_PER_SECOND * dtSeconds);
      }
      reference = Math.max(MIN_REFERENCE_DB, reference);
      const floor = reference + HEADROOM_DB - RANGE_DB;
      return tilted.map((db) => Math.min(1, Math.max(0, (db - floor) / RANGE_DB)));
    },

    reset() {
      reference = null;
      segment = null;
    },
  };
}

/**
 * Holds recent measurements of the newest segment. A segment is one file's measurements, and its
 * timestamps restart at 0, so a new segment replaces the old one.
 */
export function createTimeline() {
  let segment = null;
  let frames = [];
  let lastIngestMs = -Infinity;

  return {
    /** Rows are `[segment, ptsMs, ...levelsDb]`, the shape the server's `levels` event carries. */
    ingest(rows, nowMs) {
      for (const row of rows) {
        const [rowSegment, ptsMs, ...levels] = row;
        if (rowSegment !== segment) {
          segment = rowSegment;
          frames = [];
        }
        frames.push({ ptsMs, levels });
      }
      if (rows.length > 0) lastIngestMs = nowMs;
      const newest = frames.at(-1);
      if (newest !== undefined) frames = frames.filter((frame) => newest.ptsMs - frame.ptsMs <= BUFFER_MS);
    },

    /**
     * `{ segment, levels }` for the playback position, or null when nothing describes it. The playback
     * clock is exact once it reports the new track, and the arrival lead covers the second before that.
     */
    levelsAt(positionSeconds, nowMs) {
      if (frames.length === 0 || nowMs - lastIngestMs > FEED_STALE_MS) return null;
      const positionMs = positionSeconds * 1000;
      let frame = frameAtOrBefore(frames, positionMs);
      if (frame === null || positionMs - frame.ptsMs > MATCH_WINDOW_MS) {
        frame = frameAtOrBefore(frames, frames.at(-1).ptsMs - ARRIVAL_LEAD_MS);
      }
      return frame === null ? null : { segment, levels: frame.levels };
    },

    clear() {
      segment = null;
      frames = [];
      lastIngestMs = -Infinity;
    },
  };
}

function frameAtOrBefore(frames, ptsMs) {
  let low = 0;
  let high = frames.length - 1;
  let found = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (frames[mid].ptsMs <= ptsMs) {
      found = frames[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Eases the drawn heights toward their targets with a factor from elapsed time, so the motion
 * looks the same at 30 and 144 frames a second. Peaks hold briefly, then fall.
 */
export function createSmoother(count) {
  const values = new Float32Array(count);
  const peaks = new Float32Array(count);
  const peakAges = new Float32Array(count);

  return {
    values,
    peaks,
    /** Null targets mean silence. Returns true once every height and peak has come to rest. */
    step(targets, dtSeconds) {
      let atRest = true;
      for (let i = 0; i < count; i++) {
        const target = targets === null ? 0 : (targets[i] ?? 0);
        const rate = target > values[i] ? ATTACK_PER_SECOND : DECAY_PER_SECOND;
        values[i] += (target - values[i]) * (1 - Math.exp(-rate * dtSeconds));
        if (values[i] >= peaks[i]) {
          peaks[i] = values[i];
          peakAges[i] = 0;
        } else {
          peakAges[i] += dtSeconds;
          if (peakAges[i] > PEAK_HOLD_SECONDS) peaks[i] = Math.max(values[i], peaks[i] - PEAK_FALL_PER_SECOND * dtSeconds);
        }
        if (values[i] > REST_THRESHOLD || peaks[i] > REST_THRESHOLD) atRest = false;
      }
      return atRest;
    },
  };
}
