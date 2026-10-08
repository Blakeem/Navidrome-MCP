import { average, detectBeat, hslOf, resample } from '../visualizer-kit.js';

const TAU = Math.PI * 2;

// The symmetry orders the kaleidoscope turns through, one step every few beats.
const FOLDS = [6, 8, 12, 5, 10, 7, 9];
const FOLD_BEATS = 8;
// A quiet track with few beats still turns the kaleidoscope now and then.
const FOLD_HOLD_MAX_S = 14;
const FOLD_FADE_S = 0.8;
// The outgoing symmetry shrinks and turns away while the incoming one blooms out from this scale.
const FOLD_SHRINK = 0.3;
const FOLD_BLOOM_FROM = 0.55;
const FOLD_TWIST_RAD = 0.6;
// Each new symmetry moves the hue a golden angle on, so no two in a row share a color.
const GOLDEN_ANGLE_DEG = 137.508;
const HUE_DRIFT_DEG_PER_SECOND = 4;

// The layers that turn, as indexes into the angle arrays.
const ROSETTE = 0;
const LOTUS_OUTER = 1;
const LOTUS_INNER = 2;
const STAR = 3;
const POLYGON = 4;
const SEED = 5;
const TURNING_LAYERS = 6;
// Neighboring layers turn opposite ways at different speeds, so their alignment never holds for long.
const DRIFT_RAD_PER_SECOND = [0.08, -0.13, 0.19, -0.24, 0.31, -0.1];
const DRIFT_FLOOR = 0.35;
// Beat clicks in half sectors. Unequal steps change how the layers line up, which one shared step would not.
const CLICK_HALF_SECTORS = [1, -0.5, 0.5, -1, 1.5, 0.5];
const CLICK_RATE_PER_SECOND = 14;
const PULSE_DECAY_PER_SECOND = 5;

// Four groups of four bands from bass to treble, each scaled by its own recent peak so every layer blooms fully.
const GROUPS = 4;
const AGC_SECONDS = 8;
// Keeps a quiet group from swelling to full size on noise.
const AGC_FLOOR = 0.3;
// Points per half wedge of the rosette, bass on the mirror line and treble mid wedge.
const ROSETTE_POINTS = 9;

const PRESENCE_GAIN = 4;
// The fraction of the afterglow left after one second, so the mandala dissolves after the music stops.
const RETAIN_PER_SECOND = 0.04;
const GLOW_MIN = 0.01;

// Covers half the widest stroke, so every rim stays inside the pad.
const EDGE_MARGIN = 2;
const MAX_REFLECTIONS = 5;
const IDEAL_SHRINK = 0.72;
const SHRINK_MIN = 0.45;
const SHRINK_MAX = 0.95;
// Neighbors overlap by a fifth of their radii, so their rims cross in vesica shapes.
const LINK = 0.8;
const MIN_REFLECTION_RADIUS = 6;
// Each bounce off a mirror loses light and bends the color a little.
const REFLECTION_DIM = 0.7;
const REFLECTION_HUE_DEG = 18;
// Each reflection shows the music a little later, so beats and symmetry changes ripple out through the mirrors.
const ECHO_S = 0.06;
const HISTORY_MAX = 256;
const HALO_DEPTH = 1;

const DETAIL_FULL_RADIUS = 26;
const DETAIL_MEDIUM_RADIUS = 10;
const FINE_ROSETTE_RADIUS = 40;
const LINE_PER_RADIUS = 0.014;
const LINE_MIN = 0.7;
const LINE_MAX = 1.8;

