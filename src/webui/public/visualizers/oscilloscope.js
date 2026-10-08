import { average, detectBeat, rgba } from '../visualizer-kit.js';

const TAU = Math.PI * 2;
// Samples per trace. Every pair below closes within one turn, so the trace is one closed loop.
const POINTS = 480;
// Frequency pairs from the harmonic series, the musical intervals Lissajous first drew with tuning forks.
const INTERVALS = [[2, 3], [3, 4], [1, 2], [3, 5], [1, 1], [2, 5], [4, 5], [1, 3], [3, 8], [5, 6], [2, 7], [1, 4], [1, 5]];
// A lobe's width over its height. Outside this range a pair draws flat or spindly lobes in the area's shape.
const LOBE_ASPECT_MIN = 0.7;
const LOBE_ASPECT_MAX = 2.6;
// An area too narrow for every pair gets one figure with lobes this much wider than tall.
const FALLBACK_LOBE_ASPECT = 1.4;
// The generator moves to the next pair on a beat once a figure has held this long, or regardless after the longer hold.
const HOLD_S = 5;
const MAX_HOLD_S = 14;
const MORPH_S = 0.9;

const PRESENCE_GAIN = 4;
const POWER_ATTACK_PER_SECOND = 9;
// The fraction of beam power left after one second of silence, so the last glow is gone in about 1.4 seconds.
const POWER_RETAIN_PER_SECOND = 0.03;
const POWER_CUTOFF = 0.01;
// Under this power the trace shrinks toward the center, the way a scope figure collapses as its signal fades.
const COLLAPSE_POWER = 0.5;

// Two scope channels: the low bands swing x and the high bands swing y. The three parts sum to the full radius.
const SIZE_BASE = 0.62;
const SIZE_LEVEL = 0.28;
const SIZE_KICK = 0.1;
const KICK_DECAY_PER_SECOND = 7;
const KICK_FLASH = 0.6;

// Apparent turns per second of the figure. One turn of the x phase repeats the shape once per y cycle.
const SPIN_TURNS_PER_SECOND = 0.12;
const SPIN_ENERGY = 0.3;
// A kick briefly speeds the spin, so the figure twists on the beat.
const SPIN_KICK = 3;
// The mids pinch the trace at points that travel along it, like tremolo on the signal.
const PINCH_LOBES = 7;
const PINCH_DEPTH = 0.32;
const PINCH_PER_SECOND = 0.5;
const PINCH_MID = 1.6;
// The treble adds hash across the trace, like noise riding the input.
const RIPPLE_CYCLES = 48;
const RIPPLE_RATIO = 0.02;
const RIPPLE_MAX_PX = 4;
const RIPPLE_PER_SECOND = 9;

// A beam leaves the same charge on every sample, so a short step glows hot and a long sweep dims.
const BUCKETS = 5;
const VELOCITY_REF = 0.55;
const INTENSITY_FLOOR = 0.16;

const CORE_WIDTH_RATIO = 0.0075;
const CORE_MIN = 1.1;
const CORE_MAX = 1.8;
const BLOOM_RATIO = 2.4;
const HALO_RATIO = 0.034;
const HALO_MIN = 3.5;
const HALO_MAX = 8;
const HEAD_RADIUS_RATIO = 0.95;
// Kept between the widest paint and the pad, since the host feathers the canvas edge.
const EDGE_SAFETY_PX = 1.5;
const MIN_RADIUS_PX = 6;

// Afterglow copies, taken at a fixed interval so persistence lasts as long at any frame rate.
const GHOSTS = 10;
const GHOST_INTERVAL_S = 1 / 30;
const GHOST_DECAY_PER_SECOND = 6;
const GHOST_STRIDE = 2;
const GHOST_WIDTH_RATIO = 1.3;

// Two write spots run the figure half a lap apart, like a slow sweep showing where the beam is.
const HEADS = 2;
const HEAD_LAPS_PER_SECOND = 0.12;
const HEAD_LAPS_ENERGY = 0.25;
const HEAD_TAIL = 36;
const TAIL_STEPS = 4;
const HEAD_BASE = 0.45;
const HEAD_TREBLE = 0.55;
// The parked beam glows at the center while the figure collapses, then fades with the power.
const SPOT_GAIN = 4;
const SPOT_RADIUS_RATIO = 1.3;

