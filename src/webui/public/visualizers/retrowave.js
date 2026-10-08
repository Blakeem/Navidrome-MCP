import { average, detectBeat, resample, rgba } from '../visualizer-kit.js';

// The horizon's place, as a share of the padded height from the top.
const HORIZON_AT = 0.56;
// The scene dissolves over these shares of the padded area, so it floats on the card with no box.
const SIDE_FADE = 0.13;
const TOP_FADE = 0.07;
const BOTTOM_FADE = 0.17;
// Keeps the faded edge a pixel inside the pad, since the contract's bound is conservative.
const EDGE_MARGIN = 1;

// The sun's radius is the smaller of these shares of the sky height and the padded width.
const SUN_SKY_SHARE = 0.66;
const SUN_WIDTH_SHARE = 0.3;
// Once risen, the horizon crosses the disk at this share of its height.
const SUN_RISEN_AT = 0.6;
const SUN_BASS_SWELL = 0.06;
const SUN_KICK_SWELL = 0.04;
const SUN_LEVELS = 24;
// Stripes are cut between these shares of the disk height, so they sink with the sun at sunset.
// The zone ends below the risen horizon, so each stripe leaves out of sight.
const STRIPE_TOP = 0.28;
const STRIPE_BOTTOM = 0.66;
const STRIPE_SPACING_PX = 6;
const STRIPE_MIN = 4;
const STRIPE_MAX = 8;
// A gap fills at most this share of its slot, so the solid bands never vanish.
const STRIPE_MAX_FILL = 0.85;
const STRIPES_PER_SECOND = 0.3;
const STRIPES_PER_ENERGY = 0.8;
// A sliver thinner than this would only shimmer at the arc's antialiased edge.
const MIN_SLAB_PX = 0.25;
const HALO_INNER = 0.85;
const HALO_OUTER = 1.9;

const RIDGE_SPACING_PX = 16;
const RIDGE_MIN = 6;
const RIDGE_MAX = 24;
const FAR_DENSITY = 1.4;
const NEAR_SKY_SHARE = 0.42;
const FAR_SKY_SHARE = 0.56;
// A range keeps this share of its height while a band is quiet, so the skyline never goes flat.
const MOUNTAIN_FLOOR = 0.12;
// Even points are peaks and odd points notches, which gives the low-poly outrun ridge.
const PEAK_LOW = 0.7;
const PEAK_SPREAD = 0.3;
const NOTCH_LOW = 0.3;
const NOTCH_SPREAD = 0.3;
// The ranges dip within this many sun radii of the center, so the disk stays in view.
const VALLEY_REACH = 1.15;
const VALLEY_NEAR = 0.3;
const VALLEY_FAR = 0.55;
const NEAR_SEED = 11;
const FAR_SEED = 71;
const CONTOURS = [0.62, 0.3];

// The camera sits this many ground heights behind the near edge. Closer foreshortens the floor more.
const CAMERA_DEPTH = 1.4;
const ROW_DEPTH = 0.5;
const COLUMN_SHARE = 0.6;
const COLUMN_MAX_SHARE = 1 / 7;
// Rows stop where they would crowd closer than this, and the horizon haze covers the rest.
const MIN_ROW_GAP_PX = 1;
const MIN_ROWS = 3;
const MAX_ROWS = 24;
const MAX_COLUMNS_PER_SIDE = 60;
// Columns run on past the last row toward the vanishing point, where they crowd into a glow.
const COLUMN_REACH = 0.4;
const ROWS_PER_SECOND = 0.8;
const ROWS_PER_BASS = 2.4;
const ROWS_PER_KICK = 3;
const KICK_DECAY_PER_SECOND = 6;

const PULSE_START_ROWS = 8;
const PULSE_FADE_ROWS = 2;
const PULSE_ROWS_PER_SECOND = 14;
const MAX_PULSES = 4;

const STAR_AREA_PX = 700;
const STAR_MIN = 10;
const STAR_MAX = 70;
const STAR_SMALL = 1.1;
const STAR_BIG = 1.7;
const STAR_ALPHAS = [0.25, 0.55, 0.95];
const TREBLE_FROM = 11;