// Fractions of a mandala's radius. Each stays at or under 1 at full level and a full pulse, so the rim bounds it.
const EYEPIECE = 0.985;
const PHI_RING = 0.618;
const ROSETTE_SHAPE = { base: 0.3, reach: 0.62, pulse: 0.05 };
const LOTUS_OUTER_SHAPE = { from: 0.3, base: 0.5, reach: 0.4, pulse: 0.05 };
const LOTUS_INNER_SHAPE = { from: 0.06, base: 0.22, reach: 0.36, pulse: 0.04 };
const STAR_SHAPE = { base: 0.38, reach: 0.44, pulse: 0.06 };
const POLYGON_SHAPE = { base: 0.16, reach: 0.3, pulse: 0 };
const SEED_SHAPE = { base: 0.08, reach: 0.17, pulse: 0 };
const JEWEL_SHAPE = { base: 0.012, reach: 0.045, pulse: 0.02 };
const BINDU_SHAPE = { base: 0.025, reach: 0.035, pulse: 0.015 };
// Petals nearly touch at their widest, yet stay narrow enough that each curve's control point sits inside the tip.
const PETAL_FILL = 1.6;
const PETAL_MAX_WIDTH = 0.45;

// Gem hues around the base: sapphire rosette, emerald and amethyst lotus rows, ruby star, gold jewels.
const HUE = { ring: 0, halo: 0, seed: -30, lotusOuter: -76, lotusInner: 54, polygon: 180, rosette: 0, star: 124, jewel: 180 };
// Additive light through glass on the dark card, multiplied ink like stained glass on the light one.
const DARK_TONE = { blend: 'lighter', saturation: 92, lightness: 62, lift: 1, alphaGain: 1, halo: 0.16 };
const LIGHT_TONE = { blend: 'multiply', saturation: 86, lightness: 42, lift: -0.4, alphaGain: 1.15, halo: 0.06 };

/**
 * A kaleidoscope mandala of mirrored wedges that blooms with the bands, clicks and changes symmetry on beats,
 * and repeats in a chain of dimming mirror reflections that carry the music outward a moment later.
 */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  prepareState(state);
  state.time += frame.dtSeconds;
  state.glow = Math.max(state.glow * RETAIN_PER_SECOND ** frame.dtSeconds, presence);
  state.hueDrift = (state.hueDrift + HUE_DRIFT_DEG_PER_SECOND * frame.dtSeconds) % 360;
  advanceFold(state, frame, beat, presence);
  advanceTurns(state, frame, beat);
  const layout = layoutFor(state, frame);
  recordPose(state, capturePose(state, frame), layout.depth * ECHO_S);

  const tone = frame.theme === 'light' ? LIGHT_TONE : DARK_TONE;
  const look = { tone, hue: hslOf(frame.palette.accent).hue + state.hueDrift };
  let shown = false;
  ctx.globalCompositeOperation = tone.blend;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const place of layout.places) {
    const pose = poseAt(state.history, state.time - place.depth * ECHO_S);
    if (pose === null) continue;
    for (const blend of pose.blends) shown = drawMandala(ctx, place, pose, look, blend) || shown;
  }
  // The afterglow and the echoes outlast the music, so the host keeps drawing until they fade.
  return shown;
}

function prepareState(state) {
  if (state.history !== undefined) return;
  state.history = [];
  state.time = 0;
  state.glow = 0;
  state.pulse = 0;
  state.hueDrift = 0;
  state.drift = new Float64Array(TURNING_LAYERS);
  state.click = new Float64Array(TURNING_LAYERS);
  state.clickTarget = new Float64Array(TURNING_LAYERS);
  state.groupPeaks = new Float32Array(GROUPS);
  state.fold = { index: 0, hue: 0 };
  state.fading = null;
  state.foldMix = 0;
  state.foldBeats = 0;
  state.foldHeld = 0;
  // The outer lotus starts between the inner petals, the way a lotus mandala lays its rows.
  state.drift[LOTUS_OUTER] = Math.PI / FOLDS[0];
}

function advanceFold(state, frame, beat, presence) {
  if (presence > 0.05) state.foldHeld += frame.dtSeconds;
  if (beat) state.foldBeats += 1;
  if (state.foldBeats >= FOLD_BEATS || state.foldHeld >= FOLD_HOLD_MAX_S) {
    state.fading = state.fold;
    state.fold = { index: (state.fold.index + 1) % FOLDS.length, hue: (state.fold.hue + GOLDEN_ANGLE_DEG) % 360 };
    state.foldMix = 0;
    state.foldBeats = 0;
    state.foldHeld = 0;
  }
  if (state.fading === null) return;
  state.foldMix += frame.dtSeconds / FOLD_FADE_S;
  if (state.foldMix >= 1) state.fading = null;
}

