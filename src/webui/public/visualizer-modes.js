// The visualizer's drawing modes. Each draws inside an inset of PAD_RATIO of the shorter side, so the
// feathered edge fades only empty space and no box outline shows. It references no browser global,
// so unit tests drive it with a recording context.

/** Every mode keeps its drawing at least this fraction of the shorter side away from each edge. */
export const PAD_RATIO = 0.12;

const RING_SPOKES_PER_SIDE = 24;
const RIBBON_POINTS = 64;
const RIBBON_STRANDS = 5;
const RIBBON_TWISTS = 1.5;
const RIBBON_LINE_WIDTH = 1.5;
const BAR_COUNT = 28;
// The orb compares levels across this interval, so its beat test does not depend on the frame rate.
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

function rgba(color, alpha) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

function average(values, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i];
  return sum / (to - from);
}

/** Mirrored bars around the center line, with held peaks. */
function drawBars(ctx, frame) {
  const { width, height, palette } = frame;
  const pad = Math.min(width, height) * PAD_RATIO;
  const step = (width - 2 * pad) / BAR_COUNT;
  const barWidth = step * 0.55;
  const middle = height / 2;
  // A round cap reaches half the bar width past the line's end, so the line stops short by that much.
  const maxHalf = middle - pad - barWidth / 2;
  const heights = resample(frame.values, BAR_COUNT);
  const peaks = resample(frame.peaks, BAR_COUNT);

  const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
  gradient.addColorStop(0, rgba(palette.strong, 0.85));
  gradient.addColorStop(0.5, rgba(palette.accent, 1));
  gradient.addColorStop(1, rgba(palette.strong, 0.85));
  ctx.lineCap = 'round';
  ctx.lineWidth = barWidth;
  ctx.strokeStyle = gradient;
  ctx.beginPath();
  for (let i = 0; i < BAR_COUNT; i++) {
    const half = heights[i] * maxHalf;
    if (half < 1) continue;
    const x = pad + step * (i + 0.5);
    ctx.moveTo(x, middle - half);
    ctx.lineTo(x, middle + half);
  }
  ctx.stroke();

  ctx.fillStyle = rgba(palette.strong, 0.55);
  ctx.beginPath();
  for (let i = 0; i < BAR_COUNT; i++) {
    const half = peaks[i] * maxHalf;
    if (half < 2) continue;
    const x = pad + step * (i + 0.5);
    for (const y of [middle - half, middle + half]) {
      ctx.moveTo(x + barWidth * 0.3, y);
      ctx.arc(x, y, barWidth * 0.3, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/** Spokes around a circle that swells with the bass, low bands at the top, mirrored left and right. */
function drawRing(ctx, frame) {
  const { width, height, palette, state } = frame;
  const size = Math.min(width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const lineWidth = Math.max(1.5, size * 0.012);
  const outerLimit = size * (0.5 - PAD_RATIO) - lineWidth / 2;
  const baseRadius = size * (0.2 + 0.03 * frame.bass);
  const maxLength = outerLimit - size * 0.23;
  const spokes = resample(frame.values, RING_SPOKES_PER_SIDE);
  if (!frame.reducedMotion) state.angle = ((state.angle ?? 0) + frame.dtSeconds * 0.15) % (Math.PI * 2);
  const rotation = state.angle ?? 0;

  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius);
  glow.addColorStop(0, rgba(palette.accent, 0.35 * frame.energy));
  glow.addColorStop(1, rgba(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = rgba(palette.accent, 0.95);
  ctx.beginPath();
  for (let k = 0; k < RING_SPOKES_PER_SIDE; k++) {
    const length = spokes[k] * maxLength;
    if (length < 1) continue;
    const sweep = ((k + 0.5) / RING_SPOKES_PER_SIDE) * Math.PI;
    for (const angle of [-Math.PI / 2 + sweep + rotation, -Math.PI / 2 - sweep + rotation]) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(centerX + cos * baseRadius, centerY + sin * baseRadius);
      ctx.lineTo(centerX + cos * (baseRadius + length), centerY + sin * (baseRadius + length));
    }
  }
  ctx.stroke();
}

/** Strands that twist along a ribbon, each as tall as the spectrum at its point, over a faint body. */
function drawRibbon(ctx, frame) {
  const { width, height, palette, state } = frame;
  // Each strand is centered on its path, so the ribbon keeps a line width clear of the pad.
  const inset = Math.min(width, height) * PAD_RATIO + RIBBON_LINE_WIDTH;
  const middle = height / 2;
  const span = width - 2 * inset;
  const maxAmplitude = middle - inset;
  // Rounding puts the last angle a hair past pi, where sin is negative and its square root is NaN.
  const amplitudes = Array.from(
    resample(frame.values, RIBBON_POINTS),
    (value, i) => value * maxAmplitude * Math.max(0, Math.sin((Math.PI * i) / (RIBBON_POINTS - 1))) ** 0.5,
  );
  // Silence draws nothing, so a paused player shows an empty space.
  if (Math.max(...amplitudes) < 1) return;
  if (!frame.reducedMotion) state.phase = ((state.phase ?? 0) + frame.dtSeconds * (1.2 + 2 * frame.energy)) % (Math.PI * 2);
  const phase = state.phase ?? 0;
  const xAt = (i) => inset + (span * i) / (RIBBON_POINTS - 1);

  ctx.beginPath();
  amplitudes.forEach((amplitude, i) => { ctx.lineTo(xAt(i), middle - amplitude); });
  for (let i = RIBBON_POINTS - 1; i >= 0; i--) ctx.lineTo(xAt(i), middle + amplitudes[i]);
  ctx.closePath();
  ctx.fillStyle = rgba(palette.accent, 0.08);
  ctx.fill();

  ctx.lineWidth = RIBBON_LINE_WIDTH;
  for (let strand = 0; strand < RIBBON_STRANDS; strand++) {
    const offset = (strand / RIBBON_STRANDS) * Math.PI;
    ctx.strokeStyle = rgba(strand % 2 === 0 ? palette.accent : palette.strong, 0.35 + 0.6 * (strand / (RIBBON_STRANDS - 1)));
    ctx.beginPath();
    amplitudes.forEach((amplitude, i) => {
      const twist = Math.sin(phase + offset + (i / (RIBBON_POINTS - 1)) * RIBBON_TWISTS * Math.PI * 2);
      ctx.lineTo(xAt(i), middle + amplitude * twist);
    });
    ctx.stroke();
  }
}

/** A glowing orb that swells with loudness, sending a ring outward on each beat. */
function drawOrb(ctx, frame) {
  const { width, height, palette, state } = frame;
  const size = Math.min(width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const limit = size * (0.5 - PAD_RATIO);
  const ringWidth = Math.max(1, size * 0.01);
  const radius = size * (0.1 + 0.1 * frame.energy + 0.06 * frame.bass);
  const glowRadius = Math.min(limit, radius * 1.35);
  // Silence fades the orb out, so a paused player shows nothing.
  const presence = Math.min(1, frame.energy * 4);

  state.rings ??= [];
  state.sinceSample = (state.sinceSample ?? BEAT_WINDOW_S) + frame.dtSeconds;
  state.sinceBeat = (state.sinceBeat ?? BEAT_MIN_GAP_S) + frame.dtSeconds;
  if (state.sinceSample >= BEAT_WINDOW_S) {
    const previous = state.previous ?? frame.values;
    let flux = 0;
    for (let i = 0; i < frame.values.length; i++) flux += Math.max(0, frame.values[i] - previous[i]);
    state.previous = Float32Array.from(frame.values);
    state.sinceSample = 0;
    if (!frame.reducedMotion && flux > BEAT_FLUX && state.sinceBeat >= BEAT_MIN_GAP_S) {
      state.sinceBeat = 0;
      state.rings.push({ radius, alpha: 0.55 });
    }
  }
  for (const ring of state.rings) {
    ring.radius += size * 0.35 * frame.dtSeconds;
    ring.alpha -= 0.9 * frame.dtSeconds;
  }
  state.rings = state.rings.filter((ring) => ring.alpha > 0.01 && ring.radius + ringWidth / 2 < limit);
  ctx.lineWidth = ringWidth;
  for (const ring of state.rings) {
    ctx.strokeStyle = rgba(palette.accent, ring.alpha * (1 - ring.radius / limit));
    ctx.beginPath();
    ctx.arc(centerX, centerY, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (presence < 0.01) return;
  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
  glow.addColorStop(0, rgba(palette.strong, 0.95 * presence));
  glow.addColorStop(0.55, rgba(palette.accent, 0.6 * presence));
  glow.addColorStop(1, rgba(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
  ctx.fill();
}

export const MODES = [
  { id: 'bars', label: 'Spectrum bars', draw: drawBars },
  { id: 'ring', label: 'Radial ring', draw: drawRing },
  { id: 'ribbon', label: 'Wave ribbon', draw: drawRibbon },
  { id: 'orb', label: 'Pulse orb', draw: drawOrb },
];

/** The loudness of all bands and of the lowest four, which the ring and the orb swell with. */
export function levelSummary(values) {
  return { energy: average(values, 0, values.length), bass: average(values, 0, Math.min(4, values.length)) };
}