const METEOR_LIFE_S = 0.7;
const METEOR_GAP_S = 5;
const METEOR_SLOPE = 0.3;
const METEOR_TRAVEL = 0.35;
// Caps the fall in sky heights, so a meteor burns out above the mountains.
const METEOR_SKY_TRAVEL = 1.5;
const METEOR_TAIL = 0.45;

// Shares of the ground height below the horizon where the sun's reflection lies.
const REFLECTION_AT = [0.05, 0.12, 0.21, 0.32, 0.46];
const REFLECTION_FADE = 0.55;
const REFLECTION_BAND = 6;
const SHIMMER_RATE = 2.6;
const SHIMMER = 0.06;
const MIN_DASH_PX = 0.8;

const HAZE_WIDTH = 0.5;
const HAZE_HEIGHT = 0.7;

const GRID_WIDTH = 1.1;
const RIDGE_WIDTH = 1.4;
const FAR_RIDGE_WIDTH = 1;
const CONTOUR_WIDTH = 0.8;
const HORIZON_WIDTH = 1.6;
const PULSE_WIDTH = 1.5;
const METEOR_WIDTH = 1.3;

// Values at rest sit under 0.002 a band, so this floor keeps silence empty.
const SILENCE_ENERGY = 0.004;
const PRESENCE_GAIN = 4;
const PRESENCE_RISE_PER_SECOND = 3;
// A full sunset takes under two seconds, inside the three the host allows.
const PRESENCE_FALL_PER_SECOND = 0.6;
const MIN_PRESENCE = 0.01;
// The scene stays opaque while the sun sets and fades only in the last part of the fall.
const SCENE_ALPHA_GAIN = 2.5;

// Neon glows additively on the dark card. On white it would wash out, so the light theme paints deeper ink over.
const INK = {
  dark: {
    blend: 'lighter',
    glowWidth: 3.5,
    glowAlpha: 0.28,
    sunTop: { r: 255, g: 232, b: 110 },
    sunMid: { r: 255, g: 122, b: 72 },
    sunLow: { r: 255, g: 42, b: 156 },
    halo: { r: 255, g: 46, b: 170 },
    haloAlpha: 0.55,
    haze: { r: 255, g: 40, b: 190 },
    hazeAlpha: 0.5,
    reflectionAlpha: 0.7,
    star: { r: 255, g: 226, b: 255 },
    starAlpha: 1,
    farFill: { r: 58, g: 20, b: 104 },
    farFillAlpha: 0.6,
    farRidge: { r: 186, g: 86, b: 255 },
    farRidgeAlpha: 0.8,
    nearTop: { r: 44, g: 14, b: 86 },
    nearBase: { r: 12, g: 5, b: 28 },
    nearFillAlpha: 0.95,
    ridge: { r: 40, g: 236, b: 255 },
    contourAlpha: 0.3,
    gridFar: { r: 150, g: 64, b: 255 },
    gridNear: { r: 255, g: 52, b: 214 },
    gridAlpha: 0.95,
    pulse: { r: 90, g: 242, b: 255 },
    horizon: { r: 255, g: 96, b: 214 },
  },
  light: {
    blend: 'source-over',
    glowWidth: 3,
    glowAlpha: 0.14,
    sunTop: { r: 255, g: 160, b: 0 },
    sunMid: { r: 244, g: 78, b: 40 },
    sunLow: { r: 210, g: 16, b: 124 },
    halo: { r: 255, g: 96, b: 160 },
    haloAlpha: 0.24,
    haze: { r: 236, g: 60, b: 160 },
    hazeAlpha: 0.18,
    reflectionAlpha: 0.75,
    star: { r: 112, g: 48, b: 196 },
    starAlpha: 0.6,
    farFill: { r: 152, g: 96, b: 220 },
    farFillAlpha: 0.4,
    farRidge: { r: 126, g: 44, b: 200 },
    farRidgeAlpha: 0.85,
    nearTop: { r: 76, g: 30, b: 150 },
    nearBase: { r: 30, g: 10, b: 72 },
    nearFillAlpha: 0.92,
    ridge: { r: 0, g: 158, b: 206 },
    contourAlpha: 0.4,
    gridFar: { r: 120, g: 60, b: 210 },
    gridNear: { r: 204, g: 18, b: 150 },
    gridAlpha: 0.9,
    pulse: { r: 0, g: 150, b: 214 },
    horizon: { r: 214, g: 18, b: 140 },
  },
};