const GRID_DIVISIONS = 8;
const GRID_MIN_PX = 12;
const GRID_TICK_MIN_PX = 3.5;
const GRID_DOT = 1.4;
const GRID_LINE = 0.8;
const GRID_TICK = 3;
const GRID_KICK = 0.5;
// Under this alpha a paint rounds to nothing on an 8-bit canvas.
const MIN_ALPHA = 0.004;

// P31 green phosphor glows on the dark card. On the light card additive light washes out, so it draws as plotter ink.
const PHOSPHOR = {
  dark: {
    blend: 'lighter',
    dim: { r: 40, g: 230, b: 110 },
    hot: { r: 215, g: 255, b: 225 },
    halo: { r: 30, g: 255, b: 120 },
    haloAlpha: 0.13,
    bloomAlpha: 0.32,
    coreFloor: 0,
    ghostYoung: { r: 50, g: 235, b: 120 },
    ghostOld: { r: 150, g: 220, b: 50 },
    ghostAlpha: 0.32,
    grid: { r: 120, g: 200, b: 160 },
    gridAlpha: 0.15,
  },
  light: {
    blend: 'source-over',
    dim: { r: 0, g: 150, b: 105 },
    hot: { r: 0, g: 78, b: 52 },
    halo: { r: 0, g: 170, b: 120 },
    haloAlpha: 0.08,
    bloomAlpha: 0.2,
    coreFloor: 0.3,
    ghostYoung: { r: 0, g: 140, b: 115 },
    ghostOld: { r: 70, g: 140, b: 40 },
    ghostAlpha: 0.2,
    grid: { r: 30, g: 85, b: 72 },
    gridAlpha: 0.18,
  },
};

/** An XY oscilloscope whose phosphor beam traces Lissajous figures that the bands size, pinch and roughen. */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const power = updatePower(state, frame);
  const scope = scopeGeometry(frame);
  if (power < POWER_CUTOFF || scope === null) {
    // A stale afterglow would flash old figures when the music resumes.
    state.afterglow = undefined;
    return undefined;
  }

  const style = frame.theme === 'light' ? PHOSPHOR.light : PHOSPHOR.dark;
  const levels = bandLevels(frame.values);
  const kick = updateKick(state, frame, beat);
  const patch = advancePatch(state, frame, beat, intervalsFor(scope.radiusX / scope.radiusY));
  const motion = advanceMotion(state, frame, levels, kick, patch);
  const shape = shapeOf(scope, levels, kick, power);
  const trace = traceFigure(state, scope, patch, shape, motion);
  const afterglow = ageAfterglow(state, frame);
  const brightness = Math.min(1, power) * (1 + KICK_FLASH * kick);
  const headBrightness = brightness * shape.collapse * (HEAD_BASE + HEAD_TREBLE * levels.treble);

  drawGraticule(ctx, frame, style, power * (1 + GRID_KICK * kick));
  ctx.globalCompositeOperation = style.blend;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  drawAfterglow(ctx, afterglow, style, scope);
  drawBeam(ctx, trace, style, scope, brightness);
  if (!frame.reducedMotion) drawHeads(ctx, trace, style, scope, motion.lap, headBrightness);
  drawSpot(ctx, scope, style, power * (1 - shape.collapse));
  captureAfterglow(afterglow, trace, Math.min(1, brightness));
  // The afterglow and the parked dot outlast the music, so the host keeps drawing until the power runs out.
  return true;
}

// Power rises with the music over a fraction of a second and falls at its own pace once the music stops.
function updatePower(state, frame) {
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  const previous = state.power ?? 0;
  const rise = previous + (presence - previous) * (1 - Math.exp(-POWER_ATTACK_PER_SECOND * frame.dtSeconds));
  const fall = previous * POWER_RETAIN_PER_SECOND ** frame.dtSeconds;
  state.power = presence > previous ? rise : Math.max(fall, presence);
  return state.power;
}

function updateKick(state, frame, beat) {
  state.kick = beat ? 1 : (state.kick ?? 0) * Math.exp(-KICK_DECAY_PER_SECOND * frame.dtSeconds);
  return state.kick;
}