// Each layer drifts, and a beat clicks it a share of a sector toward a new target like a turned kaleidoscope tube.
function advanceTurns(state, frame, beat) {
  const dt = frame.reducedMotion ? 0 : frame.dtSeconds;
  const click = beat && !frame.reducedMotion;
  const halfSector = Math.PI / FOLDS[state.fold.index];
  const speed = DRIFT_FLOOR + frame.energy;
  const easing = 1 - Math.exp(-CLICK_RATE_PER_SECOND * dt);
  state.pulse = click ? 1 : state.pulse * Math.exp(-PULSE_DECAY_PER_SECOND * frame.dtSeconds);
  for (let layer = 0; layer < TURNING_LAYERS; layer++) {
    state.drift[layer] = (state.drift[layer] + DRIFT_RAD_PER_SECOND[layer] * speed * dt) % TAU;
    if (click) state.clickTarget[layer] += CLICK_HALF_SECTORS[layer] * halfSector;
    state.click[layer] += (state.clickTarget[layer] - state.click[layer]) * easing;
    // Both angles drop whole turns together, so the click still to come survives the wrap.
    const turns = Math.trunc(state.click[layer] / TAU) * TAU;
    state.click[layer] -= turns;
    state.clickTarget[layer] -= turns;
  }
}

// A pose holds everything a mandala needs, so a reflection can draw the pose from a moment ago.
function capturePose(state, frame) {
  const angles = new Float64Array(TURNING_LAYERS);
  for (let layer = 0; layer < TURNING_LAYERS; layer++) angles[layer] = state.drift[layer] + state.click[layer];
  return {
    time: state.time,
    glow: state.glow,
    pulse: state.pulse,
    energy: frame.energy,
    groups: groupBlooms(state, frame),
    spectrum: resample(frame.values, ROSETTE_POINTS),
    angles,
    blends: foldBlends(state, frame.reducedMotion),
  };
}

function groupBlooms(state, frame) {
  const keep = Math.exp(-frame.dtSeconds / AGC_SECONDS);
  const size = frame.values.length / GROUPS;
  const blooms = new Float32Array(GROUPS);
  for (let group = 0; group < GROUPS; group++) {
    const level = average(frame.values, group * size, (group + 1) * size);
    state.groupPeaks[group] = Math.max(level, state.groupPeaks[group] * keep);
    blooms[group] = Math.min(1, level / Math.max(AGC_FLOOR, state.groupPeaks[group]));
  }
  return blooms;
}

// The outgoing symmetry shrinks and turns away as the incoming one blooms out from the center.
function foldBlends(state, reducedMotion) {
  if (state.fading === null) return [{ fold: state.fold, weight: 1, scale: 1, twist: 0 }];
  const mix = state.foldMix;
  const eased = mix * mix * (3 - 2 * mix);
  const grow = 1 - (1 - mix) ** 3;
  return [
    {
      fold: state.fading,
      weight: 1 - eased,
      scale: reducedMotion ? 1 : 1 - FOLD_SHRINK * eased,
      twist: reducedMotion ? 0 : FOLD_TWIST_RAD * eased,
    },
    { fold: state.fold, weight: eased, scale: reducedMotion ? 1 : FOLD_BLOOM_FROM + (1 - FOLD_BLOOM_FROM) * grow, twist: 0 },
  ];
}

function recordPose(state, pose, keepSeconds) {
  const history = state.history;
  history.push(pose);
  // One pose older than the longest echo stays, so the farthest reflection always has one to show.
  while (history.length > HISTORY_MAX || (history.length > 1 && history[1].time <= pose.time - keepSeconds)) history.shift();
}

// The newest pose at or before the time, or null before the history reaches back that far.
function poseAt(history, time) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].time <= time) return history[i];
  }
  return null;
}