/**
 * An outrun sunset. A striped sun cut by the spectrum sets behind a skyline of mountains raised by the
 * bands, while a neon grid races toward the viewer on the bass and each beat sends a pulse down the floor.
 */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const presence = updatePresence(state, frame);
  // Silence sets the sun and fades the scene, then draws nothing so the animation can sleep.
  if (presence < MIN_PRESENCE) return false;

  const motion = advance(state, frame, beat, presence);
  const scene = layout(frame, motion);
  const ink = INK[frame.theme] ?? INK.dark;
  const levels = resample(frame.values, SUN_LEVELS);
  // ctx holds only this mode, so the edge mask and the sunset fade apply to it in place, with no layer to copy.
  drawSky(ctx, scene, motion, ink, frame);
  drawSun(ctx, scene, motion, ink, levels, frame.bass);
  drawMountains(ctx, scene, frame, ink);
  drawGround(ctx, scene, motion, ink, levels, frame.bass);
  fadeEdges(ctx, scene, frame, Math.min(1, presence * SCENE_ALPHA_GAIN));
  // The sun keeps setting after the music stops, so the host keeps drawing until it is gone.
  return true;
}

// Rises fast with the music and falls at a fixed rate, so the sunset always ends on time.
function updatePresence(state, frame) {
  const target = Math.min(1, Math.max(0, (frame.energy - SILENCE_ENERGY) * PRESENCE_GAIN));
  const current = state.presence ?? 0;
  state.presence = target > current
    ? Math.min(target, current + PRESENCE_RISE_PER_SECOND * frame.dtSeconds)
    : Math.max(target, current - PRESENCE_FALL_PER_SECOND * frame.dtSeconds);
  return state.presence;
}

function advance(state, frame, beat, presence) {
  const dt = frame.reducedMotion ? 0 : frame.dtSeconds;
  const surge = beat && !frame.reducedMotion;
  state.kick = (beat ? 1 : (state.kick ?? 0)) * Math.exp(-KICK_DECAY_PER_SECOND * frame.dtSeconds);
  state.clock = (state.clock ?? 0) + dt;
  // The grid coasts to a stop as the music fades, the way a car rolls out after the gas.
  const rowsPerSecond = (ROWS_PER_SECOND + ROWS_PER_BASS * frame.bass + ROWS_PER_KICK * state.kick) * presence;
  state.gridPhase = ((state.gridPhase ?? 0) + dt * rowsPerSecond) % 1;
  state.stripeDrift = ((state.stripeDrift ?? 0) + dt * (STRIPES_PER_SECOND + STRIPES_PER_ENERGY * frame.energy)) % 1;
  state.pulses = frame.reducedMotion ? [] : advancePulses(state.pulses ?? [], surge, dt);
  state.meteor = frame.reducedMotion ? null : advanceMeteor(state, surge, dt);
  return {
    kick: state.kick,
    clock: state.clock,
    gridPhase: state.gridPhase,
    stripeDrift: state.stripeDrift,
    pulses: state.pulses,
    meteor: state.meteor,
    rise: smoothstep(presence),
  };
}

// Pulse depths count grid rows from the viewer.
function advancePulses(pulses, spawn, dt) {
  const moved = pulses.map((depth) => depth - PULSE_ROWS_PER_SECOND * dt).filter((depth) => depth > 0);
  if (spawn && moved.length < MAX_PULSES) moved.push(PULSE_START_ROWS);
  return moved;
}