// The margin holds the ripple and the head glow, the widest paint, so every stroke stays clear of the pad.
function scopeGeometry(frame) {
  const { width, height, pad } = frame;
  const short = Math.min(width, height);
  const core = clamp(short * CORE_WIDTH_RATIO, CORE_MIN, CORE_MAX);
  const halo = clamp(short * HALO_RATIO, HALO_MIN, HALO_MAX);
  const ripple = Math.min(RIPPLE_MAX_PX, short * RIPPLE_RATIO);
  const headRadius = halo * HEAD_RADIUS_RATIO;
  const margin = pad + ripple + Math.max(halo / 2, headRadius) + EDGE_SAFETY_PX;
  const radiusX = width / 2 - margin;
  const radiusY = height / 2 - margin;
  if (radiusX < MIN_RADIUS_PX || radiusY < MIN_RADIUS_PX) return null;
  return { centerX: width / 2, centerY: height / 2, radiusX, radiusY, core, bloom: core * BLOOM_RATIO, halo, ripple, headRadius };
}

function bandLevels(values) {
  return {
    low: average(values, 0, 6),
    mid: average(values, 4, 11),
    high: average(values, 8, 16),
    treble: average(values, 11, 16),
  };
}

// The y frequency sets the lobes across and the x frequency the lobes down, so each pair is turned to fit the area.
function intervalsFor(aspect) {
  const fits = [];
  for (const [low, high] of INTERVALS) {
    const turns = low === high ? [[low, high]] : [[low, high], [high, low]];
    for (const [a, b] of turns) {
      const lobeAspect = (aspect * a) / b;
      if (lobeAspect >= LOBE_ASPECT_MIN && lobeAspect <= LOBE_ASPECT_MAX) fits.push([a, b]);
    }
  }
  if (fits.length > 0) return fits;
  if (aspect >= 1) return [[1, Math.max(1, Math.round(aspect / FALLBACK_LOBE_ASPECT))]];
  return [[Math.max(1, Math.round(1 / (aspect * FALLBACK_LOBE_ASPECT))), 1]];
}

// A beat turns the generator to the next interval once the figure has held, and the old figure morphs into it.
function advancePatch(state, frame, beat, pairs) {
  const patch = (state.patch ??= { from: pairs[0], to: pairs[0], morph: 1, held: 0 });
  let position = pairs.findIndex(([a, b]) => a === patch.to[0] && b === patch.to[1]);
  if (position === -1) {
    Object.assign(patch, { from: pairs[0], to: pairs[0], morph: 1, held: 0 });
    position = 0;
  }
  if (frame.reducedMotion) return patch;
  patch.held += frame.dtSeconds;
  patch.morph = Math.min(1, patch.morph + frame.dtSeconds / MORPH_S);
  const due = (beat && patch.held >= HOLD_S) || patch.held >= MAX_HOLD_S;
  if (due && pairs.length > 1) Object.assign(patch, { from: patch.to, to: pairs[(position + 1) % pairs.length], morph: 0, held: 0 });
  return patch;
}

function advanceMotion(state, frame, levels, kick, patch) {
  const dt = frame.reducedMotion ? 0 : frame.dtSeconds;
  const turns = (SPIN_TURNS_PER_SECOND + SPIN_ENERGY * frame.energy) * (1 + SPIN_KICK * kick);
  state.phase = ((state.phase ?? 0) + (dt * turns * TAU) / patch.to[1]) % TAU;
  state.pinch = ((state.pinch ?? 0) + dt * (PINCH_PER_SECOND + PINCH_MID * levels.mid)) % TAU;
  state.ripple = ((state.ripple ?? 0) + dt * RIPPLE_PER_SECOND) % TAU;
  state.lap = ((state.lap ?? 0) + dt * (HEAD_LAPS_PER_SECOND + HEAD_LAPS_ENERGY * frame.energy)) % 1;
  return { phase: state.phase, pinch: state.pinch, ripple: state.ripple, lap: state.lap };
}

