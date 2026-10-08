import { detectBeat } from '../visualizer-kit.js';

// Plate modes in rising pitch order, each [n, m, sign] in u = cos(n pi x) cos(m pi y) + sign cos(m pi x) cos(n pi y).
// x and y run from the plate's center in units of its short side, so every figure is mirrored about the center.
// A plate's pitch grows with n squared plus m squared, which sets the order.
const MODES = [
  [1, 2, 1], [1, 2, -1], [1, 3, 1], [2, 3, 1], [2, 3, -1], [1, 4, -1], [3, 4, 1], [1, 5, 1],
  [2, 5, 1], [3, 5, -1], [4, 5, 1], [4, 5, -1], [5, 6, 1], [4, 7, -1], [5, 7, -1], [6, 7, 1],
];
// Each unit of a mode's highest order needs this much of the short side, so the finest figure still reads as sand.
const PX_PER_ORDER = 9;

// The sand shows fully once the average level passes a quarter, and keeps this fraction a second after silence.
const PRESENCE_GAIN = 4;
const FADE_RETAIN_PER_SECOND = 0.08;
const VISIBLE_FLOOR = 0.01;

// The grain count is this times the plate area over its short side, which tracks the total length of nodal line,
// so the lines hold as many grains per pixel at any size.
const GRAIN_DENSITY = 5.6;
const MIN_GRAINS = 300;
// The cap keeps the wide desktop area as light as the default one.
const MAX_GRAINS = 2600;
const GRAIN_PX = 1.25;
// Sparser sand on a wide plate draws as coarser grains, so its lines still read.
const MAX_GRAIN_PX = 1.8;
const GRAIN_PX_PER_SPACING = 0.24;
const AIR_GROWTH_PX = 1.2;
const LOW_HOP_GROWTH = 0.4;
// Room between the pad and the plate edge for the largest airborne grain.
const PLATE_INSET_PX = 2.5;
// A plate shorter than this cannot hold even the simplest figure.
const MIN_PLATE_PX = 16;
// The sand thins out over this fraction of the short side at every edge, so the plate shows no box.
const EDGE_FADE = 0.17;
// Sand that comes to rest this far into the edge fade falls off the free edge and is sprinkled back on. Modes with
// a nodal line along the edge would otherwise pile sand into a faint frame.
const SPILL_SHARE = 0.3;

// The plate swings harder with loudness and reaches full drive near an average level of 0.6.
const DRIVE_GAIN = 1.7;
// Grains slide toward the nearest nodal line at this rate per second, capped in short sides per second.
const SETTLE_RATE = 4;
const SETTLE_SPEED = 0.7;
// Random-walk strength in short sides per root second. Antinodes throw grains hardest, and the floor keeps lines grainy.
const JITTER_LINE = 0.014;
const JITTER_ANTINODE = 0.09;
// Creep along a nodal line spreads the sand evenly along it without widening the line.
const JITTER_ALONG = 0.035;
// A uniform step this wide has a standard deviation of 1.
const NOISE_SPAN = 3.46;
// Each grain rests at its own fixed offset across a nodal line, so a line keeps a grainy width with no jitter.
const LINE_WIDTH = 0.012;
const MIN_LINE_WIDTH_PX = 1.2;
// Near a peak of the field the gradient vanishes, and a Newton step there would fly off.
const MIN_GRADIENT_SQ = 1e-8;
// Below this share of the peak swing a grain counts as resting on a nodal line.
const SETTLED_SWING = 0.1;

// The loudest band is read from a spectrum smoothed over this time, and a new pattern must lead this long to take over.
const SPECTRUM_SMOOTH_S = 0.45;
const MODE_LEAD_S = 0.5;
// A pattern holds at least this long, so the sand has time to gather into it.
const MODE_DWELL_S = 2.6;
const HUE_EASE_S = 0.6;
// Pitch colors the sand from amber for the bass through rose and violet to cyan for the treble, skipping green.
const HUE_LOW = 40;
const HUE_HIGH = -175;

