import { average, detectBeat, rgba } from '../visualizer-kit.js';

const TAU = Math.PI * 2;
// Widths and radii are CSS pixels at this shorter side, and scale with the area between the two limits.
const SCALE_REFERENCE_PX = 160;
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.4;
// The field keeps half the widest stroke plus this gap inside the pad, so no glow reaches the faded edge.
const EDGE_GAP_PX = 1.5;
const MIN_FIELD_PX = 6;
// A superellipse reaches into the corners of a wide strip that an ellipse would leave empty.
const FIELD_POWER = 4;
const CELL_POWER = 2;
// Terminals spread along the long side, one per cell of about this width to height ratio.
const CELL_ASPECT = 1.25;
const MAX_TERMINALS = 3;
// One tendril per this many pixels of a cell's mean diameter.
const TENDRIL_SPACING_PX = 22;
const MIN_TENDRILS = 4;
const MAX_TENDRILS = 8;
// Midpoint displacement halves each span, so every segment count is a power of two. Paths take about one
// segment per this many pixels, so a short path in the phone strip costs fewer points.
const SEGMENT_PX = 6;
const TWIG_SEGMENTS = 4;
const BRANCH_SEGMENTS = 16;
const SUB_BRANCH_SEGMENTS = 8;
const SPARK_SEGMENTS = 3;
// Each finer level of displacement keeps this share of the coarser one, which sets how jagged a path looks.
const ROUGH_FALLOFF = 0.58;
const FREE_END_SPREAD = 0.6;
// A point past this share of its region's radius eases toward the rim, so a jagged path never flattens on it.
const CONFINE_KNEE = 0.8;

// Below the presence floor the steady plasma is gone, so silence draws nothing.
const PRESENCE_GAIN = 4;
const PRESENCE_FLOOR = 0.02;
const TREBLE_FROM_BAND = 11;
const TENDRIL_FIRST_BAND = 1;
const TENDRIL_BAND_SPAN = 13;
const BRIDGE_FIRST_BAND = 4;

// Treble in a track runs between about these two levels, which map to smooth flow and full crackle.
const CRACKLE_FROM = 0.15;
const CRACKLE_SPAN = 0.55;
// Shapes change this many times a second. Smooth flow eases between shapes, full crackle snaps between them.
const WANDER_BASE = 1.2;
const WANDER_CRACKLE = 26;
// A long frame skips at most one shape, so the curve never jumps past the next key.
const WANDER_PROGRESS_MAX = 0.999;
// Jaggedness as a share of a path's length.
const ROUGH_BASE = 0.015;
const ROUGH_CRACKLE = 0.15;
// Fresh noise each frame on top of the wander, the fizz of a live arc.
const FIZZ_PX = 1.4;
const DRIFT_RAD_PER_SECOND = 0.35;
const BOW_SHARE = 0.22;
const BOW_RATE_MIN = 0.4;
const BOW_RATE_SPREAD = 0.9;
const ROOT_RADIUS_PX = 3.5;
// Tendril reach is a share of the cell radius in its direction.
const REACH_FLOOR = 0.28;
const REACH_LEVEL = 0.55;
const REACH_BASS = 0.12;
const REACH_KICK = 0.18;
const REACH_MAX = 0.95;
// Tendrils are drawn in a few brightness steps, one path per step, so a wide area stays at a handful of paints.
const TENDRIL_STEPS = 5;
const TENDRIL_DIM = 0.25;
const TENDRIL_THIN = 0.55;
const TENDRIL_KICK_GLOW = 0.35;
// Under crackle each tendril frays into two twigs at its tip that splay wider as the treble rises.
const TWIG_SHARE = 0.2;
const TWIG_MIN_CRACKLE = 0.08;
const TWIG_ROUGHNESS = 0.3;
const TWIG_SPREAD = 0.3;
const TWIG_SPREAD_CRACKLE = 0.6;
const TWIG_WIDTH = 0.6;
const TIP_HALO_PX = 1.6;
const TIP_HALO_GROW_PX = 2.4;
const TIP_CORE_PX = 0.5;
const TIP_CORE_GROW_PX = 1;
// Each filament of a bridge lights at its own mid level, so arcs join the terminals one by one as the music swells.
const BRIDGE_THRESHOLDS = [0.3, 0.5];
const BRIDGE_RAMP = 0.25;
const BRIDGE_ROUGHNESS = 0.7;
const BRIDGE_BOW_SHARE = 0.35;
const BRIDGE_CHARGE_GLOW = 0.35;
const BRIDGE_KICK_GLOW = 0.6;