// The three size parts never exceed 1 and the pinch only shrinks, so the figure stays inside its radii.
function shapeOf(scope, levels, kick, power) {
  const collapse = smoothstep(0, COLLAPSE_POWER, power);
  return {
    collapse,
    sizeX: collapse * (SIZE_BASE + SIZE_LEVEL * levels.low + SIZE_KICK * kick),
    sizeY: collapse * (SIZE_BASE + SIZE_LEVEL * levels.high + SIZE_KICK * kick),
    pinch: PINCH_DEPTH * smoothstep(0.15, 0.75, levels.mid),
    ripple: collapse * scope.ripple * smoothstep(0.15, 0.7, levels.treble),
  };
}

function traceFigure(state, scope, patch, shape, motion) {
  const trace = (state.trace ??= {
    baseX: new Float32Array(POINTS + 1),
    baseY: new Float32Array(POINTS + 1),
    xs: new Float32Array(POINTS + 1),
    ys: new Float32Array(POINTS + 1),
    buckets: new Uint8Array(POINTS),
    counts: new Uint16Array(BUCKETS),
  });
  const ease = smoothstep(0, 1, patch.morph);
  const [fromA, fromB] = patch.from;
  const [toA, toB] = patch.to;
  for (let k = 0; k <= POINTS; k++) {
    const tau = (k / POINTS) * TAU;
    let x = Math.sin(toA * tau + motion.phase);
    let y = Math.sin(toB * tau);
    if (ease < 1) {
      x = Math.sin(fromA * tau + motion.phase) * (1 - ease) + x * ease;
      y = Math.sin(fromB * tau) * (1 - ease) + y * ease;
    }
    const pinch = 1 - shape.pinch * 0.5 * (1 - Math.cos(PINCH_LOBES * tau + motion.pinch));
    trace.baseX[k] = scope.centerX + x * pinch * shape.sizeX * scope.radiusX;
    trace.baseY[k] = scope.centerY - y * pinch * shape.sizeY * scope.radiusY;
  }
  addRipple(trace, shape.ripple, motion.ripple);
  bucketSegments(trace, scope, patch, ease);
  return trace;
}

// Each point moves along the trace's normal, so the hash roughens the line without changing the figure.
function addRipple(trace, amplitude, phase) {
  const { baseX, baseY, xs, ys } = trace;
  for (let k = 0; k <= POINTS; k++) {
    const before = k === 0 ? POINTS - 1 : k - 1;
    const after = k === POINTS ? 1 : k + 1;
    const dx = baseX[after] - baseX[before];
    const dy = baseY[after] - baseY[before];
    const length = Math.hypot(dx, dy);
    const offset = amplitude > 0 && length > 1e-6 ? (amplitude * Math.sin(RIPPLE_CYCLES * (k / POINTS) * TAU + phase)) / length : 0;
    xs[k] = baseX[k] - dy * offset;
    ys[k] = baseY[k] + dx * offset;
  }
}

// Steps are measured against a full-size figure, so a shrinking trace runs slow and burns brighter.
function bucketSegments(trace, scope, patch, ease) {
  const { xs, ys, buckets, counts } = trace;
  const a = patch.from[0] + (patch.to[0] - patch.from[0]) * ease;
  const b = patch.from[1] + (patch.to[1] - patch.from[1]) * ease;
  // Each axis sweeps four radii per cycle, which estimates the mean step of a full-size figure.
  const reference = ((4 * Math.hypot(a * scope.radiusX, b * scope.radiusY)) / POINTS) * VELOCITY_REF;
  counts.fill(0);
  for (let k = 0; k < POINTS; k++) {
    const step = Math.hypot(xs[k + 1] - xs[k], ys[k + 1] - ys[k]);
    const slowness = step > reference ? (reference / step) ** 2 : 1;
    const bucket = Math.min(BUCKETS - 1, Math.floor(Math.max(INTENSITY_FLOOR, slowness) * BUCKETS));
    buckets[k] = bucket;
    counts[bucket] += 1;
  }
}

// Each slot holds one earlier trace. A resize drops them all, since their points belong to the old area.
function ageAfterglow(state, frame) {
  const area = `${frame.width}x${frame.height}`;
  if (state.afterglow?.area !== area) {
    state.afterglow = {
      area,
      next: 0,
      clock: GHOST_INTERVAL_S,
      slots: Array.from({ length: GHOSTS }, () => ({ xs: new Float32Array(POINTS + 1), ys: new Float32Array(POINTS + 1), age: Infinity, brightness: 0 })),
    };
  }
  const afterglow = state.afterglow;
  for (const slot of afterglow.slots) slot.age += frame.dtSeconds;
  afterglow.clock += frame.dtSeconds;
  return afterglow;
}