// A beat strikes the plate's center, and the bending wave reaches the far corner in this time.
const WAVE_CROSS_S = 0.45;
const MAX_WAVES = 3;
// A beat strikes harder with more bass.
const BEAT_BASE = 0.45;
const BEAT_BASS = 0.7;
// The strike weakens toward the far corner by this fraction.
const REACH_FALLOFF = 0.5;
const RING_WIDTH = 0.045;
// Hop units: a full-strength hop rises to height 1 and lands 0.4 seconds later.
const GRAVITY = 50;
const HOP_SPEED = 10;
// Above this height a grain draws at its largest, nearest to the viewer.
const AIR_HIGH = 0.45;
// Sideways throw of a full-strength hop in short sides per second. Its direction is random, since a push away
// from the strike on every beat would drain the sand from the center.
const SCATTER_SPEED = 0.2;
const GROUND_FRICTION = 12;
const WALL_BOUNCE = 0.4;

// The plate's standing wave shows slowed to a visible rate that rises with the mode's pitch.
const SWING_HZ_LOW = 0.7;
const SWING_HZ_HIGH = 2.2;
const SWING_BASE = 0.45;
const SWING_DECAY_PER_SECOND = 3.5;
// The shown wave crossfades between figures this long, while the sand itself jumps at once like a real plate.
const SWITCH_BLEND_S = 0.4;

// The glow grid stays under 200 by 100 cells, and the glow is soft enough that a cell can span 2.5 pixels.
const GRID_MAX_COLS = 200;
const GRID_MAX_ROWS = 100;
const GRID_MIN_CELL_PX = 2.5;
const DENSITY_GAIN = 20;
// Sand resting on a nodal line glows fully, so loose and airborne sand adds only a little haze.
const LOOSE_DENSITY = 0.3;
const AIR_DENSITY = 0.5;
// Cells wider than this already blur the glow, so they take the narrow kernel.
const WIDE_CELL_PX = 3.5;
const BLUR_WIDE = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
const BLUR_NARROW = [1 / 4, 2 / 4, 1 / 4];

// Glowing sand on a black plate for the dark theme, ink on paper like Chladni's own engravings for the light one.
const LOOKS = {
  dark: {
    blend: 'lighter',
    loose: { hue: 0, sat: 55, light: 74, alpha: 0.42 },
    settled: { hue: 0, sat: 65, light: 88, alpha: 0.95 },
    air: { hue: 15, sat: 90, light: 92, alpha: 1 },
    glow: { hue: 0, sat: 90, light: 60, alpha: 0.6 },
    crest: { hue: 35, sat: 85, light: 55, alpha: 0.22 },
    trough: { hue: -35, sat: 80, light: 52, alpha: 0.22 },
    ring: { hue: 30, sat: 100, light: 75, alpha: 0.3 },
  },
  light: {
    blend: 'source-over',
    loose: { hue: 0, sat: 50, light: 42, alpha: 0.38 },
    settled: { hue: 0, sat: 80, light: 22, alpha: 0.92 },
    air: { hue: 15, sat: 80, light: 40, alpha: 0.75 },
    glow: { hue: 0, sat: 75, light: 42, alpha: 0.3 },
    crest: { hue: 35, sat: 80, light: 50, alpha: 0.13 },
    trough: { hue: -35, sat: 75, light: 46, alpha: 0.13 },
    ring: { hue: 30, sat: 85, light: 45, alpha: 0.22 },
  },
};