// A meteor's start is stored as shares of the sky, so it survives a resize mid-flight.
function advanceMeteor(state, spawn, dt) {
  const current = state.meteor ?? null;
  state.meteorWait = Math.max(0, (state.meteorWait ?? 0) - dt);
  if (current !== null && current.age + dt < METEOR_LIFE_S) return { ...current, age: current.age + dt };
  if (!spawn || state.meteorWait > 0) return null;
  state.meteorCount = (state.meteorCount ?? 0) + 1;
  state.meteorWait = METEOR_GAP_S;
  const across = 0.15 + 0.7 * hash(state.meteorCount * 7.3);
  return { age: 0, across, down: 0.06 + 0.3 * hash(state.meteorCount * 3.1), direction: across < 0.5 ? 1 : -1 };
}

function layout(frame, motion) {
  const { width, height, pad } = frame;
  const left = pad + EDGE_MARGIN;
  const right = width - pad - EDGE_MARGIN;
  const top = pad + EDGE_MARGIN;
  const bottom = height - pad - EDGE_MARGIN;
  const innerWidth = right - left;
  const horizon = top + (bottom - top) * HORIZON_AT;
  const sky = horizon - top;
  const ground = bottom - horizon;
  const size = Math.min(sky * SUN_SKY_SHARE, innerWidth * SUN_WIDTH_SHARE);
  const radius = size * (1 + SUN_BASS_SWELL * frame.bass + SUN_KICK_SWELL * motion.kick);
  // At rise 0 the disk's top touches the horizon, and at rise 1 the horizon crosses it at SUN_RISEN_AT.
  const sunY = horizon + radius * (1 - 2 * SUN_RISEN_AT * motion.rise);
  const camera = ground * CAMERA_DEPTH;
  const rowDepth = ground * ROW_DEPTH;
  return {
    left,
    right,
    top,
    bottom,
    innerWidth,
    horizon,
    sky,
    ground,
    centerX: width / 2,
    sun: { x: width / 2, y: sunY, radius, size },
    grid: {
      camera,
      rowDepth,
      rows: rowCount(ground, camera, rowDepth),
      column: Math.min(ground * COLUMN_SHARE, innerWidth * COLUMN_MAX_SHARE),
    },
  };
}

// The gap between rows shrinks with the square of their distance, so rows stop where it reaches the minimum.
function rowCount(ground, camera, rowDepth) {
  const reach = Math.sqrt((ground * camera * rowDepth) / MIN_ROW_GAP_PX) - camera;
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(reach / rowDepth)));
}

function groundAt(scene, depth) {
  return scene.horizon + (scene.ground * scene.grid.camera) / (scene.grid.camera + depth);
}

function drawSky(c, scene, motion, ink, frame) {
  const treble = average(frame.values, TREBLE_FROM, frame.values.length);
  c.save();
  c.globalCompositeOperation = ink.blend;
  drawStars(c, scene, motion, ink, treble);
  if (motion.meteor !== null) drawMeteor(c, scene, motion.meteor, ink);
  c.restore();
}

// Stars sort into a few brightness steps, so the whole field costs one fill per step.
function drawStars(c, scene, motion, ink, treble) {
  const count = Math.round(Math.min(STAR_MAX, Math.max(STAR_MIN, (scene.innerWidth * scene.sky) / STAR_AREA_PX)));
  for (const [step, alpha] of STAR_ALPHAS.entries()) {
    c.fillStyle = rgba(ink.star, alpha * ink.starAlpha);
    c.beginPath();
    for (let i = 0; i < count; i++) {
      if (starStep(i, motion.clock, treble) !== step) continue;
      const size = hash(i * 4 + 2) > 0.8 ? STAR_BIG : STAR_SMALL;
      const x = scene.left + hash(i * 4) * scene.innerWidth;
      // More stars sit high in the sky, where the sunset glow is faint.
      const y = scene.top + hash(i * 4 + 1) ** 1.4 * scene.sky * 0.9;
      c.rect(x - size / 2, y - size / 2, size, size);
    }
    c.fill();
  }
}

function starStep(i, clock, treble) {
  const rate = 1.5 + 2.5 * hash(i * 4 + 3);
  const twinkle = 0.5 + 0.5 * Math.sin(clock * rate + hash(i * 4 + 3) * 40);
  const brightness = (0.3 + 0.7 * treble) * twinkle;
  return Math.min(STAR_ALPHAS.length - 1, Math.floor(brightness * STAR_ALPHAS.length));
}

