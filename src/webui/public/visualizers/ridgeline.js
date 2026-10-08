import { average, detectBeat, hslOf, resample } from '../visualizer-kit.js';

// The ridges hold this much music. The oldest leaves the back well inside the 3 s release.
const HISTORY_SECONDS = 2.4;
// Rows over the history at full density, about 14 a second.
const HISTORY_ROWS = 34;
const ROW_SECONDS = HISTORY_SECONDS / HISTORY_ROWS;
const POINT_SPACING_PX = 4;
const MIN_POINTS = 40;
const MAX_POINTS = 200;
const CURVE_POINTS = 24;
// A ridge at depth d is drawn at 1 / (1 + PERSPECTIVE * d) of its near size. Mild, so the stack keeps the album cover's density.
const PERSPECTIVE = 0.65;
// Taller than half the area, so near peaks rise over the far rows and hide them.
const NEAR_AMPLITUDE = 0.62;
// Closer ridges merge into a gray band, so a short strip captures fewer and longer rows.
const MIN_ROW_GAP_PX = 2.4;
// The spectrum spans this central share of each ridge with bass in the middle, and the rest stays flat like the pulsar plot.
const ACTIVE_WIDTH = 0.82;
// The treble end eases into the flat flank from here, so a ridge has no kink where the spectrum stops.
const TAPER_START = 0.7;
// Grain scales with the level, so peaks look like jagged pulsar traces and silence stays a straight line.
const JITTER = 0.1;
const FLANK_NOISE = 0.035;
// The share of each ridge's length that fades in at either end, so the flanks melt into the card.
const EDGE_FADE = 0.14;
// Far ridges dim by this much before they vanish, so depth reads as haze.
const FOG = 0.55;
const VANISH_START = 0.8;
const PRESENCE_GAIN = 4;
// The fraction of the landscape's brightness left one second after the music stops.
const RELEASE_PER_SECOND = 0.12;
const MIN_GLOW = 0.01;
// An 8-bit channel rounds a fainter alpha to nothing, so such paints are skipped.
const MIN_ALPHA = 0.004;
// A beat lights a few rows that then travel back through the landscape as a band.
const KICK_DECAY_PER_SECOND = 7;
// Hue added at full flash. The rows pass through magenta on the way, so a beat band cools as it recedes.
const FLASH_HUE_SHIFT = 165;
const FAR_HUE_SHIFT = 25;
const FLASH_WIDTH = 0.3;
const LIVE_WIDTH = 1.25;
// The vanishing point drifts by this share of the half width, so far rows slide against near ones.
const SWAY_FRACTION = 0.5;
const SWAY_RADIANS_PER_SECOND = 0.16;
const LINE_WIDTH_RATIO = 0.0085;
const MIN_LINE_WIDTH = 1;
const MAX_LINE_WIDTH = 2.2;
const GLOW_WIDTH_RATIO = 3;
// The widest stroke, a flashed glow on the nearest ridge, as a multiple of the base line width.
const MAX_WIDTH_RATIO = LIVE_WIDTH * (1 + FLASH_WIDTH) * GLOW_WIDTH_RATIO;
const SKY_WIDTH = 0.85;

// Pale lines on the dark card like the album cover. Deep ink on the light card, where glow would wash out.
const INKS = {
  dark: {
    near: { saturation: 45, lightness: 93 },
    far: { saturation: 85, lightness: 60 },
    flash: { saturation: 100, lightness: 66 },
    tint: 0.16,
    glow: 0.12,
    glowFlash: 0.4,
    glowMode: 'lighter',
    sky: 0.22,
  },
  light: {
    near: { saturation: 75, lightness: 22 },
    far: { saturation: 60, lightness: 55 },
    flash: { saturation: 92, lightness: 44 },
    tint: 0.09,
    glow: 0.04,
    glowFlash: 0.16,
    glowMode: 'source-over',
    sky: 0.07,
  },
};