/** Sand on a Chladni plate gathers on the nodal lines of the loudest pitch's mode, and each beat bounces it loose. */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const visibility = fadeVisibility(state, frame);
  if (visibility < VISIBLE_FLOOR) {
    // The next sound pours fresh sand, so each figure forms from an even scatter the way it does on a real plate.
    state.poured = false;
    return false;
  }
  if (Math.min(frame.width, frame.height) - 2 * plateInset(frame) < MIN_PLATE_PX) return false;
  const plate = plateFor(state, frame);
  if (!state.poured) pour(state, plate, frame);
  const look = LOOKS[frame.theme] ?? LOOKS.dark;
  const motion = advance(state, frame, plate, beat);
  moveGrains(plate, frame, motion);
  paintGlow(ctx, plate, motion, look, visibility);
  paintGrains(ctx, plate, motion, look, visibility);
  // The sand outlasts the music while it fades, so the host keeps drawing until it is gone.
  return true;
}

function fadeVisibility(state, frame) {
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  state.visibility = Math.max((state.visibility ?? 0) * FADE_RETAIN_PER_SECOND ** frame.dtSeconds, presence);
  return state.visibility;
}

function plateFor(state, frame) {
  const current = state.plate;
  if (current !== undefined && current.frameWidth === frame.width && current.frameHeight === frame.height) return current;
  state.poured = false;
  state.plate = buildPlate(frame);
  return state.plate;
}

function plateInset(frame) {
  return frame.pad + PLATE_INSET_PX;
}

function buildPlate(frame) {
  const inset = plateInset(frame);
  const w = frame.width - 2 * inset;
  const h = frame.height - 2 * inset;
  const unit = Math.min(w, h);
  const count = Math.round(Math.min(MAX_GRAINS, Math.max(MIN_GRAINS, (GRAIN_DENSITY * w * h) / unit)));
  const maxOrder = Math.max(2, Math.floor(unit / PX_PER_ORDER));
  const plate = {
    frameWidth: frame.width,
    frameHeight: frame.height,
    x0: inset,
    y0: inset,
    x1: inset + w,
    y1: inset + h,
    w,
    h,
    cx: frame.width / 2,
    cy: frame.height / 2,
    unit,
    fade: Math.max(4, unit * EDGE_FADE),
    spill: Math.max(4, unit * EDGE_FADE) * SPILL_SHARE,
    reach: Math.hypot(w / 2, h / 2),
    grainPx: Math.min(MAX_GRAIN_PX, Math.max(GRAIN_PX, Math.sqrt((w * h) / count) * GRAIN_PX_PER_SPACING)),
    modes: MODES.map((_, index) => index).filter((index) => Math.max(MODES[index][0], MODES[index][1]) <= maxOrder),
    grains: makeGrains(count),
  };
  plate.grid = makeGrid(plate, frame);
  return plate;
}

function makeGrains(count) {
  return {
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    vz: new Float32Array(count),
    swing: new Float32Array(count),
    offset: new Float32Array(count),
    // A fixed draw against the edge fade, so a grain near the edge shows or hides steadily instead of flickering.
    seed: new Float32Array(count),
    buckets: [new Int32Array(count), new Int32Array(count), new Int32Array(count), new Int32Array(count)],
    filled: new Int32Array(4),
  };
}

function makeGrid(plate, frame) {
  const cell = Math.max(GRID_MIN_CELL_PX, plate.w / GRID_MAX_COLS, plate.h / GRID_MAX_ROWS);
  const cols = Math.max(1, Math.ceil(plate.w / cell));
  const rows = Math.max(1, Math.ceil(plate.h / cell));
  const cellW = plate.w / cols;
  const cellH = plate.h / rows;
  const layer = frame.createLayer(cols, rows);
  const grid = {
    cols,
    rows,
    cellW,
    cellH,
    // Line brightness holds steady across sizes, since grains per cell on a line scale with this ratio.
    densityGain: (DENSITY_GAIN * plate.w * plate.h) / (plate.grains.count * plate.unit * Math.sqrt(cellW * cellH)),
    blur: Math.sqrt(cellW * cellH) > WIDE_CELL_PX ? BLUR_NARROW : BLUR_WIDE,
    density: new Float32Array(cols * rows),
    scratch: new Float32Array(cols * rows),
    edge: new Float32Array(cols * rows),
    distance: new Float32Array(cols * rows),
    modeFields: new Array(MODES.length),
    layer,
    image: layer.ctx.createImageData(cols, rows),
  };
  for (let row = 0; row < rows; row++) {
    const y = plate.y0 + (row + 0.5) * cellH;
    for (let col = 0; col < cols; col++) {
      const x = plate.x0 + (col + 0.5) * cellW;
      grid.edge[row * cols + col] = edgeWeight(plate, x, y);
      grid.distance[row * cols + col] = Math.hypot(x - plate.cx, y - plate.cy);
    }
  }
  return grid;
}