function drawMeteor(c, scene, meteor, ink) {
  const progress = meteor.age / METEOR_LIFE_S;
  const travel = Math.min(scene.innerWidth * METEOR_TRAVEL, scene.sky * METEOR_SKY_TRAVEL);
  const headX = scene.left + meteor.across * scene.innerWidth + meteor.direction * travel * progress;
  const headY = scene.top + meteor.down * scene.sky + travel * METEOR_SLOPE * progress;
  const tail = travel * METEOR_TAIL;
  const tailX = headX - meteor.direction * tail;
  const tailY = headY - tail * METEOR_SLOPE;
  const streak = c.createLinearGradient(tailX, tailY, headX, headY);
  streak.addColorStop(0, rgba(ink.star, 0));
  streak.addColorStop(1, rgba(ink.star, Math.sin(Math.PI * progress) * ink.starAlpha));
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(tailX, tailY);
  c.lineTo(headX, headY);
  strokeNeon(c, ink, streak, METEOR_WIDTH, 1);
}

// The disk is built from horizontal slabs between the stripe gaps, so the cut shows the sky behind it.
function drawSun(c, scene, motion, ink, levels, bass) {
  const { sun, horizon } = scene;
  const diskTop = sun.y - sun.radius;
  if (horizon - diskTop < MIN_SLAB_PX) return;
  drawHalo(c, scene, motion, ink, bass);
  c.beginPath();
  let from = diskTop;
  for (const [gapTop, gapBottom] of stripeGaps(sun, motion.stripeDrift, levels)) {
    if (gapTop >= horizon) break;
    addSlab(c, sun, from, gapTop);
    from = gapBottom;
  }
  if (from < horizon) addSlab(c, sun, from, horizon);
  // The colors run to the disk's risen horizon point, so they ride down with it at sunset.
  const body = c.createLinearGradient(0, diskTop, 0, diskTop + 2 * sun.radius * SUN_RISEN_AT);
  body.addColorStop(0, rgba(ink.sunTop, 1));
  body.addColorStop(0.5, rgba(ink.sunMid, 1));
  body.addColorStop(1, rgba(ink.sunLow, 1));
  c.fillStyle = body;
  c.fill();
}

function drawHalo(c, scene, motion, ink, bass) {
  const { sun, horizon } = scene;
  const outer = sun.radius * HALO_OUTER;
  const alpha = ink.haloAlpha * motion.rise * (0.7 + 0.3 * bass + 0.5 * motion.kick);
  const glow = c.createRadialGradient(sun.x, sun.y, sun.radius * HALO_INNER, sun.x, sun.y, outer);
  glow.addColorStop(0, rgba(ink.halo, alpha));
  glow.addColorStop(0.35, rgba(ink.halo, alpha * 0.4));
  glow.addColorStop(1, rgba(ink.halo, 0));
  c.save();
  c.globalCompositeOperation = ink.blend;
  c.fillStyle = glow;
  c.fillRect(sun.x - outer, sun.y - outer, outer * 2, horizon - (sun.y - outer));
  c.restore();
}

// Gaps open from nothing at the top of the zone and widen toward the horizon, the classic outrun cut.
// Each gap's width follows the band at its height, bass at the bottom.
function stripeGaps(sun, drift, levels) {
  const zoneTop = sun.y - sun.radius + 2 * sun.radius * STRIPE_TOP;
  const zoneHeight = 2 * sun.radius * (STRIPE_BOTTOM - STRIPE_TOP);
  // The count follows the unswelled size, so a bass swell never adds or drops a stripe.
  const count = Math.round(Math.min(STRIPE_MAX, Math.max(STRIPE_MIN, (2 * sun.size * (STRIPE_BOTTOM - STRIPE_TOP)) / STRIPE_SPACING_PX)));
  const slot = zoneHeight / count;
  const gaps = [];
  for (let k = 0; k < count; k++) {
    const along = (k + drift) / count;
    const level = levels[Math.round((1 - along) * (levels.length - 1))];
    const thickness = slot * Math.min(STRIPE_MAX_FILL, 0.8 * along ** 1.2 * (0.4 + 0.9 * level));
    const center = zoneTop + along * zoneHeight;
    gaps.push([center - thickness / 2, center + thickness / 2]);
  }
  return gaps;
}

