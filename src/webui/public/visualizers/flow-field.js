import { average, detectBeat, hslOf } from '../visualizer-kit.js';

const BANDS = 16;

// Particles per square CSS pixel of the field ellipse, capped so the wide desktop costs no more than the default.
const PARTICLE_DENSITY = 0.014;
const MIN_PARTICLES = 140;
const MAX_PARTICLES = 700;
// A line reaches half its width past its path, so the field keeps the widest glow clear of the pad.
const MAX_GLOW_WIDTH = 4.4;
const EDGE_MARGIN = MAX_GLOW_WIDTH / 2 + 1;
const MIN_FIELD_PX = 6;
// Particles are born inside this fraction of the field ellipse, since the mask hides its rim.
const SPAWN_REACH = 0.94;
const LIFE_MIN_S = 1.5;
const LIFE_RANGE_S = 3;
// A long frame gap moves in sub-steps, so a slow device still draws curves rather than chords.
const STEP_S = 1 / 40;
const MAX_SUBSTEPS = 3;

// Speeds are in field units per second. A field unit is the shorter radius of the ellipse, so the swirls
// fit the phone strip and the desktop alike.
const SPEED_BASE = 0.25;
const SPEED_BASS = 0.55;
const SPEED_SURGE = 1.2;
// Each band's particles ride the field faster or slower by that band's level, so loud bands race ahead.
const BAND_SPEED_MIN = 0.55;
const BAND_SPEED_RANGE = 0.9;
const MAX_FLOW = 2.6;
// Noise cycles per field unit. Dark, bass-heavy music opens broad currents and bright music folds them into eddies.
const SCALE_BROAD = 0.55;
const SCALE_FINE = 1.45;
const SCALE_FOLLOW_PER_SECOND = 0.7;
// A finer octave that the treble stirs in, offset so it does not echo the first.
const DETAIL_RATIO = 2.3;
const DETAIL_OFFSET = 37.1;
const DETAIL_BASE = 0.12;
const DETAIL_TREBLE = 0.75;
// Noise depth travelled per second, which morphs the field in place rather than sliding it.
const EVOLVE_BASE = 0.05;
const EVOLVE_ENERGY = 0.18;
const EVOLVE_SURGE = 0.6;
const SURGE_DECAY_PER_SECOND = 3.5;
// The spectral centroid of normalized tracks sits in this range, which maps to the full scale and tint swing.
const CENTROID_LOW = 0.3;
const CENTROID_HIGH = 0.65;

// Each beat opens a whirlpool, the curl of a Gaussian bump, that winds the currents for about a second.
const MAX_VORTICES = 3;
const VORTEX_RADIUS = 0.6;
const VORTEX_STRENGTH = 1.2;
const VORTEX_DECAY_PER_SECOND = 1.5;
const VORTEX_REACH = 0.6;
const VORTEX_MIN = 0.03;

// Natural-log fade rates per second, slow for long silk while music plays and fast once it stops.
const FADE_PLAYING = 1.5;
const FADE_RELEASE = 3.6;
// An 8-bit layer strands any pixel whose fade rounds to no change, so the fade runs in steps this far apart.
const FADE_INTERVAL_S = 0.03;
// The residue that still strands retires with its layer, which is shown fading and then wiped.
const GENERATION_S = 4;
const END_LEVEL = 0.004;
// Energy that marks silence and full presence. Levels at rest sit under 0.002.
const REST_ENERGY = 0.01;
const FULL_ENERGY = 0.18;

// Bass sits warm at the top of the field and treble cool at the bottom, fanned around the theme accent.
const HUE_BASS_OFFSET = 100;
const HUE_SPAN = 165;
const HUE_DRIFT_DEG_PER_SECOND = 4;
// Bright passages cool the whole field and dark ones warm it.
const HUE_CENTROID_SWING = 70;
const TINT_FOLLOW_PER_SECOND = 1.2;
const MIN_ALPHA = 0.003;
// Alpha at each fraction of the field ellipse, so the silk floats on the card with no visible edge.
const MASK_STOPS = [[0, 1], [0.5, 1], [0.72, 0.75], [0.88, 0.3], [1, 0]];

// Under reduced motion the field freezes into streamlines that only brighten with their bands.
const STILL_DENSITY = 0.005;
const STILL_MIN = 40;
const STILL_MAX = 220;
// A still line is drawn once rather than built up frame over frame, so it takes more alpha.
const STILL_GAIN = 1.6;
const STILL_STEPS = 22;
const STILL_STEP = 0.055;