// The central mandala fills the short side, and mirror reflections taper out along the long side.
function layoutFor(state, frame) {
  const { width, height, pad } = frame;
  if (state.layout?.width === width && state.layout.height === height) return state.layout;
  const radius = Math.min(width, height) / 2 - pad - EDGE_MARGIN;
  const chain = chooseChain(radius, width / 2 - pad - EDGE_MARGIN);
  const depth = chain.radii.length - 1;
  const places = [];
  // The deepest reflections come first, so the nearer ones and the center draw over them.
  for (let level = depth; level >= 1; level--) {
    for (const side of [-1, 1]) places.push(placeOf(width / 2 + side * chain.offsets[level], height / 2, chain.radii[level], level));
  }
  if (radius >= 1) places.push(placeOf(width / 2, height / 2, radius, 0));
  state.layout = { width, height, places, depth };
  return state.layout;
}

// A reflection in a mirror is reversed, so every other depth draws mirrored.
function placeOf(x, y, radius, depth) {
  return { x, y, radius, depth, mirror: depth % 2 === 0 ? 1 : -1, dim: REFLECTION_DIM ** depth };
}

// The reflection count whose fitted taper sits closest to the ideal ratio.
function chooseChain(radius, reach) {
  let best = { count: 0, shrink: 0 };
  for (let count = 1; count <= MAX_REFLECTIONS && radius >= 1; count++) {
    const shrink = fitShrink(radius, reach, count);
    if (shrink === null || radius * shrink ** count < MIN_REFLECTION_RADIUS) continue;
    if (best.count === 0 || Math.abs(shrink - IDEAL_SHRINK) < Math.abs(best.shrink - IDEAL_SHRINK)) best = { count, shrink };
  }
  return chainOf(radius, best.count, best.shrink);
}

// Each reflection shrinks by the same ratio and overlaps its neighbor by the same share.
function chainOf(radius, count, shrink) {
  const radii = [radius];
  const offsets = [0];
  for (let depth = 1; depth <= count; depth++) {
    radii.push(radii[depth - 1] * shrink);
    offsets.push(offsets[depth - 1] + LINK * (radii[depth - 1] + radii[depth]));
  }
  return { radii, offsets };
}

// The ratio whose chain ends at the reach, found by bisection since the chain's span grows with the ratio.
function fitShrink(radius, reach, count) {
  const span = (shrink) => {
    const chain = chainOf(radius, count, shrink);
    return chain.offsets[count] + chain.radii[count];
  };
  if (span(SHRINK_MIN) > reach) return null;
  if (span(SHRINK_MAX) <= reach) return SHRINK_MAX;
  let low = SHRINK_MIN;
  let high = SHRINK_MAX;
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (span(middle) > reach) high = middle;
    else low = middle;
  }
  return low;
}