// One slab of the disk between two heights, traced down its right edge and back up its left.
function addSlab(c, sun, from, to) {
  if (to - from < MIN_SLAB_PX) return;
  const start = Math.asin(Math.min(1, Math.max(-1, (from - sun.y) / sun.radius)));
  const end = Math.asin(Math.min(1, Math.max(-1, (to - sun.y) / sun.radius)));
  c.moveTo(sun.x + sun.radius * Math.cos(start), sun.y + sun.radius * Math.sin(start));
  c.arc(sun.x, sun.y, sun.radius, start, end);
  c.arc(sun.x, sun.y, sun.radius, Math.PI - end, Math.PI - start);
  c.closePath();
}

// The near range takes the live levels and the far range the held peaks, so the backdrop moves slower.
function drawMountains(c, scene, frame, ink) {
  const nearCount = clampRound(scene.innerWidth / 2 / RIDGE_SPACING_PX, RIDGE_MIN, RIDGE_MAX);
  const farCount = clampRound(nearCount * FAR_DENSITY, RIDGE_MIN, RIDGE_MAX * FAR_DENSITY);
  const nearHeight = Math.min(scene.sky * NEAR_SKY_SHARE, scene.sun.size);
  const farHeight = Math.min(scene.sky * FAR_SKY_SHARE, scene.sun.size * 1.3);
  const far = ridge(scene, resample(frame.peaks, farCount + 1), farHeight, VALLEY_FAR, FAR_SEED);
  const near = ridge(scene, resample(frame.values, nearCount + 1), nearHeight, VALLEY_NEAR, NEAR_SEED);
  const body = c.createLinearGradient(0, scene.horizon - nearHeight, 0, scene.horizon);
  body.addColorStop(0, rgba(ink.nearTop, ink.nearFillAlpha));
  body.addColorStop(1, rgba(ink.nearBase, ink.nearFillAlpha));

  c.save();
  // Round joins, since a miter at a sharp peak would spike far above the ridge.
  c.lineJoin = 'round';
  fillRange(c, scene, far, rgba(ink.farFill, ink.farFillAlpha));
  c.globalCompositeOperation = ink.blend;
  c.beginPath();
  traceRidge(c, scene, far, 1);
  c.strokeStyle = rgba(ink.farRidge, ink.farRidgeAlpha);
  c.lineWidth = FAR_RIDGE_WIDTH;
  c.stroke();
  c.globalCompositeOperation = 'source-over';
  fillRange(c, scene, near, body);
  c.globalCompositeOperation = ink.blend;
  c.beginPath();
  for (const share of CONTOURS) traceRidge(c, scene, near, share);
  c.strokeStyle = rgba(ink.ridge, ink.contourAlpha);
  c.lineWidth = CONTOUR_WIDTH;
  c.stroke();
  c.beginPath();
  traceRidge(c, scene, near, 1);
  strokeNeon(c, ink, rgba(ink.ridge, 1), RIDGE_WIDTH, 1);
  c.restore();
}

// Bass sits at both outer edges and treble meets in the center, so the loud low end raises the flanking peaks.
function ridge(scene, levels, maxHeight, valleyFloor, seed) {
  const count = levels.length - 1;
  const step = scene.innerWidth / (2 * count);
  const valleyReach = scene.sun.size * VALLEY_REACH;
  const points = [];
  for (let j = 0; j <= 2 * count; j++) {
    const x = scene.left + j * step;
    const level = levels[count - Math.abs(j - count)];
    const jag = j % 2 === 0 ? PEAK_LOW + PEAK_SPREAD * hash(j + seed) : NOTCH_LOW + NOTCH_SPREAD * hash(j + seed);
    const valley = valleyFloor + (1 - valleyFloor) * smoothstep(Math.abs(x - scene.centerX) / valleyReach);
    points.push({ x, height: maxHeight * (MOUNTAIN_FLOOR + (1 - MOUNTAIN_FLOOR) * level) * jag * valley });
  }
  return points;
}