function pour(state, plate, frame) {
  const grains = plate.grains;
  for (let i = 0; i < grains.count; i++) {
    grains.x[i] = plate.x0 + Math.random() * plate.w;
    grains.y[i] = plate.y0 + Math.random() * plate.h;
    grains.z[i] = 0;
    grains.vx[i] = 0;
    grains.vy[i] = 0;
    grains.vz[i] = 0;
    grains.seed[i] = Math.random();
    grains.offset[i] = Math.random() - 0.5;
  }
  state.poured = true;
  state.spectrum = Float32Array.from(frame.values);
  state.mode = null;
  state.previousMode = null;
  state.hue = null;
  state.waves = [];
  state.swing = 0;
  state.phase = 0;
}

function advance(state, frame, plate, beat) {
  const dt = frame.dtSeconds;
  const strength = Math.min(1, BEAT_BASE + BEAT_BASS * frame.bass);
  const drive = Math.min(1, frame.energy * DRIVE_GAIN);
  const mode = chooseMode(state, frame, plate);
  const pitch = mode / (MODES.length - 1);
  const hueTarget = HUE_LOW + (HUE_HIGH - HUE_LOW) * pitch;
  state.hue = state.hue === null ? hueTarget : state.hue + (hueTarget - state.hue) * (1 - Math.exp(-dt / HUE_EASE_S));
  state.switchAge += dt;
  const strike = beat && !frame.reducedMotion;
  advanceWaves(state, plate, dt, strike, strength);
  return {
    mode,
    previous: state.previousMode,
    blend: Math.min(1, state.switchAge / SWITCH_BLEND_S),
    drive,
    hue: state.hue,
    waves: state.waves,
    swing: advanceSwing(state, frame, strike, strength, drive, pitch),
  };
}

// The pattern follows the loudest band, but only once a new band has led for a while and the old figure has settled.
function chooseMode(state, frame, plate) {
  const spectrum = state.spectrum;
  const smoothing = 1 - Math.exp(-frame.dtSeconds / SPECTRUM_SMOOTH_S);
  let loudest = 0;
  for (let band = 0; band < spectrum.length; band++) {
    spectrum[band] += (frame.values[band] - spectrum[band]) * smoothing;
    if (spectrum[band] > spectrum[loudest]) loudest = band;
  }
  const slot = Math.round((loudest / (spectrum.length - 1)) * (plate.modes.length - 1));
  const candidate = plate.modes[slot];
  if (state.mode === null || !plate.modes.includes(state.mode)) {
    switchMode(state, candidate);
    state.previousMode = null;
    return candidate;
  }
  state.dwell += frame.dtSeconds;
  if (candidate === state.mode) {
    state.lead = 0;
    return state.mode;
  }
  state.lead = candidate === state.challenger ? state.lead + frame.dtSeconds : 0;
  state.challenger = candidate;
  if (state.lead >= MODE_LEAD_S && state.dwell >= MODE_DWELL_S) switchMode(state, candidate);
  return state.mode;
}

function switchMode(state, mode) {
  state.previousMode = state.mode;
  state.mode = mode;
  state.dwell = 0;
  state.lead = 0;
  state.challenger = mode;
  state.switchAge = 0;
}