// One mandala from the rim in. Small reflections drop the fine layers, which would only blur at their size.
function drawMandala(c, place, pose, look, blend) {
  const alpha = pose.glow * place.dim * blend.weight;
  if (alpha < GLOW_MIN) return false;
  const fold = FOLDS[blend.fold.index];
  const size = place.radius * blend.scale;
  const [bass, lowMid, highMid, treble] = pose.groups;
  const pulse = pose.pulse;
  const detail = place.radius >= DETAIL_FULL_RADIUS ? 2 : place.radius >= DETAIL_MEDIUM_RADIUS ? 1 : 0;
  const line = Math.min(LINE_MAX, Math.max(LINE_MIN, place.radius * LINE_PER_RADIUS));
  const pen = { c, look, alpha, line, hue: look.hue + blend.fold.hue + place.depth * REFLECTION_HUE_DEG };
  const turn = pose.angles.map((angle) => angle + blend.twist);
  const starRadius = size * reachOf(STAR_SHAPE, bass, pulse);

  if (detail === 2 && place.depth <= HALO_DEPTH) fillHalo(pen, place, size, pose.energy);
  if (detail >= 1) {
    c.beginPath();
    circleAt(c, place, 0, 0, size * EYEPIECE);
    strokePath(pen, HUE.ring, 0.28 + 0.2 * treble, 0.8);
  }
  if (detail === 2) {
    c.beginPath();
    circleAt(c, place, 0, 0, size * PHI_RING);
    strokePath(pen, HUE.ring, 0.12 + 0.3 * highMid, 0.6);
    c.beginPath();
    traceSeed(c, place, turn[SEED], fold, size * reachOf(SEED_SHAPE, bass, 0));
    strokePath(pen, HUE.seed, 0.2 + 0.4 * bass, 0.7);
  }
  if (detail >= 1) {
    c.beginPath();
    tracePetals(c, place, turn[LOTUS_OUTER], fold, size * LOTUS_OUTER_SHAPE.from, size * reachOf(LOTUS_OUTER_SHAPE, highMid, pulse));
    fillPath(pen, HUE.lotusOuter, 0.1 + 0.08 * highMid);
    strokePath(pen, HUE.lotusOuter, 0.45 + 0.3 * highMid, 0.9);
  }
  if (detail === 2) {
    c.beginPath();
    tracePetals(c, place, turn[LOTUS_INNER], fold, size * LOTUS_INNER_SHAPE.from, size * reachOf(LOTUS_INNER_SHAPE, lowMid, pulse));
    fillPath(pen, HUE.lotusInner, 0.12 + 0.1 * lowMid);
    strokePath(pen, HUE.lotusInner, 0.5 + 0.3 * lowMid, 0.9);
    c.beginPath();
    tracePolygon(c, place, turn[POLYGON], fold, size * reachOf(POLYGON_SHAPE, treble, 0));
    strokePath(pen, HUE.polygon, 0.3 + 0.4 * treble, 0.8);
  }
  c.beginPath();
  traceRosette(c, place, pose.spectrum, turn[ROSETTE], fold, size, pulse, place.radius >= FINE_ROSETTE_RADIUS ? 1 : 2);
  fillPath(pen, HUE.rosette, 0.07);
  strokePath(pen, HUE.rosette, 0.85, 1.3);
  c.beginPath();
  traceStar(c, place, turn[STAR], fold, starRadius);
  strokePath(pen, HUE.star, 0.4 + 0.35 * bass + 0.25 * pulse, 1 + 0.5 * pulse);
  if (detail >= 1) {
    c.beginPath();
    traceJewels(c, place, turn[STAR], fold, starRadius, size * reachOf(JEWEL_SHAPE, treble, pulse));
    fillPath(pen, HUE.jewel, 0.55 + 0.45 * Math.max(treble, pulse), 14);
  }
  if (detail === 2) {
    c.beginPath();
    circleAt(c, place, 0, 0, size * reachOf(BINDU_SHAPE, Math.min(1, pose.energy * 2), pulse));
    fillPath(pen, HUE.jewel, 0.6 + 0.4 * pulse, 18);
  }
  return true;
}

function reachOf(shape, level, pulse) {
  return shape.base + shape.reach * level + shape.pulse * pulse;
}

// The glow of light through the eyepiece. It ends transparent at the rim, so it adds no edge of its own.
function fillHalo(pen, place, size, energy) {
  const { c, look } = pen;
  const strength = pen.alpha * look.tone.halo * (0.4 + 0.6 * Math.min(1, energy * 2));
  const glow = c.createRadialGradient(place.x, place.y, 0, place.x, place.y, size);
  glow.addColorStop(0, tint(look, pen.hue + HUE.halo, strength, 10));
  glow.addColorStop(0.6, tint(look, pen.hue + HUE.halo + 40, strength * 0.35));
  glow.addColorStop(1, tint(look, pen.hue, 0));
  c.fillStyle = glow;
  c.beginPath();
  circleAt(c, place, 0, 0, size);
  c.fill();
}

function strokePath(pen, hueOffset, strength, widthScale) {
  pen.c.strokeStyle = tint(pen.look, pen.hue + hueOffset, pen.alpha * strength);
  pen.c.lineWidth = pen.line * widthScale;
  pen.c.stroke();
}

function fillPath(pen, hueOffset, strength, lift = 0) {
  pen.c.fillStyle = tint(pen.look, pen.hue + hueOffset, pen.alpha * strength, lift);
  pen.c.fill();
}