// The twelve cube-edge gradients of improved Perlin noise, padded to sixteen so a hash picks one with a mask.
const GRADIENT_X = Float32Array.of(1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0);
const GRADIENT_Y = Float32Array.of(1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1);
const GRADIENT_Z = Float32Array.of(0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 1, 0, -1);
const PERMUTATION = shuffledLattice(0x5eed);
// Scratch outputs reused by every noise and flow sample, so a frame allocates nothing per particle.
const SLOPE = new Float32Array(2);
const FLOW = new Float32Array(2);
const NO_WHIRLS = [];

/** Silk currents: particles ride a curl-noise flow field that the music drives, swirls, tints and stirs. */
function draw(ctx, frame) {
  const { state } = frame;
  const presence = presenceOf(frame.energy);
  const field = fieldShape(frame);
  if (field.unit < MIN_FIELD_PX) return false;
  if (frame.reducedMotion) return drawStill(ctx, frame, field, presence);

  const motion = advanceField(state, frame);
  const fadeRate = FADE_RELEASE + (FADE_PLAYING - FADE_RELEASE) * presence;
  state.trailLevel = Math.max((state.trailLevel ?? 0) * Math.exp(-fadeRate * frame.dtSeconds), presence);
  if (state.trailLevel < END_LEVEL) {
    wipeTrails(state, frame);
    return false;
  }
  const trails = trailLayers(state, frame);
  ageTrails(trails, frame, fadeRate);
  if (presence > 0) {
    const swarm = particleSwarm(state, frame, field);
    moveSwarm(swarm, frame, field, motion);
    strokeLines(trails.layers[trails.active].ctx, swarm.trace, bandLooks(frame, motion.hue, motion.surge, presence), frame.theme);
  }
  showTrails(ctx, trails, frame);
  maskField(ctx, frame, field);
  // The silk outlasts the music, so the host keeps drawing until it fades.
  return true;
}

function presenceOf(energy) {
  return Math.min(1, Math.max(0, (energy - REST_ENERGY) / (FULL_ENERGY - REST_ENERGY)));
}

// The field is the ellipse inset from the pad by the widest glow, measured in units of its shorter radius.
function fieldShape(frame) {
  const inset = frame.pad + EDGE_MARGIN;
  const radiusX = frame.width / 2 - inset;
  const radiusY = frame.height / 2 - inset;
  return { centerX: frame.width / 2, centerY: frame.height / 2, radiusX, radiusY, unit: Math.min(radiusX, radiusY) };
}

function advanceField(state, frame) {
  const dt = frame.dtSeconds;
  const beat = detectBeat(state, frame);
  const brightness = brightnessOf(frame.values);
  const treble = average(frame.values, BANDS - 5, BANDS);

  state.surge = (beat ? 1 : (state.surge ?? 0)) * Math.exp(-SURGE_DECAY_PER_SECOND * dt);
  state.scale = follow(state.scale ?? SCALE_BROAD, SCALE_BROAD + (SCALE_FINE - SCALE_BROAD) * brightness, SCALE_FOLLOW_PER_SECOND, dt);
  state.tint = follow(state.tint ?? brightness, brightness, TINT_FOLLOW_PER_SECOND, dt);
  state.fieldTime = (state.fieldTime ?? 0) + dt * (EVOLVE_BASE + EVOLVE_ENERGY * frame.energy + EVOLVE_SURGE * state.surge);
  state.drift = ((state.drift ?? 0) + dt * HUE_DRIFT_DEG_PER_SECOND) % 360;
  state.vortices = stepVortices(state.vortices ?? [], beat, dt);

  return {
    scale: state.scale,
    detail: DETAIL_BASE + DETAIL_TREBLE * treble,
    time: state.fieldTime,
    vortices: state.vortices,
    surge: state.surge,
    speed: SPEED_BASE + SPEED_BASS * frame.bass + SPEED_SURGE * state.surge,
    hue: paletteHue(frame, state.drift, state.tint),
  };
}

// The spectral centroid, remapped so the range typical music covers spans 0 to 1.
function brightnessOf(values) {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    weighted += i * values[i];
    total += values[i];
  }
  if (total <= 0) return 0.5;
  const centroid = weighted / total / (values.length - 1);
  return Math.min(1, Math.max(0, (centroid - CENTROID_LOW) / (CENTROID_HIGH - CENTROID_LOW)));
}

function follow(current, target, ratePerSecond, dt) {
  return target + (current - target) * Math.exp(-ratePerSecond * dt);
}