function traceRidge(c, scene, points, share) {
  c.moveTo(points[0].x, scene.horizon - points[0].height * share);
  for (let i = 1; i < points.length; i++) c.lineTo(points[i].x, scene.horizon - points[i].height * share);
}

function fillRange(c, scene, points, style) {
  c.beginPath();
  c.moveTo(scene.left, scene.horizon);
  for (const point of points) c.lineTo(point.x, scene.horizon - point.height);
  c.lineTo(scene.right, scene.horizon);
  c.closePath();
  c.fillStyle = style;
  c.fill();
}

function drawGround(c, scene, motion, ink, levels, bass) {
  c.save();
  c.globalCompositeOperation = ink.blend;
  drawHaze(c, scene, motion, ink, bass);
  drawReflection(c, scene, motion, ink, levels);
  drawGrid(c, scene, motion, ink);
  drawPulses(c, scene, motion, ink);
  drawHorizon(c, scene, motion, ink);
  c.restore();
}

// The haze straddles the horizon, so it backlights the mountain bases and warms the far floor.
function drawHaze(c, scene, motion, ink, bass) {
  const alpha = ink.hazeAlpha * (0.6 + 0.4 * bass + 0.3 * motion.kick);
  c.save();
  c.translate(scene.centerX, scene.horizon);
  c.scale(scene.innerWidth * HAZE_WIDTH, Math.min(scene.sky, scene.ground) * HAZE_HEIGHT);
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, rgba(ink.haze, alpha));
  glow.addColorStop(0.5, rgba(ink.haze, alpha * 0.35));
  glow.addColorStop(1, rgba(ink.haze, 0));
  c.fillStyle = glow;
  c.fillRect(-1, -1, 2, 2);
  c.restore();
}

// Dashes on the glossy floor mirror the sun, each as wide as a middle band is loud.
function drawReflection(c, scene, motion, ink, levels) {
  const { sun, horizon, ground, centerX } = scene;
  c.beginPath();
  for (const [k, share] of REFLECTION_AT.entries()) {
    const level = levels[REFLECTION_BAND + k * 2];
    const halfWidth = sun.size * (0.95 - 0.13 * k) * (0.5 + 0.6 * level);
    const thickness = Math.max(MIN_DASH_PX, ground * (0.012 + 0.008 * k));
    const shimmer = Math.sin(motion.clock * SHIMMER_RATE + k * 1.7) * sun.size * SHIMMER;
    c.rect(centerX - halfWidth + shimmer, horizon + ground * share, halfWidth * 2, thickness);
  }
  const fade = c.createLinearGradient(0, horizon, 0, horizon + ground * REFLECTION_FADE);
  fade.addColorStop(0, rgba(ink.sunMid, ink.reflectionAlpha * motion.rise));
  fade.addColorStop(1, rgba(ink.sunLow, 0));
  c.fillStyle = fade;
  c.fill();
}

// Rows ride toward the viewer in perspective and columns fan out from the vanishing point.
function drawGrid(c, scene, motion, ink) {
  const { grid, horizon, ground, left, right, bottom, centerX } = scene;
  const farScale = grid.camera / (grid.camera + grid.rows * grid.rowDepth);
  const columnScale = farScale * COLUMN_REACH;
  const columnTop = horizon + ground * columnScale;
  // Enough columns that the outermost still reaches the side where the columns start.
  const columns = Math.min(MAX_COLUMNS_PER_SIDE, Math.ceil(scene.innerWidth / 2 / (grid.column * columnScale)));
  const shade = c.createLinearGradient(0, horizon, 0, bottom);
  shade.addColorStop(0, rgba(ink.gridFar, 0.1));
  shade.addColorStop(Math.min(0.9, farScale + 0.15), rgba(ink.gridFar, 0.55));
  shade.addColorStop(1, rgba(ink.gridNear, 1));
  const alpha = ink.gridAlpha * (0.8 + 0.2 * motion.kick);

  c.lineCap = 'butt';
  c.beginPath();
  for (let k = 0; k < grid.rows - 1; k++) {
    const y = groundAt(scene, (k + 1 - motion.gridPhase) * grid.rowDepth);
    c.moveTo(left, y);
    c.lineTo(right, y);
  }
  for (let i = -columns; i <= columns; i++) {
    c.moveTo(centerX + i * grid.column * columnScale, columnTop);
    c.lineTo(centerX + i * grid.column, bottom);
  }
  strokeNeon(c, ink, shade, GRID_WIDTH, alpha);
  // The farthest row fades in as it arrives, so rows never pop out of the haze.
  const newest = groundAt(scene, (grid.rows - motion.gridPhase) * grid.rowDepth);
  c.beginPath();
  c.moveTo(left, newest);
  c.lineTo(right, newest);
  c.strokeStyle = shade;
  c.lineWidth = GRID_WIDTH;
  c.globalAlpha = clampUnit(alpha * motion.gridPhase);
  c.stroke();
  c.globalAlpha = 1;
}