/**
 * A ridgeline landscape in the style of the Unknown Pleasures cover. Each row is the spectrum from a moment in
 * the last few seconds, mirrored out from the bass at the center, and the rows recede in depth so nearer peaks
 * hide the ridges behind them. Beats light rows that travel back into the haze.
 */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  // Silence fades the landscape out with the music, so a paused player shows nothing.
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  state.glow = Math.max((state.glow ?? 0) * RELEASE_PER_SECOND ** frame.dtSeconds, presence);
  if (state.glow < MIN_GLOW) {
    state.history = undefined;
    return undefined;
  }
  const scene = layoutScene(frame);
  if (scene === null) return undefined;

  const history = advanceHistory(state, frame, beat, scene.stride);
  const look = { ink: frame.theme === 'light' ? INKS.light : INKS.dark, hue: hslOf(frame.palette.accent).hue, fade: state.glow };
  const swayX = SWAY_FRACTION * scene.halfWidth * Math.sin(history.sway);
  drawSky(ctx, scene, look, history, frame, swayX);
  drawLandscape(ctx, scene, look, history, frame, swayX);
  // The ridges outlast the music, so the host keeps drawing until they fade.
  return true;
}

function layoutScene(frame) {
  const { width, height, pad } = frame;
  const lineWidth = clamp(Math.min(width, height) * LINE_WIDTH_RATIO, MIN_LINE_WIDTH, MAX_LINE_WIDTH);
  // Every stroke is centered on its ridge, so the ridges keep half the widest stroke and a pixel clear of the pad.
  const inset = pad + (lineWidth * MAX_WIDTH_RATIO) / 2 + 1;
  const top = inset;
  const bottom = height - inset;
  const span = width - 2 * inset;
  if (span < 1 || bottom - top < 1) return null;
  const nearAmplitude = (bottom - top) * NEAR_AMPLITUDE;
  const farScale = scaleAt(1);
  // The ground's vanishing line sits where the farthest ridge at full level just reaches the top.
  const horizon = (top - farScale * (bottom - nearAmplitude)) / (1 - farScale);
  const midScale = scaleAt(0.5);
  const midGap = (bottom - horizon) * PERSPECTIVE * midScale * midScale * (ROW_SECONDS / HISTORY_SECONDS);
  return {
    top,
    bottom,
    centerX: width / 2,
    halfWidth: span / 2,
    horizon,
    nearAmplitude,
    lineWidth,
    pointCount: Math.round(clamp(span / POINT_SPACING_PX, MIN_POINTS, MAX_POINTS)),
    stride: Math.max(1, Math.ceil(MIN_ROW_GAP_PX / midGap)),
  };
}

function advanceHistory(state, frame, beat, stride) {
  const history = (state.history ??= newHistory(frame.values.length));
  const dt = frame.dtSeconds;
  history.time += dt;
  history.kick = beat ? 1 : history.kick * Math.exp(-KICK_DECAY_PER_SECOND * dt);
  if (!frame.reducedMotion) history.sway = (history.sway + dt * SWAY_RADIANS_PER_SECOND) % (Math.PI * 2);
  for (let i = 0; i < frame.values.length; i++) history.pending[i] = Math.max(history.pending[i], frame.values[i]);
  history.pendingFlash = Math.max(history.pendingFlash, history.kick);
  history.sinceCapture += dt;
  captureRows(history, ROW_SECONDS * stride);
  dropFarRows(history, frame.reducedMotion);
  return history;
}

function newHistory(bandCount) {
  return { rows: [], seq: 0, time: 0, lastBorn: 0, sinceCapture: 0, pending: new Float32Array(bandCount), pendingFlash: 0, kick: 0, sway: 0 };
}

// Each row keeps the loudest level of every band over its interval, so a kick between captures still shows.
function captureRows(history, interval) {
  if (history.sinceCapture < interval) return;
  const curve = resample(history.pending, CURVE_POINTS);
  const energy = average(history.pending, 0, history.pending.length);
  const flash = history.pendingFlash;
  while (history.sinceCapture >= interval) {
    history.sinceCapture -= interval;
    history.seq += 1;
    history.lastBorn = history.time - history.sinceCapture;
    history.rows.push({ seed: history.seq, born: history.lastBorn, curve, energy, flash, live: false });
  }
  history.pending.fill(0);
  history.pendingFlash = 0;
}