function paletteHue(frame, drift, tint) {
  return hslOf(frame.palette.accent).hue + drift - HUE_CENTROID_SWING * (tint - 0.5);
}

// Centers sit in the ellipse's own proportions, so a whirlpool lands inside the field at any shape.
function stepVortices(vortices, beat, dt) {
  const decay = Math.exp(-VORTEX_DECAY_PER_SECOND * dt);
  const kept = [];
  for (const vortex of vortices) {
    vortex.spin *= decay;
    if (Math.abs(vortex.spin) > VORTEX_MIN) kept.push(vortex);
  }
  if (beat) {
    const angle = Math.random() * Math.PI * 2;
    const reach = Math.sqrt(Math.random()) * VORTEX_REACH;
    kept.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, spin: (Math.random() < 0.5 ? -1 : 1) * VORTEX_STRENGTH });
  }
  return kept.slice(-MAX_VORTICES);
}

function trailLayers(state, frame) {
  const current = state.trails;
  if (current !== undefined && current.width === frame.width && current.height === frame.height) return current;
  state.trails = {
    width: frame.width,
    height: frame.height,
    layers: [frame.createLayer(frame.width, frame.height), frame.createLayer(frame.width, frame.height)],
    active: 0,
    age: 0,
    pendingFade: 0,
  };
  return state.trails;
}

function wipeTrails(state, frame) {
  state.trailLevel = 0;
  if (state.trails === undefined) return;
  for (const layer of state.trails.layers) layer.ctx.clearRect(0, 0, frame.width, frame.height);
}

// One layer takes the new silk while the other retires, and the retired one is wiped when its turn comes again.
function ageTrails(trails, frame, fadeRate) {
  trails.age += frame.dtSeconds;
  trails.pendingFade += frame.dtSeconds;
  if (trails.age >= GENERATION_S) {
    trails.age = 0;
    trails.active = 1 - trails.active;
    trails.layers[trails.active].ctx.clearRect(0, 0, frame.width, frame.height);
  }
  if (trails.pendingFade < FADE_INTERVAL_S) return;
  const erase = 1 - Math.exp(-fadeRate * trails.pendingFade);
  trails.pendingFade = 0;
  for (const layer of trails.layers) {
    const c = layer.ctx;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = `rgba(0, 0, 0, ${erase.toFixed(4)})`;
    c.fillRect(0, 0, frame.width, frame.height);
    c.restore();
  }
}

function particleSwarm(state, frame, field) {
  const current = state.swarm;
  if (current !== undefined && current.width === frame.width && current.height === frame.height) return current;
  const area = Math.PI * field.radiusX * field.radiusY;
  const count = Math.round(Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, area * PARTICLE_DENSITY)));
  const stride = (MAX_SUBSTEPS + 1) * 2;
  const band = new Uint8Array(count);
  const swarm = {
    width: frame.width,
    height: frame.height,
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    life: new Float32Array(count),
    band,
    trace: { points: new Float32Array(count * stride), stride, lengths: new Uint8Array(count), bands: band, count },
  };
  // Staggered lives, so the first births do not arrive together.
  for (let i = 0; i < count; i++) {
    spawn(swarm, i, field);
    swarm.life[i] *= Math.random();
  }
  state.swarm = swarm;
  return swarm;
}

function spawn(swarm, i, field) {
  const angle = Math.random() * Math.PI * 2;
  const reach = Math.sqrt(Math.random()) * SPAWN_REACH;
  swarm.x[i] = field.centerX + Math.sin(angle) * reach * field.radiusX;
  swarm.y[i] = field.centerY - Math.cos(angle) * reach * field.radiusY;
  swarm.band[i] = bandAt(angle);
  swarm.life[i] = LIFE_MIN_S + Math.random() * LIFE_RANGE_S;
}

// Bands fan out by birth angle from bass at the top to treble at the bottom, mirrored left and right,
// so every band holds an equal share of the field and the currents carry its color into the others.
function bandAt(angle) {
  const fold = angle <= Math.PI ? angle : Math.PI * 2 - angle;
  return Math.min(BANDS - 1, Math.floor((fold / Math.PI) * BANDS));
}

function outside(field, x, y) {
  const across = (x - field.centerX) / field.radiusX;
  const down = (y - field.centerY) / field.radiusY;
  return across * across + down * down > 1;
}