function advanceWaves(state, plate, dt, strike, strength) {
  const speed = plate.reach / WAVE_CROSS_S;
  for (const wave of state.waves) {
    wave.previous = wave.radius;
    wave.radius += speed * dt;
  }
  state.waves = state.waves.filter((wave) => wave.previous < plate.reach);
  if (strike && state.waves.length < MAX_WAVES) state.waves.push({ radius: 0, previous: 0, strength });
}

// A strike sets the shown standing wave swinging at full height, and it rings down toward the level's own drive.
function advanceSwing(state, frame, strike, strength, drive, pitch) {
  if (frame.reducedMotion) return SWING_BASE * drive;
  const hz = SWING_HZ_LOW + (SWING_HZ_HIGH - SWING_HZ_LOW) * pitch;
  if (strike) {
    state.swing = strength;
    state.phase = 0;
  } else {
    state.phase = (state.phase + Math.PI * 2 * hz * frame.dtSeconds) % (Math.PI * 2);
  }
  state.swing *= Math.exp(-SWING_DECAY_PER_SECOND * frame.dtSeconds);
  return (SWING_BASE * drive + state.swing) * Math.cos(state.phase);
}

function moveGrains(plate, frame, motion) {
  const grains = plate.grains;
  const dt = frame.dtSeconds;
  const [n, m, sign] = MODES[motion.mode];
  const field = { a: (n * Math.PI) / plate.unit, b: (m * Math.PI) / plate.unit, sign, cx: plate.cx, cy: plate.cy };
  const step = {
    dt,
    settle: 1 - Math.exp(-SETTLE_RATE * motion.drive * dt),
    maxStep: SETTLE_SPEED * plate.unit * motion.drive * dt,
    lineWidth: Math.max(MIN_LINE_WIDTH_PX, plate.unit * LINE_WIDTH),
    // A random walk spreads with the root of time, so the jitter keeps its look at any frame rate.
    jitter: frame.reducedMotion ? 0 : motion.drive * plate.unit * Math.sqrt(dt) * NOISE_SPAN,
    damping: Math.exp(-GROUND_FRICTION * dt),
  };
  const kicks = motion.waves.filter((wave) => wave.radius > wave.previous);
  for (let i = 0; i < grains.count; i++) {
    if (kicks.length > 0) {
      const distance = Math.hypot(grains.x[i] - plate.cx, grains.y[i] - plate.cy);
      for (let k = 0; k < kicks.length; k++) {
        if (distance >= kicks[k].previous && distance < kicks[k].radius) kickGrain(grains, i, plate, kicks[k], distance);
      }
    }
    if (grains.z[i] > 0) flyGrain(grains, i, dt);
    else settleGrain(grains, i, field, step);
    containGrain(grains, i, plate);
    if (grains.z[i] === 0 && edgeDistance(plate, grains.x[i], grains.y[i]) < plate.spill) sprinkle(grains, i, plate);
  }
}

function sprinkle(grains, i, plate) {
  grains.x[i] = plate.x0 + Math.random() * plate.w;
  grains.y[i] = plate.y0 + Math.random() * plate.h;
  grains.vx[i] = 0;
  grains.vy[i] = 0;
  grains.swing[i] = 1;
}

// The wavefront throws each grain up and sideways as it passes, so the grains in the air trace a spreading ring.
function kickGrain(grains, i, plate, wave, distance) {
  const power = wave.strength * (1 - (REACH_FALLOFF * distance) / plate.reach) * (0.55 + 0.45 * Math.random());
  const angle = Math.random() * Math.PI * 2;
  const speed = SCATTER_SPEED * plate.unit * power;
  grains.vx[i] = speed * Math.cos(angle);
  grains.vy[i] = speed * Math.sin(angle);
  grains.vz[i] = Math.max(grains.vz[i], HOP_SPEED * power);
  grains.z[i] = Math.max(grains.z[i], 1e-4);
}

function flyGrain(grains, i, dt) {
  grains.x[i] += grains.vx[i] * dt;
  grains.y[i] += grains.vy[i] * dt;
  grains.vz[i] -= GRAVITY * dt;
  grains.z[i] += grains.vz[i] * dt;
  if (grains.z[i] > 0) return;
  grains.z[i] = 0;
  grains.vz[i] = 0;
}