function dropFarRows(history, reducedMotion) {
  while (history.rows.length > 0 && rowDepth(history, history.rows[0], reducedMotion) >= 1) history.rows.shift();
}

// Under reduced motion the rows hold still between captures and step back one slot at each.
function rowDepth(history, row, reducedMotion) {
  const now = reducedMotion ? history.lastBorn : history.time;
  return (now - row.born) / HISTORY_SECONDS;
}

// The nearest ridge follows the levels every frame and carries the seed of the row it becomes, so the hand-off keeps its grain.
function liveRow(history, frame) {
  return { seed: history.seq + 1, born: history.time, curve: resample(frame.values, CURVE_POINTS), energy: frame.energy, flash: history.kick, live: true };
}

// A dome of light behind the far ridges that swells on beats. The ridges erase its lower half, so it shows only as sky.
function drawSky(ctx, scene, look, history, frame, swayX) {
  const farScale = scaleAt(1);
  const centerY = baseAt(scene, 1);
  const strength = look.ink.sky * look.fade * Math.min(1, frame.energy * 1.5 + history.kick * 0.5);
  if (strength < MIN_ALPHA) return;
  const tone = toneAt(look, 1, history.kick * 0.5);
  ctx.save();
  ctx.translate(scene.centerX + swayX * (1 - farScale), centerY);
  ctx.scale(scene.halfWidth * farScale * SKY_WIDTH, centerY - scene.top);
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  light.addColorStop(0, hsla(tone, strength));
  light.addColorStop(0.55, hsla(tone, strength * 0.35));
  light.addColorStop(1, hsla(tone, 0));
  ctx.fillStyle = light;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

// Back to front, each ridge erases everything under its line down to the next ridge's ground, so nearer peaks hide the rows behind.
function drawLandscape(ctx, scene, look, history, frame, swayX) {
  const ridges = history.rows.map((row) => ({ row, depth: rowDepth(history, row, frame.reducedMotion) }));
  ridges.push({ row: liveRow(history, frame), depth: 0 });
  const xs = new Float32Array(scene.pointCount);
  const ys = new Float32Array(scene.pointCount);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = 0; i < ridges.length; i++) {
    const { row, depth } = ridges[i];
    const placement = placeRidge(scene, depth, swayX);
    const floor = i + 1 < ridges.length ? baseAt(scene, ridges[i + 1].depth) : placement.base;
    const alpha = ridgeAlpha(row, depth, look.fade);
    traceRidge(placement, row, xs, ys);
    traceGround(ctx, xs, ys, floor);
    eraseBehind(ctx);
    if (alpha < MIN_ALPHA) continue;
    const tone = toneAt(look, depth, row.flash);
    shadeGround(ctx, placement, tone, alpha, look.ink);
    strokeRidge(ctx, scene, placement, xs, ys, tone, alpha, row, look.ink);
  }
}

function placeRidge(scene, depth, swayX) {
  const scale = scaleAt(depth);
  return {
    scale,
    base: baseAt(scene, depth),
    amplitude: scene.nearAmplitude * scale,
    centerX: scene.centerX + swayX * (1 - scale),
    halfWidth: scene.halfWidth * scale,
  };
}

function scaleAt(depth) {
  return 1 / (1 + PERSPECTIVE * depth);
}

function baseAt(scene, depth) {
  return scene.horizon + (scene.bottom - scene.horizon) * scaleAt(depth);
}

// Far ridges dim into haze and vanish at the back. The ridge's own loudness and the release set the rest.
function ridgeAlpha(row, depth, fade) {
  const haze = (1 - FOG * depth) * (1 - smoothstep(VANISH_START, 1, depth));
  return Math.min(1, row.energy * PRESENCE_GAIN) * haze * fade;
}