// Records each particle's path this frame into its trace, and a particle that leaves or expires is reborn unseen.
function moveSwarm(swarm, frame, field, motion) {
  const steps = Math.min(MAX_SUBSTEPS, Math.ceil(frame.dtSeconds / STEP_S));
  const stepSeconds = steps === 0 ? 0 : frame.dtSeconds / steps;
  const { trace } = swarm;
  const pxPerUnit = Float32Array.from(frame.values, (level) => motion.speed * (BAND_SPEED_MIN + BAND_SPEED_RANGE * level) * field.unit);
  const whirls = motion.vortices.map((vortex) => ({
    u: (vortex.x * field.radiusX) / field.unit,
    v: (vortex.y * field.radiusY) / field.unit,
    spin: vortex.spin,
  }));

  for (let i = 0; i < swarm.count; i++) {
    const base = i * trace.stride;
    const reach = pxPerUnit[swarm.band[i]] * stepSeconds;
    let x = swarm.x[i];
    let y = swarm.y[i];
    let length = 1;
    let gone = (swarm.life[i] -= frame.dtSeconds) <= 0;
    trace.points[base] = x;
    trace.points[base + 1] = y;
    for (let step = 0; step < steps && !gone; step++) {
      flowAt((x - field.centerX) / field.unit, (y - field.centerY) / field.unit, motion, whirls, FLOW);
      x += FLOW[0] * reach;
      y += FLOW[1] * reach;
      gone = outside(field, x, y);
      if (gone) break;
      trace.points[base + 2 * length] = x;
      trace.points[base + 2 * length + 1] = y;
      length++;
    }
    trace.lengths[i] = length;
    if (gone) {
      spawn(swarm, i, field);
    } else {
      swarm.x[i] = x;
      swarm.y[i] = y;
    }
  }
}

// The curl of two noise octaves plus the beat whirlpools. A curl has no divergence, so the silk never
// bunches into sinks or tears open, and each octave's curl is taken per its own cycle so scale leaves speed alone.
function flowAt(u, v, motion, whirls, out) {
  const fine = motion.scale * DETAIL_RATIO;
  noiseSlope(u * motion.scale, v * motion.scale, motion.time, SLOPE);
  let flowX = SLOPE[1];
  let flowY = -SLOPE[0];
  noiseSlope(u * fine + DETAIL_OFFSET, v * fine, motion.time * DETAIL_RATIO, SLOPE);
  flowX += motion.detail * SLOPE[1];
  flowY -= motion.detail * SLOPE[0];
  for (const whirl of whirls) {
    const dx = u - whirl.u;
    const dy = v - whirl.v;
    const lift = (whirl.spin * 2 * Math.exp(-(dx * dx + dy * dy) / (VORTEX_RADIUS * VORTEX_RADIUS))) / (VORTEX_RADIUS * VORTEX_RADIUS);
    flowX -= dy * lift;
    flowY += dx * lift;
  }
  const magnitude = Math.hypot(flowX, flowY);
  const limit = magnitude > MAX_FLOW ? MAX_FLOW / magnitude : 1;
  out[0] = flowX * limit;
  out[1] = flowY * limit;
}

/** Writes the x and y slopes of 3D gradient noise at (x, y, z) into out, from the analytic derivative. */
function noiseSlope(x, y, z, out) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const cellZ = Math.floor(z);
  const tx = x - cellX;
  const ty = y - cellY;
  const tz = z - cellZ;
  const lx = cellX & 255;
  const ly = cellY & 255;
  const lz = cellZ & 255;
  const a = PERMUTATION[lx] + ly;
  const b = PERMUTATION[lx + 1] + ly;
  const aa = PERMUTATION[a] + lz;
  const ab = PERMUTATION[a + 1] + lz;
  const ba = PERMUTATION[b] + lz;
  const bb = PERMUTATION[b + 1] + lz;
  const h000 = PERMUTATION[aa] & 15;
  const h100 = PERMUTATION[ba] & 15;
  const h010 = PERMUTATION[ab] & 15;
  const h110 = PERMUTATION[bb] & 15;
  const h001 = PERMUTATION[aa + 1] & 15;
  const h101 = PERMUTATION[ba + 1] & 15;
  const h011 = PERMUTATION[ab + 1] & 15;
  const h111 = PERMUTATION[bb + 1] & 15;

  const d000 = cornerDot(h000, tx, ty, tz);
  const d100 = cornerDot(h100, tx - 1, ty, tz);
  const d010 = cornerDot(h010, tx, ty - 1, tz);
  const d110 = cornerDot(h110, tx - 1, ty - 1, tz);
  const d001 = cornerDot(h001, tx, ty, tz - 1);
  const d101 = cornerDot(h101, tx - 1, ty, tz - 1);
  const d011 = cornerDot(h011, tx, ty - 1, tz - 1);
  const d111 = cornerDot(h111, tx - 1, ty - 1, tz - 1);
  const u = fade(tx);
  const v = fade(ty);
  const w = fade(tz);

  const gradientX = trilerp(GRADIENT_X[h000], GRADIENT_X[h100], GRADIENT_X[h010], GRADIENT_X[h110], GRADIENT_X[h001], GRADIENT_X[h101], GRADIENT_X[h011], GRADIENT_X[h111], u, v, w);
  const gradientY = trilerp(GRADIENT_Y[h000], GRADIENT_Y[h100], GRADIENT_Y[h010], GRADIENT_Y[h110], GRADIENT_Y[h001], GRADIENT_Y[h101], GRADIENT_Y[h011], GRADIENT_Y[h111], u, v, w);
  const alongU = lerp(lerp(d100 - d000, d110 - d010, v), lerp(d101 - d001, d111 - d011, v), w);
  const alongV = lerp(lerp(d010 - d000, d110 - d100, u), lerp(d011 - d001, d111 - d101, u), w);
  out[0] = gradientX + fadeSlope(tx) * alongU;
  out[1] = gradientY + fadeSlope(ty) * alongV;
}