// One copy per interval at most, so a slow frame never stacks several copies at the same age.
function captureAfterglow(afterglow, trace, brightness) {
  if (afterglow.clock < GHOST_INTERVAL_S) return;
  afterglow.clock = Math.min(afterglow.clock - GHOST_INTERVAL_S, GHOST_INTERVAL_S);
  const slot = afterglow.slots[afterglow.next];
  slot.xs.set(trace.xs);
  slot.ys.set(trace.ys);
  slot.age = 0;
  slot.brightness = brightness;
  afterglow.next = (afterglow.next + 1) % GHOSTS;
}

// The dot grid, center cross and ticks of a scope faceplate, faded toward the edge by one elliptical gradient.
function drawGraticule(ctx, frame, style, strength) {
  const alpha = style.gridAlpha * strength;
  if (alpha < MIN_ALPHA) return;
  const { width, height, pad } = frame;
  const centerX = width / 2;
  const centerY = height / 2;
  const halfWidth = width / 2 - pad;
  const halfHeight = height / 2 - pad;
  const division = Math.max(GRID_MIN_PX, (Math.min(width, height) - 2 * pad) / GRID_DIVISIONS);
  const tickStep = division / 5 >= GRID_TICK_MIN_PX ? division / 5 : division / 2;

  ctx.beginPath();
  addGridDots(ctx, centerX, centerY, halfWidth, halfHeight, division);
  ctx.rect(centerX - halfWidth, centerY - GRID_LINE / 2, halfWidth * 2, GRID_LINE);
  ctx.rect(centerX - GRID_LINE / 2, centerY - halfHeight, GRID_LINE, halfHeight * 2);
  for (let i = 1; i * tickStep < halfWidth; i++) {
    for (const x of [centerX - i * tickStep, centerX + i * tickStep]) ctx.rect(x - GRID_LINE / 2, centerY - GRID_TICK / 2, GRID_LINE, GRID_TICK);
  }
  for (let j = 1; j * tickStep < halfHeight; j++) {
    for (const y of [centerY - j * tickStep, centerY + j * tickStep]) ctx.rect(centerX - GRID_TICK / 2, y - GRID_LINE / 2, GRID_TICK, GRID_LINE);
  }
  // The path is already placed, so scaling now shapes only the gradient into the area's ellipse.
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.scale(halfWidth, halfHeight);
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  fade.addColorStop(0, rgba(style.grid, alpha));
  fade.addColorStop(0.6, rgba(style.grid, alpha * 0.7));
  fade.addColorStop(1, rgba(style.grid, 0));
  ctx.fillStyle = fade;
  ctx.fill();
  ctx.restore();
}

function addGridDots(ctx, centerX, centerY, halfWidth, halfHeight, division) {
  const columns = Math.floor(halfWidth / division);
  const rows = Math.floor(halfHeight / division);
  for (let i = -columns; i <= columns; i++) {
    for (let j = -rows; j <= rows; j++) {
      const outside = ((i * division) / halfWidth) ** 2 + ((j * division) / halfHeight) ** 2 >= 1;
      if (i === 0 || j === 0 || outside) continue;
      ctx.rect(centerX + i * division - GRID_DOT / 2, centerY + j * division - GRID_DOT / 2, GRID_DOT, GRID_DOT);
    }
  }
}

// Older copies cool from fresh green toward the yellower tail of P31 persistence.
function drawAfterglow(ctx, afterglow, style, scope) {
  const span = GHOSTS * GHOST_INTERVAL_S;
  ctx.lineWidth = scope.core * GHOST_WIDTH_RATIO;
  for (const slot of afterglow.slots) {
    const alpha = style.ghostAlpha * slot.brightness * Math.exp(-GHOST_DECAY_PER_SECOND * slot.age);
    if (!(alpha >= MIN_ALPHA)) continue;
    ctx.strokeStyle = rgba(mix(style.ghostYoung, style.ghostOld, Math.min(1, slot.age / span)), alpha);
    ctx.beginPath();
    ctx.moveTo(slot.xs[0], slot.ys[0]);
    for (let k = GHOST_STRIDE; k <= POINTS; k += GHOST_STRIDE) ctx.lineTo(slot.xs[k], slot.ys[k]);
    ctx.stroke();
  }
}