// The spectrum mirrors out from the bass at the center, so peaks crowd the middle like the pulsar plot.
function traceRidge(placement, row, xs, ys) {
  const last = xs.length - 1;
  const loudness = Math.min(1, row.energy * PRESENCE_GAIN);
  for (let k = 0; k <= last; k++) {
    const across = (2 * k) / last - 1;
    const spread = Math.abs(across) / ACTIVE_WIDTH;
    const spectrum = spread < 1 ? sampleCurve(row.curve, spread) * taper(spread) : 0;
    const grain = grainAt(row.seed, k);
    const flank = FLANK_NOISE * loudness * grain * (1 - across * across);
    const level = clamp(spectrum * (1 + JITTER * (2 * grain - 1)) + flank, 0, 1);
    xs[k] = placement.centerX + across * placement.halfWidth;
    ys[k] = placement.base - placement.amplitude * level;
  }
}

function traceGround(ctx, xs, ys, floor) {
  const last = xs.length - 1;
  ctx.beginPath();
  ctx.moveTo(xs[0], floor);
  for (let k = 0; k <= last; k++) ctx.lineTo(xs[k], ys[k]);
  ctx.lineTo(xs[last], floor);
  ctx.closePath();
}

function eraseBehind(ctx) {
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fill();
}

// The haze is strongest at the ridge's full height, so loud crests glow and quiet stretches stay clear.
function shadeGround(ctx, placement, tone, alpha, ink) {
  const haze = ctx.createLinearGradient(0, placement.base - placement.amplitude, 0, placement.base);
  haze.addColorStop(0, hsla(tone, ink.tint));
  haze.addColorStop(1, hsla(tone, 0));
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = haze;
  ctx.fill();
}

function strokeRidge(ctx, scene, placement, xs, ys, tone, alpha, row, ink) {
  const last = xs.length - 1;
  const coreWidth = scene.lineWidth * (row.live ? LIVE_WIDTH : placement.scale) * (1 + FLASH_WIDTH * row.flash);
  const glowAlpha = Math.min(1, alpha * (ink.glow + ink.glowFlash * row.flash));
  const line = ctx.createLinearGradient(xs[0], 0, xs[last], 0);
  line.addColorStop(0, hsla(tone, 0));
  line.addColorStop(EDGE_FADE, hsla(tone, 1));
  line.addColorStop(1 - EDGE_FADE, hsla(tone, 1));
  line.addColorStop(1, hsla(tone, 0));
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let k = 1; k <= last; k++) ctx.lineTo(xs[k], ys[k]);
  ctx.strokeStyle = line;
  if (glowAlpha >= MIN_ALPHA) {
    ctx.globalCompositeOperation = ink.glowMode;
    ctx.globalAlpha = glowAlpha;
    ctx.lineWidth = coreWidth * GLOW_WIDTH_RATIO;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.lineWidth = coreWidth;
  ctx.stroke();
}

function toneAt(look, depth, flash) {
  const { near, far, flash: hot } = look.ink;
  return {
    hue: look.hue + FAR_HUE_SHIFT * depth + FLASH_HUE_SHIFT * flash,
    saturation: lerp(lerp(near.saturation, far.saturation, depth), hot.saturation, flash),
    lightness: lerp(lerp(near.lightness, far.lightness, depth), hot.lightness, flash),
  };
}

function hsla(tone, alpha) {
  return `hsla(${(tone.hue % 360).toFixed(1)}, ${tone.saturation.toFixed(1)}%, ${tone.lightness.toFixed(1)}%, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function sampleCurve(curve, position) {
  const scaled = position * (curve.length - 1);
  const index = Math.min(curve.length - 2, Math.floor(scaled));
  const t = scaled - index;
  return curve[index] + (curve[index + 1] - curve[index]) * t;
}

function taper(spread) {
  if (spread <= TAPER_START) return 1;
  return 0.5 + 0.5 * Math.cos((Math.PI * (spread - TAPER_START)) / (1 - TAPER_START));
}

// A fixed hash of the row and the point, so each ridge keeps its grain as it travels back.
function grainAt(seed, index) {
  const wave = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return wave - Math.floor(wave);
}

function smoothstep(from, to, value) {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export default { label: 'Pulsar ridgeline', draw };