function cornerDot(hash, dx, dy, dz) {
  return GRADIENT_X[hash] * dx + GRADIENT_Y[hash] * dy + GRADIENT_Z[hash] * dz;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function fadeSlope(t) {
  return 30 * t * t * (t - 1) * (t - 1);
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function trilerp(c000, c100, c010, c110, c001, c101, c011, c111, u, v, w) {
  return lerp(lerp(lerp(c000, c100, u), lerp(c010, c110, u), v), lerp(lerp(c001, c101, u), lerp(c011, c111, u), v), w);
}

// A fixed seed keeps the field the same on every load, so a favorite passage looks the same twice.
function shuffledLattice(seed) {
  const order = Array.from({ length: 256 }, (_, i) => i);
  let next = seed;
  for (let i = order.length - 1; i > 0; i--) {
    next = (Math.imul(next, 1664525) + 1013904223) >>> 0;
    const j = next % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return Uint8Array.from([...order, ...order]);
}

// Additive light on the dark card, and deeper ink laid over on the light one, where additive washes out.
function bandLooks(frame, hue, surge, presence) {
  const dark = frame.theme === 'dark';
  return Array.from(frame.values, (level, band) => {
    const bandHue = hue + HUE_BASS_OFFSET - (HUE_SPAN * band) / (BANDS - 1);
    const coreAlpha = presence * (dark ? 0.05 + 0.32 * level : 0.1 + 0.5 * level);
    if (coreAlpha < MIN_ALPHA) return null;
    const lightness = dark ? Math.min(80, 50 + 18 * level + 12 * surge) : 46 - 12 * level - 6 * surge;
    const saturation = dark ? 96 : 85;
    return {
      core: hsla(bandHue, saturation, lightness, coreAlpha),
      glow: hsla(bandHue, saturation, lightness, coreAlpha * (dark ? 0.22 : 0.12)),
      coreWidth: 0.7 + 0.9 * level + 0.5 * surge,
      glowWidth: Math.min(MAX_GLOW_WIDTH, 2.4 + 1.4 * level + 0.6 * surge),
    };
  });
}

function hsla(hue, saturation, lightness, alpha) {
  const wrapped = ((hue % 360) + 360) % 360;
  return `hsla(${wrapped.toFixed(1)}, ${saturation}%, ${lightness.toFixed(1)}%, ${Math.min(1, alpha).toFixed(3)})`;
}

// One path per band carries every line of that band, stroked once wide and faint for glow and once thin.
// Butt caps keep consecutive segments from overlapping, which additive light would show as beads.
function strokeLines(c, lines, looks, theme) {
  c.save();
  c.globalCompositeOperation = theme === 'dark' ? 'lighter' : 'source-over';
  c.lineCap = 'butt';
  c.lineJoin = 'round';
  for (let band = 0; band < BANDS; band++) {
    const look = looks[band];
    if (look === null || !traceBand(c, lines, band)) continue;
    c.strokeStyle = look.glow;
    c.lineWidth = look.glowWidth;
    c.stroke();
    c.strokeStyle = look.core;
    c.lineWidth = look.coreWidth;
    c.stroke();
  }
  c.restore();
}

function traceBand(c, lines, band) {
  let traced = false;
  c.beginPath();
  for (let i = 0; i < lines.count; i++) {
    const length = lines.lengths[i];
    if (lines.bands[i] !== band || length < 2) continue;
    const base = i * lines.stride;
    c.moveTo(lines.points[base], lines.points[base + 1]);
    for (let k = 1; k < length; k++) c.lineTo(lines.points[base + 2 * k], lines.points[base + 2 * k + 1]);
    traced = true;
  }
  return traced;
}

// The retiring layer holds full strength for half a generation, by which time its own silk has faded,
// then dims out so the residue it strands never shows a seam.
function showTrails(ctx, trails, frame) {
  const half = GENERATION_S / 2;
  const retiring = Math.min(1, Math.max(0, (GENERATION_S - trails.age) / half));
  ctx.save();
  ctx.globalCompositeOperation = frame.theme === 'dark' ? 'lighter' : 'source-over';
  if (retiring > 0) {
    ctx.globalAlpha = retiring;
    ctx.drawImage(trails.layers[1 - trails.active].canvas, 0, 0, frame.width, frame.height);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(trails.layers[trails.active].canvas, 0, 0, frame.width, frame.height);
  ctx.restore();
}

function maskField(ctx, frame, field) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.translate(field.centerX, field.centerY);
  ctx.scale(field.radiusX, field.radiusY);
  const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, alpha] of MASK_STOPS) mask.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
  ctx.fillStyle = mask;
  // In the scaled space the canvas spans this rectangle, so the mask reaches every pixel.
  ctx.fillRect(-field.centerX / field.radiusX, -field.centerY / field.radiusY, frame.width / field.radiusX, frame.height / field.radiusY);
  ctx.restore();
}

// Reduced motion shows the same field as still streamlines, whose glow and width follow their bands.
function drawStill(ctx, frame, field, presence) {
  const { state } = frame;
  if ((state.trailLevel ?? 0) > 0) wipeTrails(state, frame);
  if (presence <= 0) return false;
  const lines = stillLines(state, frame, field);
  const hue = paletteHue(frame, state.drift ?? 0, brightnessOf(frame.values));
  strokeLines(ctx, lines, bandLooks(frame, hue, 0, presence * STILL_GAIN), frame.theme);
  maskField(ctx, frame, field);
  return true;
}

function stillLines(state, frame, field) {
  const current = state.still;
  if (current !== undefined && current.width === frame.width && current.height === frame.height) return current.lines;
  const area = Math.PI * field.radiusX * field.radiusY;
  const count = Math.round(Math.min(STILL_MAX, Math.max(STILL_MIN, area * STILL_DENSITY)));
  const stride = (STILL_STEPS + 1) * 2;
  const lines = { points: new Float32Array(count * stride), stride, lengths: new Uint8Array(count), bands: new Uint8Array(count), count };
  const motion = { scale: state.scale ?? SCALE_BROAD, detail: DETAIL_BASE, time: state.fieldTime ?? 0 };
  for (let i = 0; i < count; i++) traceStreamline(lines, i, field, motion);
  state.still = { width: frame.width, height: frame.height, lines };
  return lines;
}

// Steps of equal length along the flow, so every streamline is as long as the field allows.
function traceStreamline(lines, i, field, motion) {
  const angle = Math.random() * Math.PI * 2;
  const reach = Math.sqrt(Math.random()) * SPAWN_REACH;
  const base = i * lines.stride;
  const stepPx = STILL_STEP * field.unit;
  let x = field.centerX + Math.sin(angle) * reach * field.radiusX;
  let y = field.centerY - Math.cos(angle) * reach * field.radiusY;
  let length = 1;
  lines.bands[i] = bandAt(angle);
  lines.points[base] = x;
  lines.points[base + 1] = y;
  for (let step = 0; step < STILL_STEPS; step++) {
    flowAt((x - field.centerX) / field.unit, (y - field.centerY) / field.unit, motion, NO_WHIRLS, FLOW);
    const magnitude = Math.hypot(FLOW[0], FLOW[1]);
    if (magnitude < 1e-6) break;
    x += (FLOW[0] / magnitude) * stepPx;
    y += (FLOW[1] / magnitude) * stepPx;
    if (outside(field, x, y)) break;
    lines.points[base + 2 * length] = x;
    lines.points[base + 2 * length + 1] = y;
    length++;
  }
  lines.lengths[i] = length;
}

export default { label: 'Silk currents', draw };
