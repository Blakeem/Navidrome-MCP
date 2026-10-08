import { average, detectBeat, rgba } from '../visualizer-kit.js';

const TAU = Math.PI * 2;

// The sky is a small pixel field drawn scaled up. These cell sizes and caps keep it near 200 by 70 pixels.
const CELL_WIDTH = 2;
const CELL_HEIGHT = 2.4;
const MIN_COLUMNS = 24;
const MAX_COLUMNS = 220;
const MIN_ROWS = 12;
const MAX_ROWS = 72;
const MIN_SIDE = 12;
// The field sits this far inside the pad, so the scaled-up image never touches the pad line.
const EDGE_GAP = 1;
// Curtains thin out over this many pixels at each side, and the sky fades over these fractions at top and bottom.
const TAPER_PX = 64;
const MIN_TAPER = 0.07;
const MAX_TAPER = 0.2;
const TOP_FADE = 0.22;
const BOTTOM_FADE = 0.14;
// Two samples per column keep a curtain continuous where its folds stretch it sideways.
const SAMPLES_PER_COLUMN = 2;
// The shapes were tuned at about this width. A wider sky gets more folds and rays rather than wider ones.
const SHAPE_WIDTH_PX = 400;
const MIN_SHAPE_SCALE = 0.75;
const MAX_SHAPE_SCALE = 1.6;

// Slower than the host's smoothing, so the curtains breathe instead of flickering and fade after the music.
const BAND_ATTACK_PER_SECOND = 8;
const BAND_RELEASE_PER_SECOND = 3;
const PRESENCE_GAIN = 3.2;
// Below this the curtains are too faint to see, so the mode stops drawing and the animation can sleep.
const PRESENCE_CUTOFF = 0.012;

// The sky clock runs a little faster when the music is loud, so ripples quicken without ever rushing.
const CLOCK_RATE = 0.6;
const CLOCK_ENERGY_RATE = 0.8;
// One slow swing from green to violet and back. Bright, treble-heavy music pulls it toward violet.
const HUE_PERIOD_S = 36;
const HUE_FLOOR = 0.12;
const HUE_SWING = 0.7;
const CENTROID_PULL = 1.2;
const CENTROID_MIDDLE = 0.45;

// Altitude is measured in ray lengths above a curtain's lower edge.
const RAY_TOP = 1.6;
const RAY_FALLOFF = 2;
// Treble sharpens the rays into distinct streaks, and quiet passages blur them into a soft sheet.
const RAY_SHARPNESS = 1.6;
const RAY_TREBLE_SHARPNESS = 2.4;
// The lower edge is soft over this fraction of the sky's height, and its faint halo reaches this many soft widths down.
const EDGE_SOFT = 0.024;
const MIN_SOFT_ROWS = 0.7;
const HALO_REACH = 7;
// The lower edge follows ripples fixed to the sky, so the runs of a fold share one border and show no steps.
// A small part follows the curtain itself, so overlapping runs still part slightly.
const EDGE_WAVE = 0.07;
const EDGE_LAYER = 0.018;
const EDGE_SHIMMER = 0.012;
const BASS_DIP = 0.02;
const FOLD_WIDE_CYCLES = 1.3;
const FOLD_NARROW_CYCLES = 2.9;
const FOLD_NARROW_SHARE = 0.45;
// A fold turns the curtain back over itself. Each run between turns keeps its own channel, so every run shows its own edge.
const FOLD_CHANNELS = 4;
// Light piled into one column adds up softly, so a fold seen edge on glows without blowing out.
const FOLD_KNEE = 1.5;
const MIN_LIGHT = 0.004;

// A beat starts a brightening that runs out along one curtain both ways, the way an auroral surge spreads.
const MAX_SURGES = 6;
const SURGE_SPEED = 0.3;
const SURGE_WIDTH = 0.05;
const SURGE_SPREAD_PER_SECOND = 0.06;
const SURGE_RISE_PER_SECOND = 12;
const SURGE_DECAY_PER_SECOND = 1.3;
const SURGE_LIFE_S = 2.6;
const SURGE_MAX = 1.4;
const SURGE_GLOW = 0.8;
const SURGE_REACH = 0.45;
const FRONT = 2;
const BASS_BEAT = 0.55;
const FRONT_SHARE = 0.6;