// Bass squared charges the terminals, and a beat lets the charge go once it is ready. A full charge goes alone.
const CHARGE_PER_SECOND = 1.6;
const CHARGE_READY = 0.45;
const DISCHARGE_MIN_PRESENCE = 0.3;
const TWIN_BOLT_STRENGTH = 0.85;
const TWIN_BOLT_SHARE = 0.7;
const TERMINAL_STRIKE_CHANCE = 0.6;
const MAX_BOLTS = 4;
const BOLT_ROUGHNESS = 0.09;
const BOLT_BOW_SHARE = 0.6;
const AIR_STRIKE_BOW_SHARE = 0.15;
// An air strike aims at the farthest of a few points near the rim, so it crosses as much of the field as it can.
const AIR_STRIKE_TRIES = 6;
const AIR_STRIKE_REACH = 0.75;
const AIR_STRIKE_REACH_SPREAD = 0.2;
// A weak discharge still reads as lightning, so strength sets only part of a bolt's brightness.
const BOLT_GLOW_FLOOR = 0.55;
// Chance per point of the main channel to fork, scaled by the strength of the discharge.
const BRANCH_CHANCE = 0.14;
const MAX_BRANCHES = 9;
const BRANCH_ROUGHNESS = 0.14;
const BRANCH_TURN = 0.35;
const BRANCH_TURN_SPREAD = 0.65;
const BRANCH_REACH = 0.3;
const BRANCH_REACH_SPREAD = 0.3;
const SUB_BRANCH_CHANCE = 0.5;
const SUB_BRANCH_REACH = 0.45;
const MIN_BRANCH_PX = 4;
// A fork aimed past the rim would be squashed flat along it, so it is shortened until its end lands inside.
const BRANCH_END_LIMIT = 0.85;
const BRANCH_SHORTEN = 0.7;
// Branches carry less current, so they are thinner and flicker out before the main channel.
const BRANCH_WIDTH = 0.55;
const BRANCH_FADE_POWER = 1.6;
// The leader shoots out from its terminal over this time, and each fork grows once the leader passes it.
const LEADER_S = 0.06;
const FORK_GROW_SHARE = 0.5;
// Lightning strikes again down the same channel, so a bolt flickers before it fades.
const STRIKE_DELAYS_S = [0, 0.08, 0.19];
const STRIKE_JITTER_S = 0.04;
const STRIKE_WEIGHTS = [1, 0.75, 0.5];
const BOLT_DECAY_PER_SECOND = 10;
const BOLT_TAIL_S = 0.5;
const KICK_DECAY_PER_SECOND = 5;
const FLASH_REDUCED = 0.5;

const SPARKS_PER_SECOND = 70;
// The spark rate is set for this many tendrils and scales with the actual count, so a wide area crackles as densely.
const SPARK_TENDRIL_REFERENCE = 14;
const MAX_SPARKS = 48;
const SPARK_STEP_PX = 3.2;
const SPARK_TURN = 1.1;
const SPARK_LIFE_S = 0.08;
const SPARK_BRIDGE_CHANCE = 0.3;

const CORE_RADIUS_PX = 24;
const CORE_LIMIT = 0.6;
const CORE_BASE = 0.55;
const CORE_BASS = 0.45;
const CORE_FLASH = 0.6;
const CORE_SWELL_BASS = 0.45;
const CORE_SWELL_CHARGE = 0.4;
const CORE_SWELL_FLASH = 0.8;

// Wide faint strokes under narrow bright ones build a soft glow without shadowBlur. Widths are at a scale of 1.
const PLASMA_STROKES = [{ part: 'halo', width: 7 }, { part: 'glow', width: 2.6 }, { part: 'core', width: 1.1 }];
const TWIG_STROKES = PLASMA_STROKES.slice(1);
const BOLT_STROKES = [{ part: 'bloom', width: 14 }, { part: 'halo', width: 7.5 }, { part: 'glow', width: 3.6 }, { part: 'core', width: 1.8 }];
const SPARK_STROKES = [{ part: 'glow', width: 2.6 }, { part: 'core', width: 0.9 }];
const WIDEST_STROKE = Math.max(...[...PLASMA_STROKES, ...BOLT_STROKES, ...SPARK_STROKES].map((stroke) => stroke.width));