// A grain on the plate slides toward the nearest nodal line and jitters with the plate's local swing.
function settleGrain(grains, i, field, step) {
  const dx = grains.x[i] - field.cx;
  const dy = grains.y[i] - field.cy;
  const cosAx = Math.cos(field.a * dx);
  const sinAx = Math.sin(field.a * dx);
  const cosBx = Math.cos(field.b * dx);
  const sinBx = Math.sin(field.b * dx);
  const cosAy = Math.cos(field.a * dy);
  const sinAy = Math.sin(field.a * dy);
  const cosBy = Math.cos(field.b * dy);
  const sinBy = Math.sin(field.b * dy);
  const u = cosAx * cosBy + field.sign * cosBx * cosAy;
  const gradX = -field.a * sinAx * cosBy - field.sign * field.b * sinBx * cosAy;
  const gradY = -field.b * cosAx * sinBy - field.sign * field.a * cosBx * sinAy;
  const gradSq = gradX * gradX + gradY * gradY;
  const swing = Math.abs(u) / 2;
  let moveX = 0;
  let moveY = 0;
  if (gradSq > MIN_GRADIENT_SQ) {
    // A Newton step lands where the field's local slope reaches the grain's offset, beside the nearest nodal line.
    const miss = u - grains.offset[i] * step.lineWidth * Math.sqrt(gradSq);
    moveX = ((-miss * gradX) / gradSq) * step.settle;
    moveY = ((-miss * gradY) / gradSq) * step.settle;
    const length = Math.hypot(moveX, moveY);
    if (length > step.maxStep) {
      moveX *= step.maxStep / length;
      moveY *= step.maxStep / length;
    }
  }
  const spread = (JITTER_LINE + JITTER_ANTINODE * swing) * step.jitter;
  const creep = gradSq > MIN_GRADIENT_SQ ? ((Math.random() - 0.5) * JITTER_ALONG * step.jitter) / Math.sqrt(gradSq) : 0;
  grains.vx[i] *= step.damping;
  grains.vy[i] *= step.damping;
  grains.x[i] += moveX + (Math.random() - 0.5) * spread - creep * gradY + grains.vx[i] * step.dt;
  grains.y[i] += moveY + (Math.random() - 0.5) * spread + creep * gradX + grains.vy[i] * step.dt;
  grains.swing[i] = swing;
}

function containGrain(grains, i, plate) {
  if (grains.x[i] < plate.x0) {
    grains.x[i] = Math.min(plate.x1, 2 * plate.x0 - grains.x[i]);
    grains.vx[i] = -grains.vx[i] * WALL_BOUNCE;
  } else if (grains.x[i] > plate.x1) {
    grains.x[i] = Math.max(plate.x0, 2 * plate.x1 - grains.x[i]);
    grains.vx[i] = -grains.vx[i] * WALL_BOUNCE;
  }
  if (grains.y[i] < plate.y0) {
    grains.y[i] = Math.min(plate.y1, 2 * plate.y0 - grains.y[i]);
    grains.vy[i] = -grains.vy[i] * WALL_BOUNCE;
  } else if (grains.y[i] > plate.y1) {
    grains.y[i] = Math.max(plate.y0, 2 * plate.y1 - grains.y[i]);
    grains.vy[i] = -grains.vy[i] * WALL_BOUNCE;
  }
}