const LUT_SIZE = 256;
const COLOR_STEPS = 32;
const BODY_ALTITUDE = 0.2;
const CROWN_ALTITUDE = 0.8;
// Light piles up softly into opacity, so even dense folds keep translucent edges.
const ALPHA_KNEE = 1.5;
const ALPHA_RANGE = 5;
const MIN_STRENGTH = 0.003;
const PILE_START = 1;

const STAR_AREA_PX = 2200;
const MAX_STARS = 36;
const STAR_RADIUS = 0.7;
const STAR_BUCKETS = 3;
const STAR_ALPHA = 0.6;
const STAR_COLOR = { r: 225, g: 235, b: 255 };

// Back to front. Higher curtains answer higher bands and lean violet, like the upper reaches of a real aurora.
const CURTAINS = [
  { base: 0.52, reach: 0.42, span: 0.88, fold: 0.05, gain: 0.62, from: 9, to: 16, violet: 0.3, seed: 2.3 },
  { base: 0.62, reach: 0.5, span: 0.98, fold: 0.065, gain: 0.85, from: 4, to: 11, violet: 0.14, seed: 4.9 },
  { base: 0.72, reach: 0.58, span: 1.08, fold: 0.08, gain: 1.15, from: 0, to: 7, violet: 0, seed: 0.7 },
];

// Additive light glows on the dark card. The white card gets deeper inks laid over it instead, since glow washes out there.
const LOOKS = {
  dark: {
    green: { edge: [170, 255, 150], body: [60, 250, 150], crown: [130, 95, 255] },
    violet: { edge: [90, 225, 255], body: [150, 110, 255], crown: [235, 95, 215] },
    fringe: [255, 90, 170],
    blend: 'lighter',
    pile: 0.35,
    opacity: 0.95,
    gain: 1,
    stars: true,
  },
  light: {
    green: { edge: [0, 155, 80], body: [0, 140, 95], crown: [115, 75, 200] },
    violet: { edge: [0, 120, 175], body: [105, 65, 205], crown: [185, 60, 165] },
    fringe: [205, 30, 110],
    blend: 'source-over',
    pile: -0.25,
    opacity: 0.9,
    gain: 1.2,
    stars: false,
  },
};

// Tables for the glow curves, so the per-pixel loop does no exponentials.
const ABOVE_GLOW = lookup((z) => Math.exp(-RAY_FALLOFF * z) * (1 - (z / RAY_TOP) ** 2), RAY_TOP);
const BELOW_GLOW = lookup((d) => (0.88 * Math.exp(-d * d) + 0.12 * Math.exp(-((d / 2.6) ** 2))) * (1 - d / HALO_REACH), HALO_REACH);
const OPACITY = lookup((a) => 1 - Math.exp(-ALPHA_KNEE * a), ALPHA_RANGE);

/** Aurora curtains that ripple and fold, with vertical rays that rise and brighten with the music and drift from green to violet. */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const music = listen(state, frame);
  const box = innerBox(frame);
  if (music.presence < PRESENCE_CUTOFF || box.width < MIN_SIDE || box.height < MIN_SIDE) {
    state.surges = [];
    return;
  }
  const look = LOOKS[frame.theme] ?? LOOKS.dark;
  const sky = advanceSky(state, frame, music, beat);
  const field = fieldFor(state, frame, box);

  paintField(field, music, sky, look);
  if (look.stars) drawStars(ctx, box, music.presence, sky.twinkle);
  ctx.globalCompositeOperation = look.blend;
  ctx.drawImage(field.layer.canvas, 0, 0, field.cols, field.rows, box.x, box.y, box.width, box.height);
  // The curtains fade with the mode's own slow bands after the music stops, so the host keeps drawing until they go.
  return true;
}

function innerBox(frame) {
  const inset = frame.pad + EDGE_GAP;
  return { x: inset, y: inset, width: frame.width - 2 * inset, height: frame.height - 2 * inset };
}