// The dark card takes added light, so arcs run white hot where they cross. White swallows added light, so the
// light card gets deep saturated blues painted over it instead. Plasma leans violet and lightning leans cyan,
// so a bolt stands out from the tendrils it crosses.
const INK = {
  dark: {
    blend: 'lighter',
    plasma: {
      halo: [{ r: 110, g: 70, b: 255 }, 0.12],
      glow: [{ r: 160, g: 130, b: 255 }, 0.3],
      core: [{ r: 225, g: 215, b: 255 }, 0.78],
    },
    bolt: {
      bloom: [{ r: 50, g: 110, b: 255 }, 0.09],
      halo: [{ r: 80, g: 165, b: 255 }, 0.2],
      glow: [{ r: 170, g: 220, b: 255 }, 0.6],
      core: [{ r: 255, g: 255, b: 255 }, 1],
    },
    core: [
      [0, { r: 255, g: 255, b: 255 }, 1],
      [0.1, { r: 225, g: 225, b: 255 }, 0.9],
      [0.25, { r: 150, g: 130, b: 255 }, 0.45],
      [0.5, { r: 100, g: 70, b: 255 }, 0.15],
      [0.75, { r: 80, g: 60, b: 255 }, 0.05],
      [1, { r: 70, g: 50, b: 255 }, 0],
    ],
    spark: {
      glow: [{ r: 150, g: 200, b: 255 }, 0.45],
      core: [{ r: 240, g: 250, b: 255 }, 1],
    },
    flash: [{ r: 70, g: 120, b: 255 }, 0.18],
  },
  light: {
    blend: 'source-over',
    plasma: {
      halo: [{ r: 140, g: 110, b: 252 }, 0.08],
      glow: [{ r: 110, g: 75, b: 235 }, 0.28],
      core: [{ r: 75, g: 40, b: 190 }, 0.8],
    },
    bolt: {
      bloom: [{ r: 80, g: 145, b: 255 }, 0.08],
      halo: [{ r: 40, g: 125, b: 255 }, 0.18],
      glow: [{ r: 15, g: 90, b: 245 }, 0.6],
      core: [{ r: 5, g: 25, b: 130 }, 1],
    },
    core: [
      [0, { r: 40, g: 20, b: 150 }, 0.95],
      [0.12, { r: 70, g: 50, b: 225 }, 0.7],
      [0.3, { r: 110, g: 90, b: 250 }, 0.25],
      [0.6, { r: 140, g: 120, b: 255 }, 0.07],
      [1, { r: 150, g: 140, b: 255 }, 0],
    ],
    spark: {
      glow: [{ r: 60, g: 135, b: 255 }, 0.3],
      core: [{ r: 25, g: 90, b: 240 }, 0.9],
    },
    flash: [{ r: 60, g: 120, b: 255 }, 0.07],
  },
};

/** Plasma terminals that reach with the spectrum, crackle with the treble and let a bass charge go as lightning. */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const plasma = plasmaFor(state, frame);
  if (plasma === null) return false;
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  const treble = average(frame.values, TREBLE_FROM_BAND, frame.values.length);
  const crackle = clamp((treble - CRACKLE_FROM) / CRACKLE_SPAN, 0, 1);
  const shows = presence > PRESENCE_FLOOR;

  ageDischarges(plasma, frame);
  const motion = advance(state, plasma, frame, beat, presence);
  if (shows) {
    shapePlasma(plasma, frame, motion, crackle);
    spawnSparks(plasma, frame, crackle, presence);
  }
  if (!shows && plasma.bolts.length === 0 && plasma.sparks.length === 0) return false;

  const ink = frame.theme === 'light' ? INK.light : INK.dark;
  ctx.globalCompositeOperation = ink.blend;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawFlash(ctx, plasma, ink, motion.flash);
  if (shows) drawPlasma(ctx, plasma, ink, frame, presence, motion, crackle);
  drawBolts(ctx, plasma, ink);
  drawSparks(ctx, plasma, ink);
  // Bolts and sparks outlast the music, so the host keeps drawing until they fade.
  return true;
}

// The layout depends on the size alone, so a resize rebuilds it and drops discharges placed for the old size.
function plasmaFor(state, frame) {
  const current = state.plasma;
  if (current?.width === frame.width && current?.height === frame.height) return current;
  state.plasma = buildPlasma(frame);
  return state.plasma;
}

function buildPlasma(frame) {
  const scale = clamp(Math.min(frame.width, frame.height) / SCALE_REFERENCE_PX, MIN_SCALE, MAX_SCALE);
  const inset = frame.pad + (WIDEST_STROKE * scale) / 2 + EDGE_GAP_PX;
  const field = { cx: frame.width / 2, cy: frame.height / 2, rx: frame.width / 2 - inset, ry: frame.height / 2 - inset, power: FIELD_POWER };
  if (field.rx < MIN_FIELD_PX || field.ry < MIN_FIELD_PX) return null;
  const terminals = layoutTerminals(field);
  const cell = terminals[0];
  const perTerminal = clamp(Math.round((cell.rx + cell.ry) / TENDRIL_SPACING_PX), MIN_TENDRILS, MAX_TENDRILS);
  const tendrilSegments = segmentsFor(Math.max(cell.rx, cell.ry), 3, 4);
  const bridgeSegments = segmentsFor(2 * Math.max(cell.rx, cell.ry), 3, 5);
  const tendrils = terminals.flatMap((_, t) => Array.from({ length: perTerminal }, (__, i) => createTendril(t, i, perTerminal, tendrilSegments)));
  const bridges = terminals.slice(1).map((_, i) => createBridge(i, bridgeSegments));
  const filaments = bridges.flatMap((bridge) => bridge.filaments);
  return {
    width: frame.width,
    height: frame.height,
    scale,
    field,
    minor: Math.min(field.rx, field.ry),
    terminals,
    rootRadius: ROOT_RADIUS_PX * scale,
    coreLimit: CORE_LIMIT * Math.min(cell.rx, cell.ry),
    tendrils,
    bridges,
    filaments,
    wanders: [...tendrils.flatMap((tendril) => [tendril.wander, ...tendril.twigs.map((twig) => twig.wander)]), ...filaments.map((filament) => filament.wander)],
    bolts: [],
    sparks: [],
    sparkDebt: 0,
  };
}