// A soft wash under the grains: the sand's density as a glow, the plate's standing wave and the strike rings.
function paintGlow(ctx, plate, motion, look, visibility) {
  const grid = plate.grid;
  splatGrains(grid, plate);
  blurDensity(grid);
  shadeGrid(grid, plate, motion, look, visibility);
  grid.layer.ctx.putImageData(grid.image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(grid.layer.canvas, 0, 0, grid.cols, grid.rows, plate.x0, plate.y0, plate.w, plate.h);
}

function splatGrains(grid, plate) {
  const grains = plate.grains;
  grid.density.fill(0);
  for (let i = 0; i < grains.count; i++) {
    const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((grains.x[i] - plate.x0) / grid.cellW)));
    const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((grains.y[i] - plate.y0) / grid.cellH)));
    let weight = grains.swing[i] < SETTLED_SWING ? 1 : LOOSE_DENSITY;
    if (grains.z[i] > 0) weight = AIR_DENSITY;
    grid.density[row * grid.cols + col] += weight;
  }
}

function blurDensity(grid) {
  blurPass(grid.density, grid.scratch, grid.blur, grid.cols, grid.rows, 1, grid.cols);
  blurPass(grid.scratch, grid.density, grid.blur, grid.rows, grid.cols, grid.cols, 1);
}

// One binomial pass along lines of `length` cells spaced `stride` apart, with lines `next` apart, clamped at the ends.
function blurPass(from, to, taps, length, lines, stride, next) {
  const reach = (taps.length - 1) / 2;
  for (let line = 0; line < lines; line++) {
    const base = line * next;
    for (let k = 0; k < length; k++) {
      let sum = 0;
      for (let tap = 0; tap < taps.length; tap++) {
        const at = Math.min(length - 1, Math.max(0, k + tap - reach));
        sum += taps[tap] * from[base + at * stride];
      }
      to[base + k * stride] = sum;
    }
  }
}

function shadeGrid(grid, plate, motion, look, visibility) {
  const data = grid.image.data;
  const current = modeField(plate, motion.mode);
  const previous = motion.blend < 1 && motion.previous !== null && plate.modes.includes(motion.previous) ? modeField(plate, motion.previous) : null;
  const glowColor = hslToRgb(motion.hue + look.glow.hue, look.glow.sat, look.glow.light);
  const crestColor = hslToRgb(motion.hue + look.crest.hue, look.crest.sat, look.crest.light);
  const troughColor = hslToRgb(motion.hue + look.trough.hue, look.trough.sat, look.trough.light);
  const ringColor = hslToRgb(motion.hue + look.ring.hue, look.ring.sat, look.ring.light);
  const rings = motion.waves.map((wave) => ({
    radius: wave.radius,
    width: Math.max(4, plate.unit * RING_WIDTH),
    alpha: look.ring.alpha * wave.strength * Math.max(0, 1 - wave.radius / plate.reach),
  }));
  for (let index = 0; index < grid.cols * grid.rows; index++) {
    const sand = grid.density[index] * grid.densityGain;
    const glow = (sand / (1 + sand)) * look.glow.alpha;
    const u = previous === null ? current[index] : previous[index] + (current[index] - previous[index]) * motion.blend;
    const wave = u * motion.swing;
    const crest = wave > 0 ? wave * look.crest.alpha : 0;
    const trough = wave < 0 ? -wave * look.trough.alpha : 0;
    const ring = rings.length === 0 ? 0 : ringAt(rings, grid.distance[index]);
    const total = glow + crest + trough + ring;
    const o = index * 4;
    if (total < 0.002) {
      data[o + 3] = 0;
      continue;
    }
    data[o] = (glow * glowColor[0] + crest * crestColor[0] + trough * troughColor[0] + ring * ringColor[0]) / total;
    data[o + 1] = (glow * glowColor[1] + crest * crestColor[1] + trough * troughColor[1] + ring * ringColor[1]) / total;
    data[o + 2] = (glow * glowColor[2] + crest * crestColor[2] + trough * troughColor[2] + ring * ringColor[2]) / total;
    data[o + 3] = Math.min(1, total) * grid.edge[index] * visibility * 255;
  }
}

function ringAt(rings, distance) {
  let sum = 0;
  for (let k = 0; k < rings.length; k++) {
    const t = (distance - rings[k].radius) / rings[k].width;
    if (t > -1 && t < 1) sum += rings[k].alpha * (1 - t * t) * (1 - t * t);
  }
  return sum;
}