function listen(state, frame) {
  const count = frame.values.length;
  if (state.bands?.length !== count) state.bands = new Float32Array(count);
  const bands = state.bands;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    bands[i] = ease(bands[i], frame.values[i], frame.dtSeconds);
    weighted += i * bands[i];
    total += bands[i];
  }
  return {
    bands,
    energy: total / count,
    presence: Math.min(1, (total / count) * PRESENCE_GAIN),
    treble: average(bands, count - 5, count),
    centroid: total > 0 ? weighted / total / (count - 1) : CENTROID_MIDDLE,
    bass: frame.bass,
  };
}

function ease(current, target, dt) {
  const rate = target > current ? BAND_ATTACK_PER_SECOND : BAND_RELEASE_PER_SECOND;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function advanceSky(state, frame, music, beat) {
  const dt = frame.reducedMotion ? 0 : frame.dtSeconds;
  const surges = frame.reducedMotion ? [] : (state.surges ?? []);
  state.clock = (state.clock ?? 0) + dt * (CLOCK_RATE + CLOCK_ENERGY_RATE * music.energy);
  state.hueClock = (state.hueClock ?? 0) + dt;
  for (const surge of surges) surge.age += dt;
  state.surges = surges.filter((surge) => surge.age < SURGE_LIFE_S);
  if (beat && !frame.reducedMotion) addSurge(state, music);

  const swing = 0.5 - 0.5 * Math.cos((state.hueClock / HUE_PERIOD_S) * TAU);
  const drift = clamp(HUE_FLOOR + HUE_SWING * swing + CENTROID_PULL * (music.centroid - CENTROID_MIDDLE), 0, 1);
  return { clock: state.clock, twinkle: state.hueClock, drift, surges: state.surges };
}

// A bass-led beat mostly lights the low green curtain, and any other beat picks a curtain at random.
function addSurge(state, music) {
  state.seed = ((state.seed ?? 1) * 1664525 + 1013904223) >>> 0;
  const roll = state.seed / 2 ** 32;
  const curtain = music.bass > BASS_BEAT && roll < FRONT_SHARE ? FRONT : Math.floor(((roll * 13.7) % 1) * CURTAINS.length);
  const origin = 0.2 + 0.6 * ((roll * 7.31) % 1);
  state.surges.push({ curtain, origin, age: 0 });
  if (state.surges.length > MAX_SURGES) state.surges.shift();
}

function fieldFor(state, frame, box) {
  const current = state.field;
  if (current !== undefined && current.width === frame.width && current.height === frame.height) return current;
  const wantColumns = clamp(Math.round(box.width / CELL_WIDTH), MIN_COLUMNS, MAX_COLUMNS);
  const wantRows = clamp(Math.round(box.height / CELL_HEIGHT), MIN_ROWS, MAX_ROWS);
  const layer = frame.createLayer(wantColumns, wantRows);
  // The layer holds device pixels, so a device scale under 1 makes it smaller than asked and the grid shrinks to fit.
  const cols = Math.min(wantColumns, layer.canvas.width);
  const rows = Math.min(wantRows, layer.canvas.height);
  const taper = clamp(TAPER_PX / box.width, MIN_TAPER, MAX_TAPER);
  state.field = {
    width: frame.width,
    height: frame.height,
    cols,
    rows,
    layer,
    image: layer.ctx.createImageData(cols, rows),
    glow: { r: new Float32Array(cols * rows), g: new Float32Array(cols * rows), b: new Float32Array(cols * rows), a: new Float32Array(cols * rows) },
    curtains: CURTAINS.map(() => curtainColumns(cols)),
    colors: new Float32Array(COLOR_STEPS * 3),
    taperX: Float32Array.from({ length: cols }, (_, c) => smoothstep((c + 0.5) / cols / taper) * smoothstep((1 - (c + 0.5) / cols) / taper)),
    taperY: Float32Array.from({ length: rows }, (_, r) => smoothstep((r + 0.5) / rows / TOP_FADE) * smoothstep((1 - (r + 0.5) / rows) / BOTTOM_FADE)),
    shapeScale: clamp(box.width / SHAPE_WIDTH_PX, MIN_SHAPE_SCALE, MAX_SHAPE_SCALE),
  };
  return state.field;
}

function curtainColumns(cols) {
  const size = cols * FOLD_CHANNELS;
  return { weight: new Float32Array(size), light: new Float32Array(size), edge: new Float32Array(size), reach: new Float32Array(size), fringe: new Float32Array(size) };
}

function paintField(field, music, sky, look) {
  const { glow } = field;
  glow.r.fill(0);
  glow.g.fill(0);
  glow.b.fill(0);
  glow.a.fill(0);
  CURTAINS.forEach((spec, index) => {
    const columns = field.curtains[index];
    paintColors(field.colors, look, clamp(sky.drift + spec.violet, 0, 1));
    gatherCurtain(columns, spec, index, field, music, sky);
    shadeCurtain(field, columns, spec.gain * look.gain * music.presence, look.fringe);
  });
  writePixels(field, look);
}

// Altitude colors for one curtain, each stop mixed between the green and the violet palettes by the drift.
function paintColors(colors, look, drift) {
  for (let step = 0; step < COLOR_STEPS; step++) {
    const altitude = (step / (COLOR_STEPS - 1)) * RAY_TOP;
    const low = altitude < BODY_ALTITUDE;
    const t = low ? altitude / BODY_ALTITUDE : Math.min(1, (altitude - BODY_ALTITUDE) / (CROWN_ALTITUDE - BODY_ALTITUDE));
    const from = low ? 'edge' : 'body';
    const to = low ? 'body' : 'crown';
    for (let channel = 0; channel < 3; channel++) {
      const start = mix(look.green[from][channel], look.violet[from][channel], drift);
      const end = mix(look.green[to][channel], look.violet[to][channel], drift);
      colors[step * 3 + channel] = mix(start, end, t);
    }
  }
}

// Samples along the curtain land in the columns under them, so where a fold doubles the curtain back its light piles up.
function gatherCurtain(columns, spec, index, field, music, sky) {
  const { cols, shapeScale: scale } = field;
  const samples = cols * SAMPLES_PER_COLUMN;
  // Each sample carries an equal share, so a flat curtain gives every column a weight of 1.
  const share = cols / samples;
  const level = average(music.bands, spec.from, spec.to);
  const sharpness = RAY_SHARPNESS + RAY_TREBLE_SHARPNESS * music.treble;
  const phase = sky.clock + spec.seed;
  const wideReach = spec.fold / scale;
  const narrowReach = (FOLD_NARROW_SHARE * spec.fold) / scale;
  const wideRate = TAU * FOLD_WIDE_CYCLES * scale;
  const narrowRate = TAU * FOLD_NARROW_CYCLES * scale;
  let run = 0;
  let wasRising = null;
  for (const values of Object.values(columns)) values.fill(0);

  for (let j = 0; j < samples; j++) {
    const s = j / (samples - 1);
    const wideAngle = wideRate * s + phase * 0.21;
    const narrowAngle = narrowRate * s - phase * 0.13 + 1.1;
    const x = 0.5 + (s - 0.5) * spec.span + wideReach * Math.sin(wideAngle) + narrowReach * Math.sin(narrowAngle);
    const slope = spec.span + wideReach * wideRate * Math.cos(wideAngle) + narrowReach * narrowRate * Math.cos(narrowAngle);
    const surge = surgeAt(s, index, sky.surges);
    const local = 0.6 * level + 0.4 * bandAcross(music.bands, spec, s);
    const ray = rayAt(s, phase, scale, sharpness);
    const light = (0.2 + 1.1 * local) * (0.3 + 0.7 * ray) * (1 + SURGE_GLOW * surge);
    const edge = edgeAt(x, s, spec.base, phase, scale, level, music.bass);
    const reach = spec.reach * (0.55 + 0.45 * ray) * (0.55 + 0.6 * local) * (1 + SURGE_REACH * surge);
    const position = x * cols - 0.5;
    const left = Math.floor(position);
    const right = position - left;
    const rising = slope >= 0;
    if (wasRising !== null && rising !== wasRising) run += 1;
    wasRising = rising;
    const channel = (run % FOLD_CHANNELS) * cols;
    for (let side = 0; side < 2; side++) {
      const column = left + side;
      const weight = share * (side === 0 ? 1 - right : right);
      if (column < 0 || column >= cols || weight <= 0) continue;
      const at = channel + column;
      columns.weight[at] += weight;
      columns.light[at] += weight * light;
      columns.edge[at] += weight * edge;
      columns.reach[at] += weight * reach;
      columns.fringe[at] += weight * surge;
    }
  }
}

// The curtain's middle answers the lowest band of its range and its ends the highest.
function bandAcross(bands, spec, s) {
  const position = spec.from + Math.abs(2 * s - 1) * (spec.to - 1 - spec.from);
  const index = Math.floor(position);
  const next = Math.min(spec.to - 1, index + 1);
  return bands[index] + (bands[next] - bands[index]) * (position - index);
}

// Three striations at unrelated spacings drift along the curtain at different speeds, so the rays slide and shimmer
// without a regular comb. A slow swell gathers them into brighter clusters.
function rayAt(s, phase, scale, sharpness) {
  const striation = 0.4 * Math.sin(TAU * 7.3 * scale * s + phase * 0.7)
    + 0.35 * Math.sin(TAU * 17.9 * scale * s - phase * 1.2 + 1.7)
    + 0.25 * Math.sin(TAU * 37.1 * scale * s + phase * 2 + 4.1);
  const cluster = 0.6 + 0.4 * Math.sin(TAU * 2.2 * scale * s + phase * 0.3);
  return cluster * (0.5 + 0.5 * striation) ** sharpness;
}

// Two slow ripples travel across the sky, a fine shimmer rides them with the music, and the bass presses the edge down.
function edgeAt(x, s, base, phase, scale, level, bass) {
  const ripple = 0.6 * Math.sin(TAU * 0.8 * scale * x + phase * 0.55) + 0.4 * Math.sin(TAU * 2.3 * scale * x - phase * 0.9);
  const layer = Math.sin(TAU * 1.7 * scale * s + phase * 0.4);
  const shimmer = level * Math.sin(TAU * 6 * scale * x + phase * 2.4);
  return base + EDGE_WAVE * ripple + EDGE_LAYER * layer + EDGE_SHIMMER * shimmer + BASS_DIP * bass;
}

function surgeAt(s, index, surges) {
  let total = 0;
  for (const surge of surges) {
    if (surge.curtain !== index) continue;
    const spread = SURGE_WIDTH + SURGE_SPREAD_PER_SECOND * surge.age;
    const travel = SURGE_SPEED * surge.age;
    const ahead = (s - surge.origin - travel) / spread;
    const behind = (s - surge.origin + travel) / spread;
    // A short rise keeps the onset a swell rather than a flash.
    const strength = (1 - Math.exp(-SURGE_RISE_PER_SECOND * surge.age)) * Math.exp(-SURGE_DECAY_PER_SECOND * surge.age);
    total += strength * (Math.exp(-ahead * ahead) + Math.exp(-behind * behind));
  }
  return Math.min(SURGE_MAX, total);
}

// Each column glows brightest just above its lower edge and fades up the rays, with a thin soft halo below.
function shadeCurtain(field, columns, gain, fringeColor) {
  const { cols, rows, colors, taperX, glow } = field;
  const softRows = Math.max(MIN_SOFT_ROWS, EDGE_SOFT * rows);
  for (let at = 0; at < cols * FOLD_CHANNELS; at++) {
    const weight = columns.weight[at];
    if (weight <= 0) continue;
    const col = at % cols;
    const density = (weight * (1 + FOLD_KNEE)) / (weight + FOLD_KNEE);
    const light = (columns.light[at] / weight) * density * gain * taperX[col];
    if (light < MIN_LIGHT) continue;
    const edgeRow = (columns.edge[at] / weight) * rows;
    const reachRows = Math.max(1, (columns.reach[at] / weight) * rows);
    // The halo under the edge takes on a pink fringe while a surge passes, as a bright aurora's lower border does.
    const fringe = Math.min(1, columns.fringe[at] / weight);
    const belowR = mix(colors[0], fringeColor[0], fringe);
    const belowG = mix(colors[1], fringeColor[1], fringe);
    const belowB = mix(colors[2], fringeColor[2], fringe);
    const top = Math.max(0, Math.floor(edgeRow - reachRows * RAY_TOP));
    const bottom = Math.min(rows, Math.ceil(edgeRow + softRows * HALO_REACH));
    for (let row = top; row < bottom; row++) {
      const above = edgeRow - (row + 0.5);
      const cell = row * cols + col;
      if (above >= 0) {
        const altitude = above / reachRows;
        const shade = Math.min(COLOR_STEPS - 1, ((altitude / RAY_TOP) * (COLOR_STEPS - 1)) | 0) * 3;
        addLight(glow, cell, light * read(ABOVE_GLOW, altitude), colors[shade], colors[shade + 1], colors[shade + 2]);
      } else {
        addLight(glow, cell, light * read(BELOW_GLOW, -above / softRows), belowR, belowG, belowB);
      }
    }
  }
}

function addLight(glow, cell, strength, r, g, b) {
  glow.r[cell] += strength * r;
  glow.g[cell] += strength * g;
  glow.b[cell] += strength * b;
  glow.a[cell] += strength;
}

// Where curtains pile up, the dark theme burns toward white and the light theme deepens the ink.
function writePixels(field, look) {
  const { cols, rows, glow, taperY, image } = field;
  const data = image.data;
  for (let row = 0; row < rows; row++) {
    const taper = taperY[row];
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      const out = cell * 4;
      const weight = glow.a[cell];
      const strength = weight * taper;
      if (strength < MIN_STRENGTH) {
        data[out + 3] = 0;
        continue;
      }
      const pile = look.pile * clamp(weight - PILE_START, 0, 1);
      const r = glow.r[cell] / weight;
      const g = glow.g[cell] / weight;
      const b = glow.b[cell] / weight;
      data[out] = pile > 0 ? r + (255 - r) * pile : r * (1 + pile);
      data[out + 1] = pile > 0 ? g + (255 - g) * pile : g * (1 + pile);
      data[out + 2] = pile > 0 ? b + (255 - b) * pile : b * (1 + pile);
      data[out + 3] = read(OPACITY, strength) * look.opacity * 255;
    }
  }
  field.layer.ctx.putImageData(image, 0, 0);
}