// Each terminal owns an elliptical cell of the field, and the cells sit side by side along the long axis.
function layoutTerminals(field) {
  const horizontal = field.rx >= field.ry;
  const major = horizontal ? field.rx : field.ry;
  const minor = horizontal ? field.ry : field.rx;
  const count = clamp(Math.round(major / minor / CELL_ASPECT), 1, MAX_TERMINALS);
  const half = major / count;
  return Array.from({ length: count }, (_, i) => {
    const along = -major + half * (2 * i + 1);
    return horizontal
      ? { cx: field.cx + along, cy: field.cy, rx: half, ry: minor, power: CELL_POWER }
      : { cx: field.cx, cy: field.cy + along, rx: minor, ry: half, power: CELL_POWER };
  });
}

function createTendril(terminal, index, count, segments) {
  return {
    terminal,
    angle: ((index + Math.random()) / count) * TAU,
    spin: (Math.random() * 2 - 1) * DRIFT_RAD_PER_SECOND,
    // Neighbors take bands far apart, so the spectrum scatters around each terminal instead of sweeping it.
    band: TENDRIL_FIRST_BAND + ((index * 5 + terminal * 3) % TENDRIL_BAND_SPAN),
    bowPhase: Math.random() * TAU,
    bowRate: BOW_RATE_MIN + Math.random() * BOW_RATE_SPREAD,
    wander: createWander(segments, true),
    twigs: [-1, 1].map((side) => ({ side, wander: createWander(TWIG_SEGMENTS, true), points: new Float32Array((TWIG_SEGMENTS + 1) * 2) })),
    points: new Float32Array((segments + 1) * 2),
    level: 0,
  };
}

function createBridge(index, segments) {
  return {
    from: index,
    to: index + 1,
    band: BRIDGE_FIRST_BAND + 2 * index,
    filaments: BRIDGE_THRESHOLDS.map((threshold) => ({
      threshold,
      bowPhase: Math.random() * TAU,
      bowRate: BOW_RATE_MIN + Math.random() * BOW_RATE_SPREAD,
      wander: createWander(segments, false),
      points: new Float32Array((segments + 1) * 2),
      glow: 0,
    })),
  };
}

function createWander(segments, freeEnd) {
  const size = segments + 1;
  return {
    freeEnd,
    progress: 0,
    keys: Array.from({ length: 4 }, () => fillFractal(new Float32Array(size), freeEnd)),
    current: new Float32Array(size),
  };
}

// Midpoint displacement roughens a path at every scale at once, the self-similar zigzag of a real discharge.
function fillFractal(out, freeEnd) {
  const segments = out.length - 1;
  let spread = 1;
  out[0] = 0;
  out[segments] = freeEnd ? (Math.random() * 2 - 1) * FREE_END_SPREAD : 0;
  for (let step = segments; step > 1; step /= 2) {
    for (let i = step / 2; i < segments; i += step) out[i] = (out[i - step / 2] + out[i + step / 2]) / 2 + (Math.random() * 2 - 1) * spread;
    spread *= ROUGH_FALLOFF;
  }
  return out;
}

// A Catmull-Rom curve through a chain of random shapes, so a slow rate flows like plasma without pausing on each
// shape and a fast one snaps like an arc.
function stepWander(wander, dt, rate) {
  wander.progress += dt * rate;
  if (wander.progress >= 1) {
    wander.keys.push(wander.keys.shift());
    fillFractal(wander.keys[3], wander.freeEnd);
    wander.progress = Math.min(wander.progress - 1, WANDER_PROGRESS_MAX);
  }
  const t = wander.progress;
  const [p0, p1, p2, p3] = wander.keys;
  for (let i = 0; i < wander.current.length; i++) {
    wander.current[i] = 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t * t + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t * t * t);
  }
  return wander.current;
}

function ageDischarges(plasma, frame) {
  for (const bolt of plasma.bolts) bolt.age += frame.dtSeconds;
  for (const spark of plasma.sparks) spark.life -= frame.dtSeconds;
  plasma.bolts = plasma.bolts.filter((bolt) => bolt.age < bolt.strikes[bolt.strikes.length - 1] + BOLT_TAIL_S);
  plasma.sparks = plasma.sparks.filter((spark) => spark.life > 0);
}