// Half the mode's field at each cell center, cached since a figure's shape depends only on the size.
function modeField(plate, mode) {
  const grid = plate.grid;
  const cached = grid.modeFields[mode];
  if (cached !== undefined) return cached;
  const [n, m, sign] = MODES[mode];
  const a = (n * Math.PI) / plate.unit;
  const b = (m * Math.PI) / plate.unit;
  const field = new Float32Array(grid.cols * grid.rows);
  for (let row = 0; row < grid.rows; row++) {
    const dy = plate.y0 + (row + 0.5) * grid.cellH - plate.cy;
    for (let col = 0; col < grid.cols; col++) {
      const dx = plate.x0 + (col + 0.5) * grid.cellW - plate.cx;
      field[row * grid.cols + col] = (Math.cos(a * dx) * Math.cos(b * dy) + sign * Math.cos(b * dx) * Math.cos(a * dy)) / 2;
    }
  }
  grid.modeFields[mode] = field;
  return field;
}

// Grains that share a look go in one path with one fill, so the whole plate costs four paints. Resting grains are
// squares, since they are many and too small to show a corner, and the larger airborne grains are round.
function paintGrains(ctx, plate, motion, look, visibility) {
  const grains = plate.grains;
  sortGrains(plate);
  const size = plate.grainPx;
  const passes = [
    [look.loose, size, false],
    [look.settled, size, false],
    [look.air, size + AIR_GROWTH_PX * LOW_HOP_GROWTH, true],
    [look.air, size + AIR_GROWTH_PX, true],
  ];
  ctx.save();
  ctx.globalCompositeOperation = look.blend;
  passes.forEach(([style, side, round], bucket) => {
    const list = grains.buckets[bucket];
    const filled = grains.filled[bucket];
    if (filled === 0) return;
    const half = side / 2;
    ctx.fillStyle = `hsla(${(motion.hue + style.hue).toFixed(1)}, ${style.sat}%, ${style.light}%, ${(style.alpha * visibility).toFixed(3)})`;
    ctx.beginPath();
    for (let k = 0; k < filled; k++) {
      const x = grains.x[list[k]];
      const y = grains.y[list[k]];
      if (round) {
        ctx.moveTo(x + half, y);
        ctx.arc(x, y, half, 0, Math.PI * 2);
      } else {
        ctx.rect(x - half, y - half, side, side);
      }
    }
    ctx.fill();
  });
  ctx.restore();
}

// Buckets: loose sand, sand resting on a nodal line, low hops and high hops. The edge fade drops grains by their seed.
function sortGrains(plate) {
  const grains = plate.grains;
  grains.filled.fill(0);
  for (let i = 0; i < grains.count; i++) {
    if (grains.seed[i] >= edgeWeight(plate, grains.x[i], grains.y[i])) continue;
    let bucket = 0;
    if (grains.z[i] > AIR_HIGH) bucket = 3;
    else if (grains.z[i] > 0) bucket = 2;
    else if (grains.swing[i] < SETTLED_SWING) bucket = 1;
    grains.buckets[bucket][grains.filled[bucket]] = i;
    grains.filled[bucket] += 1;
  }
}

function edgeWeight(plate, x, y) {
  return smoothstep(Math.min(x - plate.x0, plate.x1 - x) / plate.fade) * smoothstep(Math.min(y - plate.y0, plate.y1 - y) / plate.fade);
}

function edgeDistance(plate, x, y) {
  return Math.min(x - plate.x0, plate.x1 - x, y - plate.y0, plate.y1 - y);
}

function smoothstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const offset = l - chroma / 2;
  const [r, g, b] = [
    [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
    [0, second, chroma], [second, 0, chroma], [chroma, 0, second],
  ][Math.min(5, Math.floor(sector))];
  return [(r + offset) * 255, (g + offset) * 255, (b + offset) * 255];
}

export default { label: 'Chladni sand', draw };