// Wide halos first, then the bloom, then the core, with one stroke per brightness bucket in each pass.
function drawBeam(ctx, trace, style, scope, brightness) {
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const heat = (bucket + 1) / BUCKETS;
    strokeBucket(ctx, trace, bucket, scope.halo, style.halo, style.haloAlpha * heat * brightness);
  }
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const heat = (bucket + 1) / BUCKETS;
    strokeBucket(ctx, trace, bucket, scope.bloom, beamColor(style, heat), style.bloomAlpha * heat * brightness);
  }
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    const heat = (bucket + 1) / BUCKETS;
    strokeBucket(ctx, trace, bucket, scope.core, beamColor(style, heat), (style.coreFloor + (1 - style.coreFloor) * heat) * brightness);
  }
}

function strokeBucket(ctx, trace, bucket, width, color, alpha) {
  const { xs, ys, buckets } = trace;
  if (trace.counts[bucket] === 0 || alpha < MIN_ALPHA) return;
  ctx.lineWidth = width;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.beginPath();
  for (let k = 0; k < POINTS; k++) {
    if (buckets[k] !== bucket) continue;
    if (k === 0 || buckets[k - 1] !== bucket) ctx.moveTo(xs[k], ys[k]);
    ctx.lineTo(xs[k + 1], ys[k + 1]);
  }
  ctx.stroke();
}

// Only the hottest buckets whiten, the way an overdriven phosphor saturates.
function beamColor(style, heat) {
  const lowest = 1 / BUCKETS;
  return mix(style.dim, style.hot, ((heat - lowest) / (1 - lowest)) ** 2);
}

// Each head drags a tail that brightens toward it, and the tails of all heads share one stroke per step.
function drawHeads(ctx, trace, style, scope, lap, brightness) {
  if (brightness < MIN_ALPHA) return;
  const positions = Array.from({ length: HEADS }, (_, h) => ((lap + h / HEADS) % 1) * POINTS);
  const stepLength = HEAD_TAIL / TAIL_STEPS;
  ctx.lineWidth = scope.bloom;
  for (let step = 0; step < TAIL_STEPS; step++) {
    ctx.strokeStyle = rgba(style.hot, brightness * ((step + 1) / TAIL_STEPS) ** 1.5);
    ctx.beginPath();
    for (const position of positions) {
      const start = Math.floor(position) - HEAD_TAIL + step * stepLength;
      for (let j = start; j <= start + stepLength; j++) {
        const k = ((j % POINTS) + POINTS) % POINTS;
        if (j === start) ctx.moveTo(trace.xs[k], trace.ys[k]);
        else ctx.lineTo(trace.xs[k], trace.ys[k]);
      }
    }
    ctx.stroke();
  }
  for (const position of positions) {
    const index = Math.floor(position) % POINTS;
    const along = position - Math.floor(position);
    const x = trace.xs[index] + (trace.xs[index + 1] - trace.xs[index]) * along;
    const y = trace.ys[index] + (trace.ys[index + 1] - trace.ys[index]) * along;
    fillGlow(ctx, x, y, scope.headRadius, style, brightness);
  }
}

function drawSpot(ctx, scope, style, strength) {
  const alpha = SPOT_GAIN * strength;
  if (alpha < MIN_ALPHA) return;
  fillGlow(ctx, scope.centerX, scope.centerY, scope.headRadius * SPOT_RADIUS_RATIO, style, alpha);
}

// A hot center falling to clear at the radius, so the glow ends inside the margin it was sized for.
function fillGlow(ctx, x, y, radius, style, alpha) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, rgba(style.hot, alpha));
  glow.addColorStop(0.3, rgba(style.halo, alpha * 0.45));
  glow.addColorStop(1, rgba(style.halo, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

function mix(from, to, amount) {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default { label: 'Phosphor Lissajous', draw };