// The clock stops under reduced motion, while the charge, the bolts and their fade still follow the levels.
function advance(state, plasma, frame, beat, presence) {
  const dt = frame.reducedMotion ? 0 : frame.dtSeconds;
  state.time = (state.time ?? 0) + dt;
  state.kick = (state.kick ?? 0) * Math.exp(-KICK_DECAY_PER_SECOND * frame.dtSeconds);
  state.charge = Math.min(1, (state.charge ?? 0) + frame.dtSeconds * CHARGE_PER_SECOND * frame.bass * frame.bass);
  const ready = (beat && state.charge >= CHARGE_READY) || state.charge >= 1;
  if (ready && presence >= DISCHARGE_MIN_PRESENCE) discharge(state, plasma, frame);
  const flash = plasma.bolts.reduce((brightest, bolt) => Math.max(brightest, boltGlow(bolt)), 0);
  return { dt, time: state.time, kick: state.kick, charge: state.charge, flash: flash * (frame.reducedMotion ? FLASH_REDUCED : 1) };
}

function discharge(state, plasma, frame) {
  const strength = Math.min(1, 0.35 + 0.45 * state.charge + 0.35 * frame.bass);
  state.charge = 0;
  state.kick = 1;
  plasma.bolts.push(createBolt(plasma, strength, frame.reducedMotion));
  if (strength > TWIN_BOLT_STRENGTH) plasma.bolts.push(createBolt(plasma, strength * TWIN_BOLT_SHARE, frame.reducedMotion));
  plasma.bolts.splice(0, Math.max(0, plasma.bolts.length - MAX_BOLTS));
  // The jolt snaps every strand into a new shape at once, so the plasma visibly flinches.
  if (frame.reducedMotion) return;
  for (const wander of plasma.wanders) {
    for (const key of wander.keys) fillFractal(key, wander.freeEnd);
    wander.progress = 0;
  }
}

function createBolt(plasma, strength, steady) {
  const { field, terminals } = plasma;
  const source = terminals[Math.floor(Math.random() * terminals.length)];
  const start = { x: source.cx, y: source.cy };
  const toTerminal = terminals.length > 1 && Math.random() < TERMINAL_STRIKE_CHANCE;
  const end = toTerminal ? otherTerminal(terminals, source) : airPoint(field, start);
  const side = Math.random() < 0.5 ? -1 : 1;
  const bow = side * plasma.minor * (toTerminal ? BOLT_BOW_SHARE * (0.4 + 0.6 * Math.random()) : AIR_STRIKE_BOW_SHARE * Math.random());
  const length = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  const segments = segmentsFor(length, 4, 6);
  const main = layPath(new Float32Array((segments + 1) * 2), start, end, fillFractal(new Float32Array(segments + 1), !toTerminal), BOLT_ROUGHNESS, bow, field, 0);
  return {
    main,
    branches: growBranches(main, length, strength, field),
    strength,
    age: 0,
    leader: steady ? 0 : LEADER_S,
    strikes: steady ? [0] : STRIKE_DELAYS_S.map((delay, i) => (i === 0 ? 0 : delay + Math.random() * STRIKE_JITTER_S)),
  };
}

function otherTerminal(terminals, source) {
  const others = terminals.filter((terminal) => terminal !== source);
  const target = others[Math.floor(Math.random() * others.length)];
  return { x: target.cx, y: target.cy };
}