// Each beat launches a bright row from the distance that overtakes the grid on its way to the viewer.
function drawPulses(c, scene, motion, ink) {
  const start = Math.min(PULSE_START_ROWS, scene.grid.rows);
  for (const depth of motion.pulses) {
    if (depth > start) continue;
    const y = groundAt(scene, depth * scene.grid.rowDepth);
    c.beginPath();
    c.moveTo(scene.left, y);
    c.lineTo(scene.right, y);
    strokeNeon(c, ink, rgba(ink.pulse, 1), PULSE_WIDTH, (start - depth) / PULSE_FADE_ROWS);
  }
}

function drawHorizon(c, scene, motion, ink) {
  c.beginPath();
  c.moveTo(scene.left, scene.horizon);
  c.lineTo(scene.right, scene.horizon);
  strokeNeon(c, ink, rgba(ink.horizon, 1), HORIZON_WIDTH, 0.8 + 0.2 * motion.kick);
}

// A wide faint pass under a thin bright one reads as neon glow without the cost of shadowBlur.
function strokeNeon(c, ink, style, width, alpha) {
  c.strokeStyle = style;
  c.lineWidth = width * ink.glowWidth;
  c.globalAlpha = clampUnit(alpha * ink.glowAlpha);
  c.stroke();
  c.lineWidth = width;
  c.globalAlpha = clampUnit(alpha);
  c.stroke();
  c.globalAlpha = 1;
}

// Two ramps cut the scene to the padded area, so every element dissolves into the card instead of meeting an edge.
// The side ramp also carries the sunset fade, so the scene fades as a whole with no extra pass.
function fadeEdges(c, scene, frame, alpha) {
  c.save();
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = edgeRamp(c.createLinearGradient(scene.left, 0, scene.right, 0), SIDE_FADE, SIDE_FADE, alpha);
  c.fillRect(0, 0, frame.width, frame.height);
  c.fillStyle = edgeRamp(c.createLinearGradient(0, scene.top, 0, scene.bottom), TOP_FADE, BOTTOM_FADE, 1);
  c.fillRect(0, 0, frame.width, frame.height);
  c.restore();
}

// A midway stop eases each ramp in, so the fade shows no line where it starts.
function edgeRamp(gradient, start, end, alpha) {
  const ink = (share) => `rgba(0, 0, 0, ${(share * alpha).toFixed(3)})`;
  gradient.addColorStop(0, ink(0));
  gradient.addColorStop(start / 2, ink(0.3));
  gradient.addColorStop(start, ink(1));
  gradient.addColorStop(1 - end, ink(1));
  gradient.addColorStop(1 - end / 2, ink(0.3));
  gradient.addColorStop(1, ink(0));
  return gradient;
}

// A fixed pseudo-random value from 0 to 1, so stars and peaks keep their places from frame to frame.
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothstep(x) {
  const t = clampUnit(x);
  return t * t * (3 - 2 * t);
}

function clampUnit(x) {
  return Math.min(1, Math.max(0, x));
}

function clampRound(value, min, max) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

export default { label: 'Outrun sunset', draw };