// A faint field of stars behind the curtains on the dark theme, grouped by twinkle so each group is one fill.
function drawStars(ctx, box, presence, twinkle) {
  const count = Math.min(MAX_STARS, Math.round((box.width * box.height) / STAR_AREA_PX));
  for (let bucket = 0; bucket < STAR_BUCKETS; bucket++) {
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const glint = 0.5 + 0.5 * Math.sin(twinkle * (0.6 + 1.4 * hash(i, 3)) + hash(i, 4) * TAU);
      if (Math.min(STAR_BUCKETS - 1, Math.floor(glint * STAR_BUCKETS)) !== bucket) continue;
      const x = box.x + box.width * (0.06 + 0.88 * hash(i, 1));
      const y = box.y + box.height * (0.1 + 0.5 * hash(i, 2));
      ctx.moveTo(x + STAR_RADIUS, y);
      ctx.arc(x, y, STAR_RADIUS, 0, TAU);
    }
    ctx.fillStyle = rgba(STAR_COLOR, (presence * STAR_ALPHA * (bucket + 1)) / STAR_BUCKETS);
    ctx.fill();
  }
}

function lookup(curve, range) {
  const table = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) table[i] = curve((i / LUT_SIZE) * range);
  return { table, scale: LUT_SIZE / range };
}

function read(table, x) {
  return table.table[Math.min(LUT_SIZE - 1, (x * table.scale) | 0)];
}

function hash(index, salt) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(x) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(from, to, t) {
  return from + (to - from) * t;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export default { label: 'Aurora', draw };