// Lift raises lightness on the dark theme and deepens it on the light one, so gems stand out on both.
function tint(look, hue, alpha, lift = 0) {
  const { tone } = look;
  const wrapped = ((hue % 360) + 360) % 360;
  const lightness = tone.lightness + lift * tone.lift;
  const opacity = Math.min(1, Math.max(0, alpha * tone.alphaGain));
  return `hsla(${wrapped.toFixed(1)}, ${tone.saturation}%, ${lightness.toFixed(1)}%, ${opacity.toFixed(3)})`;
}

// A mirrored place negates x, which also reverses its turning, as a reflection does.
function xAt(place, angle, distance) {
  return place.x + place.mirror * Math.cos(angle) * distance;
}

function yAt(place, angle, distance) {
  return place.y + Math.sin(angle) * distance;
}

function moveAt(c, place, angle, distance) {
  c.moveTo(xAt(place, angle, distance), yAt(place, angle, distance));
}

function lineAt(c, place, angle, distance) {
  c.lineTo(xAt(place, angle, distance), yAt(place, angle, distance));
}

function circleAt(c, place, angle, distance, radius) {
  const x = xAt(place, angle, distance);
  const y = yAt(place, angle, distance);
  c.moveTo(x + radius, y);
  c.arc(x, y, radius, 0, TAU);
}

// The spectrum runs bass to treble across half a wedge and back across the mirrored half, in every wedge.
function traceRosette(c, place, spectrum, angle, fold, size, pulse, step) {
  const sector = TAU / fold;
  const half = sector / 2;
  const last = spectrum.length - 1;
  const reach = (k) => size * reachOf(ROSETTE_SHAPE, spectrum[k], pulse);
  for (let wedge = 0; wedge < fold; wedge++) {
    const start = angle + wedge * sector;
    for (let k = 0; k <= last; k += step) lineAt(c, place, start + (k / last) * half, reach(k));
    for (let k = last - step; k > 0; k -= step) lineAt(c, place, start + sector - (k / last) * half, reach(k));
  }
  c.closePath();
}

// Vesica petals from two quadratic curves. The control point lies inside the tip, so the tip bounds the petal.
function tracePetals(c, place, angle, fold, from, to) {
  const middle = (from + to) / 2;
  const width = Math.min(middle * Math.tan(Math.PI / fold) * PETAL_FILL, (to - from) * PETAL_MAX_WIDTH);
  const spread = Math.atan2(width, middle);
  const control = Math.hypot(middle, width);
  for (let i = 0; i < fold; i++) {
    const petal = angle + (i * TAU) / fold;
    moveAt(c, place, petal, from);
    c.quadraticCurveTo(xAt(place, petal + spread, control), yAt(place, petal + spread, control), xAt(place, petal, to), yAt(place, petal, to));
    c.quadraticCurveTo(xAt(place, petal - spread, control), yAt(place, petal - spread, control), xAt(place, petal, from), yAt(place, petal, from));
  }
}

// The seed of life: a ring of circles that each pass through the center, around one more at the center.
function traceSeed(c, place, angle, fold, radius) {
  circleAt(c, place, 0, 0, radius);
  for (let i = 0; i < fold; i++) circleAt(c, place, angle + (i * TAU) / fold, radius, radius);
}

// The star polygon {n/k} with the largest step under half, so 5 gives a pentagram and 6 a hexagram.
function traceStar(c, place, angle, fold, radius) {
  const step = Math.floor((fold - 1) / 2);
  for (let i = 0; i < fold; i++) {
    moveAt(c, place, angle + (i * TAU) / fold, radius);
    lineAt(c, place, angle + ((i + step) * TAU) / fold, radius);
  }
}

function tracePolygon(c, place, angle, fold, radius) {
  moveAt(c, place, angle, radius);
  for (let i = 1; i < fold; i++) lineAt(c, place, angle + (i * TAU) / fold, radius);
  c.closePath();
}

function traceJewels(c, place, angle, fold, distance, radius) {
  for (let i = 0; i < fold; i++) circleAt(c, place, angle + (i * TAU) / fold, distance, radius);
}

export default { label: 'Kaleidoscope mandala', draw };