function airPoint(field, from) {
  let best = null;
  let bestDistance = -1;
  for (let i = 0; i < AIR_STRIKE_TRIES; i++) {
    const angle = Math.random() * TAU;
    const reach = AIR_STRIKE_REACH + Math.random() * AIR_STRIKE_REACH_SPREAD;
    const point = { x: field.cx + Math.cos(angle) * field.rx * reach, y: field.cy + Math.sin(angle) * field.ry * reach };
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    if (distance > bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

// Forks lean the way the channel runs and shrink toward its end, the way a stepped leader spreads.
function growBranches(main, length, strength, region) {
  const branches = [];
  const last = main.length / 2 - 1;
  for (let i = 2; i < last - 1 && branches.length < MAX_BRANCHES; i++) {
    if (Math.random() > BRANCH_CHANCE * strength) continue;
    const heading = Math.atan2(main[2 * i + 3] - main[2 * i - 1], main[2 * i + 2] - main[2 * i - 2]);
    const turn = heading + (Math.random() < 0.5 ? -1 : 1) * (BRANCH_TURN + Math.random() * BRANCH_TURN_SPREAD);
    const reach = length * (1 - i / last) * (BRANCH_REACH + Math.random() * BRANCH_REACH_SPREAD);
    if (reach < MIN_BRANCH_PX) continue;
    const branch = { points: forkPath(main, i, turn, reach, BRANCH_SEGMENTS, region), fork: i / last };
    branches.push(branch);
    if (Math.random() >= SUB_BRANCH_CHANCE || branches.length >= MAX_BRANCHES) continue;
    const subTurn = turn + (Math.random() < 0.5 ? -1 : 1) * (BRANCH_TURN + Math.random() * BRANCH_TURN_SPREAD);
    const subPoints = forkPath(branch.points, BRANCH_SEGMENTS / 2, subTurn, reach * SUB_BRANCH_REACH, SUB_BRANCH_SEGMENTS, region);
    branches.push({ points: subPoints, fork: branch.fork + FORK_GROW_SHARE / 2 });
  }
  return branches;
}

function forkPath(parent, index, heading, reach, segments, region) {
  const start = { x: parent[2 * index], y: parent[2 * index + 1] };
  const end = { x: start.x + Math.cos(heading) * reach, y: start.y + Math.sin(heading) * reach };
  for (let tries = 0; tries < 6 && normIn(region, end.x, end.y) > BRANCH_END_LIMIT; tries++) {
    end.x = start.x + (end.x - start.x) * BRANCH_SHORTEN;
    end.y = start.y + (end.y - start.y) * BRANCH_SHORTEN;
  }
  return layPath(new Float32Array((segments + 1) * 2), start, end, fillFractal(new Float32Array(segments + 1), true), BRANCH_ROUGHNESS, 0, region, 0);
}

// Lays a path from start to end, bowed to one side and roughened by the offsets, confined to the region.
function layPath(points, start, end, offsets, roughness, bow, region, fizz) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  const segments = offsets.length - 1;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const jitter = i === 0 ? 0 : (Math.random() * 2 - 1) * fizz;
    const lift = bow * 4 * t * (1 - t) + offsets[i] * roughness * length + jitter;
    confinePoint(points, i, start.x + dx * t + normalX * lift, start.y + dy * t + normalY * lift, region);
  }
  return points;
}

// A point past the knee is eased toward the rim on a soft curve, so it always lands inside the region.
function confinePoint(points, index, x, y, region) {
  const u = (x - region.cx) / region.rx;
  const v = (y - region.cy) / region.ry;
  const norm = normIn(region, x, y);
  const squeeze = norm <= CONFINE_KNEE ? 1 : (CONFINE_KNEE + (1 - CONFINE_KNEE) * Math.tanh((norm - CONFINE_KNEE) / (1 - CONFINE_KNEE))) / norm;
  points[2 * index] = region.cx + u * squeeze * region.rx;
  points[2 * index + 1] = region.cy + v * squeeze * region.ry;
}

// How far a point sits from the region's center, where 1 is the rim.
function normIn(region, x, y) {
  const u = Math.abs(x - region.cx) / region.rx;
  const v = Math.abs(y - region.cy) / region.ry;
  return (u ** region.power + v ** region.power) ** (1 / region.power);
}

function shapePlasma(plasma, frame, motion, crackle) {
  const look = {
    crackle,
    rate: WANDER_BASE + WANDER_CRACKLE * crackle,
    roughness: ROUGH_BASE + ROUGH_CRACKLE * crackle,
    fizz: frame.reducedMotion ? 0 : FIZZ_PX * plasma.scale * crackle,
  };
  for (const tendril of plasma.tendrils) shapeTendril(tendril, plasma, frame, motion, look);
  for (const bridge of plasma.bridges) shapeBridge(bridge, plasma, frame, motion, look);
}

function shapeTendril(tendril, plasma, frame, motion, look) {
  const cell = plasma.terminals[tendril.terminal];
  const level = frame.values[tendril.band];
  tendril.angle += tendril.spin * motion.dt * (0.5 + frame.energy);
  const cos = Math.cos(tendril.angle);
  const sin = Math.sin(tendril.angle);
  const reach = Math.min(REACH_MAX, REACH_FLOOR + REACH_LEVEL * level + REACH_BASS * frame.bass + REACH_KICK * motion.kick);
  const start = { x: cell.cx + cos * plasma.rootRadius, y: cell.cy + sin * plasma.rootRadius };
  const end = { x: cell.cx + cos * cell.rx * reach, y: cell.cy + sin * cell.ry * reach };
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const bow = BOW_SHARE * length * Math.sin(motion.time * tendril.bowRate + tendril.bowPhase);
  layPath(tendril.points, start, end, stepWander(tendril.wander, motion.dt, look.rate), look.roughness, bow, cell, look.fizz);
  tendril.level = level;

  const tip = tipOf(tendril.points);
  const heading = Math.atan2(end.y - start.y, end.x - start.x);
  const twigLength = length * TWIG_SHARE * look.crackle;
  for (const twig of tendril.twigs) {
    const turn = heading + twig.side * (TWIG_SPREAD + TWIG_SPREAD_CRACKLE * look.crackle);
    const twigEnd = { x: tip.x + Math.cos(turn) * twigLength, y: tip.y + Math.sin(turn) * twigLength };
    layPath(twig.points, tip, twigEnd, stepWander(twig.wander, motion.dt, look.rate), TWIG_ROUGHNESS, 0, cell, look.fizz);
  }
}

function shapeBridge(bridge, plasma, frame, motion, look) {
  const from = plasma.terminals[bridge.from];
  const to = plasma.terminals[bridge.to];
  const level = (frame.values[bridge.band] + frame.values[bridge.band + 1]) / 2;
  const distance = Math.hypot(to.cx - from.cx, to.cy - from.cy);
  const ux = (to.cx - from.cx) / distance;
  const uy = (to.cy - from.cy) / distance;
  const start = { x: from.cx + ux * plasma.rootRadius, y: from.cy + uy * plasma.rootRadius };
  const end = { x: to.cx - ux * plasma.rootRadius, y: to.cy - uy * plasma.rootRadius };
  for (const filament of bridge.filaments) {
    const bow = plasma.minor * BRIDGE_BOW_SHARE * Math.sin(motion.time * filament.bowRate + filament.bowPhase);
    const offsets = stepWander(filament.wander, motion.dt, look.rate);
    layPath(filament.points, start, end, offsets, look.roughness * BRIDGE_ROUGHNESS, bow, plasma.field, look.fizz);
    filament.glow = smoothstep(filament.threshold, filament.threshold + BRIDGE_RAMP, level);
  }
}

function spawnSparks(plasma, frame, crackle, presence) {
  if (frame.reducedMotion) return;
  plasma.sparkDebt += frame.dtSeconds * SPARKS_PER_SECOND * (plasma.tendrils.length / SPARK_TENDRIL_REFERENCE) * crackle * crackle * presence;
  while (plasma.sparkDebt >= 1) {
    plasma.sparkDebt -= 1;
    if (plasma.sparks.length < MAX_SPARKS) plasma.sparks.push(createSpark(plasma));
  }
}

// A spark is a short zigzag thrown off a tendril tip or a lit bridge, gone within a few frames.
function createSpark(plasma) {
  const origin = sparkOrigin(plasma);
  const points = new Float32Array((SPARK_SEGMENTS + 1) * 2);
  let heading = Math.random() * TAU;
  let x = origin.x;
  let y = origin.y;
  confinePoint(points, 0, x, y, plasma.field);
  for (let i = 1; i <= SPARK_SEGMENTS; i++) {
    heading += (Math.random() * 2 - 1) * SPARK_TURN;
    const step = SPARK_STEP_PX * plasma.scale * (0.6 + Math.random() * 0.8);
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    confinePoint(points, i, x, y, plasma.field);
  }
  return { points, life: SPARK_LIFE_S * (0.6 + Math.random() * 0.8) };
}

function sparkOrigin(plasma) {
  const lit = plasma.filaments.filter((filament) => filament.glow > 0.3);
  if (lit.length > 0 && Math.random() < SPARK_BRIDGE_CHANCE) {
    const filament = lit[Math.floor(Math.random() * lit.length)];
    const index = 1 + Math.floor(Math.random() * (filament.points.length / 2 - 2));
    return { x: filament.points[2 * index], y: filament.points[2 * index + 1] };
  }
  return tipOf(plasma.tendrils[Math.floor(Math.random() * plasma.tendrils.length)].points);
}

// A discharge lights the air around it, a wash over the whole field that fades with the bolt.
function drawFlash(ctx, plasma, ink, flash) {
  if (flash < 0.01) return;
  const { field } = plasma;
  const [color, alpha] = ink.flash;
  ctx.save();
  ctx.translate(field.cx, field.cy);
  ctx.scale(field.rx, field.ry);
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  wash.addColorStop(0, rgba(color, alpha * flash));
  wash.addColorStop(0.55, rgba(color, alpha * flash * 0.45));
  wash.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function drawPlasma(ctx, plasma, ink, frame, presence, motion, crackle) {
  for (const filament of plasma.filaments) {
    const glow = Math.min(1, presence * (filament.glow + BRIDGE_CHARGE_GLOW * motion.charge) + BRIDGE_KICK_GLOW * motion.kick);
    strokeLayered(ctx, [filament.points], PLASMA_STROKES, ink.plasma, glow, plasma.scale);
  }
  drawTendrils(ctx, plasma, ink, presence, motion);
  if (crackle > TWIG_MIN_CRACKLE) {
    const twigs = plasma.tendrils.flatMap((tendril) => tendril.twigs.map((twig) => twig.points));
    strokeLayered(ctx, twigs, TWIG_STROKES, ink.plasma, presence * crackle, plasma.scale * TWIG_WIDTH);
  }
  drawTips(ctx, plasma, ink, presence);
  drawCores(ctx, plasma, ink, presence, frame.bass, motion);
}

function drawTendrils(ctx, plasma, ink, presence, motion) {
  for (let step = 0; step < TENDRIL_STEPS; step++) {
    const level = step / (TENDRIL_STEPS - 1);
    const members = plasma.tendrils.filter((tendril) => Math.round(tendril.level * (TENDRIL_STEPS - 1)) === step);
    if (members.length === 0) continue;
    const glow = Math.min(1, presence * (TENDRIL_DIM + (1 - TENDRIL_DIM) * level) + TENDRIL_KICK_GLOW * motion.kick);
    const width = plasma.scale * (TENDRIL_THIN + (1 - TENDRIL_THIN) * level);
    strokeLayered(ctx, members.map((tendril) => tendril.points), PLASMA_STROKES, ink.plasma, glow, width);
  }
}

// One path takes every stroke of the stack, widest and faintest first, so the glow sits under the bright core.
function strokeLayered(ctx, paths, strokes, colors, glow, widthScale) {
  if (glow <= 0.01) return;
  ctx.beginPath();
  for (const points of paths) {
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  }
  for (const { part, width } of strokes) {
    const [color, alpha] = colors[part];
    ctx.lineWidth = width * widthScale;
    ctx.strokeStyle = rgba(color, alpha * glow);
    ctx.stroke();
  }
}

// Each tendril pools into a bead where it ends, the spot where a plasma globe's filament meets the glass.
function drawTips(ctx, plasma, ink, presence) {
  const beads = [['glow', TIP_HALO_PX, TIP_HALO_GROW_PX], ['core', TIP_CORE_PX, TIP_CORE_GROW_PX]];
  for (const [part, radius, grow] of beads) {
    const [color, alpha] = ink.plasma[part];
    ctx.beginPath();
    for (const tendril of plasma.tendrils) {
      const tip = tipOf(tendril.points);
      const size = (radius + grow * tendril.level) * plasma.scale;
      ctx.moveTo(tip.x + size, tip.y);
      ctx.arc(tip.x, tip.y, size, 0, TAU);
    }
    ctx.fillStyle = rgba(color, alpha * presence);
    ctx.fill();
  }
}

// The terminal glows with the bass, swells as the charge builds and blazes when it lets go.
function drawCores(ctx, plasma, ink, presence, bass, motion) {
  const intensity = Math.min(1, presence * (CORE_BASE + CORE_BASS * bass) + CORE_FLASH * motion.flash);
  const swell = 1 + CORE_SWELL_BASS * bass + CORE_SWELL_CHARGE * motion.charge + CORE_SWELL_FLASH * motion.flash;
  const radius = Math.min(plasma.coreLimit, CORE_RADIUS_PX * plasma.scale * swell);
  for (const cell of plasma.terminals) {
    const gradient = ctx.createRadialGradient(cell.cx, cell.cy, 0, cell.cx, cell.cy, radius);
    for (const [offset, color, alpha] of ink.core) gradient.addColorStop(offset, rgba(color, alpha * intensity));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cell.cx, cell.cy, radius, 0, TAU);
    ctx.fill();
  }
}

function drawBolts(ctx, plasma, ink) {
  for (const bolt of plasma.bolts) {
    const glow = boltGlow(bolt) * (BOLT_GLOW_FLOOR + (1 - BOLT_GLOW_FLOOR) * bolt.strength);
    const lead = bolt.leader === 0 ? 1 : bolt.age / bolt.leader;
    const forks = bolt.branches
      .filter((branch) => branch.fork < lead)
      .map((branch) => grown(branch.points, (lead - branch.fork) / FORK_GROW_SHARE));
    strokeLayered(ctx, [grown(bolt.main, lead)], BOLT_STROKES, ink.bolt, glow, plasma.scale);
    strokeLayered(ctx, forks, BOLT_STROKES, ink.bolt, glow ** BRANCH_FADE_POWER, plasma.scale * BRANCH_WIDTH);
  }
}

// The leading share of a path, at least one segment long so a fresh bolt already shows a spark at its terminal.
function grown(points, share) {
  const segments = points.length / 2 - 1;
  const shown = clamp(Math.ceil(share * segments), 1, segments);
  return shown === segments ? points : points.subarray(0, (shown + 1) * 2);
}

function drawSparks(ctx, plasma, ink) {
  if (plasma.sparks.length === 0) return;
  strokeLayered(ctx, plasma.sparks.map((spark) => spark.points), SPARK_STROKES, ink.spark, 1, plasma.scale);
}

// Each return stroke flares and decays on its own, and the strokes add up to the bolt's flicker.
function boltGlow(bolt) {
  let glow = 0;
  for (const [i, at] of bolt.strikes.entries()) {
    if (bolt.age >= at) glow += STRIKE_WEIGHTS[i] * Math.exp(-(bolt.age - at) * BOLT_DECAY_PER_SECOND);
  }
  return Math.min(1, glow);
}

function tipOf(points) {
  return { x: points[points.length - 2], y: points[points.length - 1] };
}

// A power of two between the two exponents, near one segment per SEGMENT_PX of the length.
function segmentsFor(length, fewest, most) {
  return 2 ** clamp(Math.round(Math.log2(Math.max(1, length) / SEGMENT_PX)), fewest, most);
}

function smoothstep(from, to, value) {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default { label: 'Plasma lightning', draw };
