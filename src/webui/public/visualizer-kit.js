// Helpers shared by the visualizer's drawing modes, which live one per file in visualizers/. It
// references no browser global, so unit tests drive the modes with a recording context.

/** Every mode keeps its drawing at least this fraction of the shorter side away from each edge. */
export const PAD_RATIO = 0.08;

// The beat test compares levels across this interval, so it does not depend on the frame rate.
const BEAT_WINDOW_S = 0.05;
const BEAT_FLUX = 0.35;
const BEAT_MIN_GAP_S = 0.2;

/** Interpolates the band heights to `count` points with a Catmull-Rom curve, so drawn shapes stay smooth. */
export function resample(values, count) {
  const out = new Float32Array(count);
  const last = values.length - 1;
  for (let i = 0; i < count; i++) {
    const position = count === 1 ? 0 : (i / (count - 1)) * last;
    const index = Math.floor(position);
    const t = position - index;
    const p0 = values[Math.max(0, index - 1)];
    const p1 = values[index];
    const p2 = values[Math.min(last, index + 1)];
    const p3 = values[Math.min(last, index + 2)];
    const curve = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    out[i] = Math.min(1, Math.max(0, curve));
  }
  return out;
}

export function rgba(color, alpha) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

export function average(values, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i];
  return sum / (to - from);
}

/** The loudness of all bands and of the lowest four. */
export function levelSummary(values) {
  return { energy: average(values, 0, values.length), bass: average(values, 0, Math.min(4, values.length)) };
}

/**
 * True on a rise in loudness across the bands, at most once per gap, measured over a fixed interval.
 * It keeps its own fields under `state.beat`, so a mode calls it once per frame with its own state.
 */
export function detectBeat(state, frame) {
  const beat = (state.beat ??= { sinceSample: BEAT_WINDOW_S, sinceBeat: BEAT_MIN_GAP_S, previous: null });
  beat.sinceSample += frame.dtSeconds;
  beat.sinceBeat += frame.dtSeconds;
  if (beat.sinceSample < BEAT_WINDOW_S) return false;
  const previous = beat.previous ?? frame.values;
  let flux = 0;
  for (let i = 0; i < frame.values.length; i++) flux += Math.max(0, frame.values[i] - previous[i]);
  beat.previous = Float32Array.from(frame.values);
  beat.sinceSample = 0;
  if (flux <= BEAT_FLUX || beat.sinceBeat < BEAT_MIN_GAP_S) return false;
  beat.sinceBeat = 0;
  return true;
}

/** Hue in degrees, saturation and lightness in percent, from a palette color. */
export function hslOf({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = ((max + min) / 2) * 100;
  if (max === min) return { hue: 0, saturation: 0, lightness };
  const delta = max - min;
  const saturation = (delta / (1 - Math.abs(max + min - 1))) * 100;
  let hue = 0;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation, lightness };
}
