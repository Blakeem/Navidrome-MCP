import { average, detectBeat, resample } from '../visualizer-kit.js';

const TAU = Math.PI * 2;
const DEG_PER_RAD = 180 / Math.PI;

// Hues of real bioluminescence, from the cyan of dinoflagellates to the violet and magenta of deep jellies.
const BIO_HUES = [188, 272, 160, 306, 206, 242];
const PLANKTON_HUE = 178;
const HUE_SWAY_DEG = 14;
// Additive light glows on the dark card but washes out on white, so the light theme lays deep inks instead.
// Lightness is in percent: tone for bodies, accent for outlines and organs, belly for the lit core of a bell.
const INKS = {
  dark: {
    blend: 'lighter', glowPass: true, saturation: 100,
    tone: 62, accent: 80, belly: 84, comb: 72, mote: 58, moteStep: 10, halo: 1, alpha: 1,
  },
  light: {
    blend: 'source-over', glowPass: false, saturation: 92,
    tone: 40, accent: 30, belly: 52, comb: 42, mote: 36, moteStep: -3, halo: 0.45, alpha: 1.2,
  },
};

// One jelly per slot about this many inner heights wide, so the phone strip holds a row and a square holds one.
const SLOT_ASPECT = 0.85;
const MAX_JELLIES = 6;
// Smaller jellies read as farther away, so they also glow dimmer.
const DEPTH_SIZES = [1, 0.8, 0.93, 0.74, 0.97, 0.85];
const SMALLEST_SIZE = 0.74;
// Reaches in bell radii from the rim center. Up covers the halo, side the halo and bell at full tilt, and down
// the longest tentacle with its tip bead, its glow and the drop of a tilted rim.
const REACH_UP = 1.85;
const REACH_SIDE = 1.5;
const REACH_DOWN = 2.45;
// Vertical room in bell radii kept free for swimming, so even the phone strip lets a jelly lurch.
const MIN_SWIM = 2.2;
// A strip just inside the pad stays empty, since the host fades the canvas edges.
const EDGE_PX = 1.5;
const MIN_RADIUS_PX = 3;

const PRESENCE_GAIN = 3;
// The fraction of the glow left after one second of silence, so the sea goes dark in under two seconds.
const GLOW_RETAIN_PER_SECOND = 0.05;
const SLEEP_GLOW = 0.01;
const KICK_DECAY_PER_SECOND = 5;

// The bell squeezes on its own bass band above this floor, and a beat squeezes it further.
const BASS_FLOOR = 0.2;
const CONTRACT_BASS = 1.1;
const CONTRACT_KICK = 0.55;
const MAX_TILT = 0.18;
const TILT_PER_SPEED = 0.25;
// Swimming runs in bell radii and seconds. A beat or a sharp squeeze drives the jelly up about half a radius,
// and a damped spring sinks it back toward a home that wanders slowly through its slot.
const BEAT_THRUST = 3.1;
const PULSE_THRUST = 1.2;
const SIDE_KICK = 0.9;
const SPRING_PER_S2 = 10;
const DRAG_PER_SECOND = 4.5;
// Steady beats hold a jelly above its home, so the home sits low in the range and the lift carries it to the
// middle. Thrust also weakens near the top, so a busy track never pins the swarm against it.
const HOME_SINK = 0.4;
const WANDER = 0.45;
const TOP_THRUST = 0.25;

// Six pairs read the spectrum from the outer pair (bass) to the inner pair (treble).
const TENTACLE_PAIRS = 6;
const TENTACLE_SEGMENTS = 10;
const TENTACLE_LENGTH = 2.05;
const ROOT_SPREAD_OUTER = 0.8;
const ROOT_SPREAD_INNER = 0.18;
// Treble tentacles ripple faster and in tighter waves than the slow bass ones.
const WAVE_RATE = 1.4;
const WAVE_RATE_PER_PAIR = 0.9;
const TENTACLE_WIDTH = 0.045;
const TENTACLE_MIN_WIDTH = 0.75;
const GLOW_WIDTH_SCALE = 3.4;
const BEAD_RADIUS = 0.05;
const BEAD_MIN_RADIUS = 0.6;
const BEAD_SWELL = 1.4;

const ORAL_SEGMENTS = 12;
const ORAL_LENGTH = 1.3;
const ORAL_WIDTH = 0.14;

const LOBES = 8;
const LOBE_DIP = 0.07;
const COMB_ROWS = 6;
const COMB_STOPS = 6;
const OUTLINE_WIDTH = 0.035;
const RIM_GLOW_WIDTH = 0.12;
// Four gonads across the bell as offset and width in bell half-widths, the wide middle pair nearest the eye.
const GONADS = [[-0.46, 0.11], [-0.16, 0.15], [0.16, 0.15], [0.46, 0.11]];

const PLANKTON_MAX = 110;
// Inner area in square CSS pixels per mote. The pool caps the count, so the wide window stays as light as the default.
const PLANKTON_AREA_PX = 900;
const PLANKTON_MIN = 26;
const PLANKTON_RADIUS = 0.008;
const PLANKTON_MIN_RADIUS = 0.6;
const PLANKTON_SIZE_MIN = 0.6;
const PLANKTON_SIZE_MAX = 1.4;
const PLANKTON_HALO = 3.2;
const PLANKTON_DRIFT = 0.05;
const PLANKTON_BASE = 0.08;
const PLANKTON_TWINKLE = 0.9;
const STILL_SPARKLE = 0.35;
// A flash dies fast, so a passing wave shows as a moving band of light rather than a lit field.
const FLASH_DECAY_PER_SECOND = 5;
// Brightness buckets, so every mote of one brightness joins one fill. The top buckets also get halos.
const BUCKET_FLOORS = [0.05, 0.22, 0.42, 0.66];
const BUCKET_LEVELS = [0.16, 0.34, 0.56, 0.9];
const HALO_BUCKET = 2;

// Pressure waves run in bell radii, so each jelly lights its own neighborhood at every size. A wave dims with
// distance and stops where its flash would no longer show.
const RIPPLE_SPEED = 5;
const RIPPLE_FALLOFF = 4;
const RIPPLE_REACH = 11;
const MAX_RIPPLES = 24;
const WAKE_REACH = 2.2;
const WAKE_SPEED = 0.35;
const STILL_FLASH_REACH = 3;

/**
 * Glowing jellyfish over drifting plankton in a dark sea. Bells pulse and lurch upward on the bass, tentacles
 * sway with the bands, and every beat sends an unseen pressure wave that the plankton reveal as they flash.
 */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  state.glow = Math.max((state.glow ?? 0) * GLOW_RETAIN_PER_SECOND ** frame.dtSeconds, presence);
  const layout = layoutOf(frame);
  if (state.glow < SLEEP_GLOW || layout.radius < MIN_RADIUS_PX) {
    state.ripples = [];
    return false;
  }

  const ink = frame.theme === 'light' ? INKS.light : INKS.dark;
  const motion = advance(state, frame, beat);
  const poses = swimSwarm(swarmFor(state, layout), layout, motion);
  const plankton = driftPlankton(state, layout, poses, motion);
  ctx.save();
  ctx.globalCompositeOperation = ink.blend;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  paintPlankton(ctx, plankton, ink);
  for (const pose of poses) paintJelly(ctx, pose, layout, motion, ink);
  ctx.restore();
  // The glow outlasts the music, so the host keeps drawing until it fades.
  return true;
}

function layoutOf(frame) {
  const left = frame.pad + EDGE_PX;
  const top = frame.pad + EDGE_PX;
  const right = frame.width - frame.pad - EDGE_PX;
  const bottom = frame.height - frame.pad - EDGE_PX;
  const innerW = Math.max(0, right - left);
  const innerH = Math.max(0, bottom - top);
  const count = clamp(Math.round(innerW / Math.max(1, innerH * SLOT_ASPECT)), 1, MAX_JELLIES);
  const radius = Math.min(innerH / (REACH_UP + REACH_DOWN + MIN_SWIM), innerW / (count * 2 * REACH_SIDE));
  return { left, top, right, bottom, innerW, innerH, short: Math.min(innerW, innerH), count, radius, slot: innerW / count };
}

// Phases wrap at a full turn and are only read through whole multiples, so the wrap never shows.
function advance(state, frame, beat) {
  const dt = frame.reducedMotion ? 0 : frame.dtSeconds;
  const bands = frame.values.length;
  const levels = resample(frame.values, TENTACLE_PAIRS);
  const treble = average(frame.values, bands - 5, bands);
  const mid = average(frame.values, 5, 10);
  const waves = (state.waves ??= new Float32Array(TENTACLE_PAIRS));
  for (let p = 0; p < TENTACLE_PAIRS; p++) waves[p] = (waves[p] + dt * (WAVE_RATE + WAVE_RATE_PER_PAIR * p) * (0.6 + 0.8 * levels[p])) % TAU;
  state.kick = (beat ? 1 : (state.kick ?? 0)) * Math.exp(-KICK_DECAY_PER_SECOND * frame.dtSeconds);
  state.drift = (state.drift ?? 0) + dt;
  state.curl = ((state.curl ?? 0) + dt * (0.6 + 1.2 * mid)) % TAU;
  state.shimmer = ((state.shimmer ?? 0) + dt * (1 + 5 * treble)) % TAU;
  return {
    dt,
    flashFade: Math.exp(-FLASH_DECAY_PER_SECOND * frame.dtSeconds),
    still: frame.reducedMotion,
    beat,
    glow: state.glow,
    values: frame.values,
    levels,
    treble,
    mid,
    waves,
    kick: state.kick,
    drift: state.drift,
    curl: state.curl,
    shimmer: state.shimmer,
  };
}

function swarmFor(state, layout) {
  if (state.swarm?.length === layout.count) return state.swarm;
  const firstHue = Math.floor(Math.random() * BIO_HUES.length);
  state.swarm = Array.from({ length: layout.count }, (_, j) => ({
    size: layout.count === 1 ? 1 : DEPTH_SIZES[j % DEPTH_SIZES.length],
    hue: BIO_HUES[(firstHue + j) % BIO_HUES.length],
    band: j % 4,
    seed: Math.random() * TAU,
    rateX: 0.07 + Math.random() * 0.06,
    rateY: 0.11 + Math.random() * 0.08,
    dx: 0,
    dy: 0,
    vx: 0,
    vy: 0,
    contraction: 0,
    room: 1,
  }));
  return state.swarm;
}

function swimSwarm(swarm, layout, motion) {
  return swarm.map((jelly, index) => {
    const bass = motion.values[jelly.band];
    const contraction = Math.min(1, CONTRACT_BASS * Math.max(0, bass - BASS_FLOOR) + CONTRACT_KICK * motion.kick);
    swim(jelly, contraction, motion);
    return place(jelly, index, layout.radius * jelly.size, layout, motion, contraction);
  });
}

// Only a rising squeeze pushes, the way a real bell thrusts on its contraction and coasts on its release.
function swim(jelly, contraction, motion) {
  const squeeze = Math.max(0, contraction - jelly.contraction);
  const power = TOP_THRUST + (1 - TOP_THRUST) * jelly.room;
  jelly.contraction = contraction;
  if (motion.still) return;
  const drag = Math.exp(-DRAG_PER_SECOND * motion.dt);
  if (motion.beat) {
    jelly.vy -= BEAT_THRUST * power * (0.6 + 0.4 * contraction);
    jelly.vx += (Math.random() - 0.5) * SIDE_KICK;
  }
  jelly.vy = (jelly.vy - squeeze * PULSE_THRUST * power - SPRING_PER_S2 * jelly.dy * motion.dt) * drag;
  jelly.vx = (jelly.vx - SPRING_PER_S2 * jelly.dx * motion.dt) * drag;
  jelly.dy += jelly.vy * motion.dt;
  jelly.dx += jelly.vx * motion.dt;
}

// The range keeps every reach of the jelly inside the padded area, so its position is the only clamp it needs.
function place(jelly, index, r, layout, motion, contraction) {
  const slotCenter = layout.left + layout.slot * (index + 0.5);
  const sideRoom = Math.max(0, layout.slot / 2 - REACH_SIDE * r);
  const rimMin = layout.top + REACH_UP * r;
  const rimMax = layout.bottom - REACH_DOWN * r;
  const homeX = slotCenter + sideRoom * WANDER * Math.sin(motion.drift * jelly.rateX + jelly.seed);
  const homeY = (rimMin + rimMax) / 2 + ((rimMax - rimMin) / 2) * (HOME_SINK + WANDER * Math.sin(motion.drift * jelly.rateY + jelly.seed * 1.7));
  const x = clamp(homeX + jelly.dx * r, slotCenter - sideRoom, slotCenter + sideRoom);
  const y = clamp(homeY + jelly.dy * r, rimMin, rimMax);
  settle(jelly, (x - homeX) / r, (y - homeY) / r);
  jelly.room = (y - rimMin) / Math.max(1e-6, rimMax - rimMin);
  const depth = 0.55 + (0.45 * (jelly.size - SMALLEST_SIZE)) / (1 - SMALLEST_SIZE);
  const sway = motion.still ? 0 : jelly.vx * TILT_PER_SPEED + 0.06 * Math.sin(motion.drift * 0.6 + jelly.seed);
  return {
    x,
    y,
    r,
    w: r * (1 - 0.22 * contraction),
    h: r * (0.82 + 0.38 * contraction),
    contraction,
    tilt: clamp(sway, -MAX_TILT, MAX_TILT),
    hue: jelly.hue + HUE_SWAY_DEG * Math.sin(motion.drift * 0.05 + jelly.seed),
    alpha: motion.glow * depth * (0.8 + 0.3 * contraction),
    thrust: clamp(-jelly.vy / BEAT_THRUST, 0, 1),
    vx: jelly.vx,
    seed: jelly.seed,
  };
}

// A jelly held at the edge of its range loses the speed that pushes it further out, so it never sticks there.
function settle(jelly, dx, dy) {
  if ((dx < jelly.dx - 1e-6 && jelly.vx > 0) || (dx > jelly.dx + 1e-6 && jelly.vx < 0)) jelly.vx = 0;
  if ((dy < jelly.dy - 1e-6 && jelly.vy > 0) || (dy > jelly.dy + 1e-6 && jelly.vy < 0)) jelly.vy = 0;
  jelly.dx = dx;
  jelly.dy = dy;
}

function driftPlankton(state, layout, poses, motion) {
  const pool = (state.plankton ??= seedPlankton());
  const count = clamp(Math.round((layout.innerW * layout.innerH) / PLANKTON_AREA_PX), PLANKTON_MIN, PLANKTON_MAX);
  const radius = Math.max(PLANKTON_MIN_RADIUS, layout.short * PLANKTON_RADIUS);
  const margin = radius * PLANKTON_SIZE_MAX * PLANKTON_HALO + 0.5;
  const field = { left: layout.left + margin, top: layout.top + margin, spanX: layout.innerW - 2 * margin, spanY: layout.innerH - 2 * margin };
  const speed = layout.short * PLANKTON_DRIFT;
  const push = layout.short * WAKE_SPEED;
  const ripples = spreadRipples(state, poses, motion);
  const motes = pool.slice(0, count);
  for (const mote of motes) {
    // Positions come from the field each frame, so a resize keeps every mote inside the area.
    const x = field.left + mote.u * field.spanX;
    const y = field.top + mote.v * field.spanY;
    const wake = wakeAt(x, y, poses);
    const still = motion.still && motion.beat ? stillFlash(x, y, poses) : 0;
    mote.heading = (mote.heading + motion.dt * mote.turn) % TAU;
    mote.twinkle = (mote.twinkle + motion.dt * mote.rate * (0.5 + motion.treble)) % TAU;
    // Marine snow sinks, so the drift leans downward while the heading meanders.
    mote.u = wrap(mote.u + (motion.dt * (0.5 * speed * Math.cos(mote.heading) + push * wake.x)) / field.spanX);
    mote.v = wrap(mote.v + (motion.dt * ((0.35 + 0.3 * Math.sin(mote.heading)) * speed + push * wake.y)) / field.spanY);
    mote.flash = Math.max(mote.flash * motion.flashFade, mote.sensitivity * Math.max(wake.flash, still, rippleFlash(x, y, ripples)));
    mote.x = field.left + mote.u * field.spanX;
    mote.y = field.top + mote.v * field.spanY;
    const sparkle = motion.still ? STILL_SPARKLE : ((1 + Math.sin(mote.twinkle)) / 2) ** 3;
    mote.light = motion.glow * Math.min(1, PLANKTON_BASE + PLANKTON_TWINKLE * motion.treble * sparkle + mote.flash);
  }
  return { motes, radius };
}

function seedPlankton() {
  return Array.from({ length: PLANKTON_MAX }, () => ({
    u: Math.random(),
    v: Math.random(),
    x: 0,
    y: 0,
    heading: Math.random() * TAU,
    turn: (Math.random() - 0.5) * 0.8,
    twinkle: Math.random() * TAU,
    rate: 1.5 + Math.random() * 3,
    size: PLANKTON_SIZE_MIN + Math.random() * (PLANKTON_SIZE_MAX - PLANKTON_SIZE_MIN),
    // Some cells answer a disturbance more readily than others, so a wave lights the field unevenly.
    sensitivity: 0.35 + Math.random() * 0.65,
    flash: 0,
    light: 0,
  }));
}

// Each beat sends a ring out from every jelly. The ring is never drawn, only the plankton it lights on its way.
function spreadRipples(state, poses, motion) {
  const ripples = state.ripples ?? [];
  if (motion.beat && !motion.still) {
    for (const pose of poses) {
      ripples.push({ x: pose.x, y: pose.y - pose.h / 2, from: pose.r, to: pose.r, r: pose.r, strength: 0.55 + 0.45 * pose.contraction });
    }
  }
  for (const ripple of ripples) {
    ripple.from = ripple.to;
    ripple.to += ripple.r * RIPPLE_SPEED * motion.dt;
  }
  state.ripples = ripples.filter((ripple) => ripple.from < ripple.r * RIPPLE_REACH).slice(-MAX_RIPPLES);
  return state.ripples;
}

function rippleFlash(x, y, ripples) {
  let flash = 0;
  for (const ripple of ripples) {
    const distance = Math.hypot(x - ripple.x, y - ripple.y);
    if (distance >= ripple.from && distance < ripple.to) flash = Math.max(flash, ripple.strength * Math.exp(-distance / (ripple.r * RIPPLE_FALLOFF)));
  }
  return flash;
}

// A thrusting bell shoves nearby plankton aside, and the disturbance makes them flash.
function wakeAt(x, y, poses) {
  const wake = { x: 0, y: 0, flash: 0 };
  for (const pose of poses) {
    const dx = x - pose.x;
    const dy = y - (pose.y - pose.h / 2);
    const reach = pose.r * WAKE_REACH;
    const distance = Math.hypot(dx, dy);
    if (pose.thrust <= 0 || !(distance < reach) || distance < 1e-3) continue;
    const strength = pose.thrust * (1 - distance / reach);
    wake.x += (dx / distance) * strength;
    wake.y += (dy / distance) * strength;
    wake.flash = Math.max(wake.flash, strength * 0.5);
  }
  return wake;
}

// Under reduced motion no wave travels, so a beat lights the plankton around each jelly in place.
function stillFlash(x, y, poses) {
  let flash = 0;
  for (const pose of poses) {
    const distance = Math.hypot(x - pose.x, y - (pose.y - pose.h / 2));
    flash = Math.max(flash, 1 - distance / (pose.r * STILL_FLASH_REACH));
  }
  return flash;
}

function paintPlankton(c, plankton, ink) {
  const { motes, radius } = plankton;
  for (let k = 0; k < BUCKET_FLOORS.length; k++) {
    const floor = BUCKET_FLOORS[k];
    const ceiling = BUCKET_FLOORS[k + 1] ?? Infinity;
    const level = BUCKET_LEVELS[k];
    const hue = PLANKTON_HUE + 8 * k;
    const members = motes.filter((mote) => mote.light >= floor && mote.light < ceiling);
    if (members.length === 0) continue;
    if (k >= HALO_BUCKET) {
      // Two stacked discs fall off like a soft glow without a gradient per mote.
      paintDiscs(c, members, radius * PLANKTON_HALO * level, hsla(hue, ink.saturation, ink.mote, level * 0.07 * ink.halo));
      paintDiscs(c, members, radius * 1.9 * level, hsla(hue, ink.saturation, ink.mote, level * 0.14 * ink.halo));
    }
    paintDiscs(c, members, radius * (0.7 + 0.6 * level), hsla(hue, ink.saturation, ink.mote + ink.moteStep * k, level * ink.alpha));
  }
}

function paintDiscs(c, motes, radius, style) {
  c.fillStyle = style;
  c.beginPath();
  for (const mote of motes) {
    const size = radius * mote.size;
    c.moveTo(mote.x + size, mote.y);
    c.arc(mote.x, mote.y, size, 0, TAU);
  }
  c.fill();
}

function paintJelly(c, pose, layout, motion, ink) {
  paintHalo(c, pose, motion, ink);
  paintTentacles(c, pose, layout, motion, ink);
  paintOralArms(c, pose, layout, motion, ink);
  c.save();
  c.translate(pose.x, pose.y);
  c.rotate(pose.tilt);
  paintBell(c, pose, motion, ink);
  paintCombRows(c, pose, motion, ink);
  paintGonads(c, pose, motion, ink);
  paintMargin(c, pose, ink);
  c.restore();
}

// The halo sits on the middle of the tilted bell and swells as the bell squeezes.
function paintHalo(c, pose, motion, ink) {
  const centerX = pose.x + (pose.h / 2) * Math.sin(pose.tilt);
  const centerY = pose.y - (pose.h / 2) * Math.cos(pose.tilt);
  const radius = pose.r * (0.9 + 0.3 * Math.min(1, 0.6 * pose.contraction + 0.5 * motion.kick));
  const strength = pose.alpha * ink.halo * (0.2 + 0.25 * pose.contraction);
  const halo = c.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  halo.addColorStop(0, hsla(pose.hue, ink.saturation, ink.tone, strength));
  halo.addColorStop(0.45, hsla(pose.hue, ink.saturation, ink.tone, strength * 0.4));
  halo.addColorStop(1, hsla(pose.hue, ink.saturation, ink.tone, 0));
  c.fillStyle = halo;
  c.beginPath();
  c.arc(centerX, centerY, radius, 0, TAU);
  c.fill();
}

function paintTentacles(c, pose, layout, motion, ink) {
  const specs = tentacleSpecs(pose, motion);
  const coreWidth = Math.max(TENTACLE_MIN_WIDTH, pose.r * TENTACLE_WIDTH);
  const glowWidth = coreWidth * GLOW_WIDTH_SCALE;
  const bead = Math.max(BEAD_MIN_RADIUS, pose.r * BEAD_RADIUS);
  const bounds = insetBox(layout, Math.max(glowWidth / 2, bead * BEAD_SWELL) + 0.5);
  if (ink.glowPass) {
    c.lineWidth = glowWidth;
    c.strokeStyle = hsla(pose.hue, ink.saturation, ink.tone, pose.alpha * 0.14);
    c.beginPath();
    for (const spec of specs) traceTentacle(c, spec, bounds);
    c.stroke();
  }
  c.lineWidth = coreWidth;
  for (let p = 0; p < TENTACLE_PAIRS; p++) {
    c.strokeStyle = hsla(pose.hue + 7 * p, ink.saturation, ink.tone, pose.alpha * ink.alpha * (0.3 + 0.6 * motion.levels[p]));
    c.beginPath();
    traceTentacle(c, specs[2 * p], bounds);
    traceTentacle(c, specs[2 * p + 1], bounds);
    c.stroke();
  }
  // The stinging cells at the tips flicker with the treble.
  c.fillStyle = hsla(pose.hue + 40, ink.saturation, ink.accent, pose.alpha * (0.35 + 0.65 * motion.treble));
  c.beginPath();
  for (const spec of specs) {
    const radius = bead * (0.6 + 0.8 * spec.level);
    const x = clamp(tentacleX(spec, 1), bounds.left, bounds.right);
    const y = clamp(spec.rootY + spec.length, bounds.top, bounds.bottom);
    c.moveTo(x + radius, y);
    c.arc(x, y, radius, 0, TAU);
  }
  c.fill();
}

// Each band sets its pair's length and sway. Thrust straightens the tentacles and the bell's squeeze splays them.
function tentacleSpecs(pose, motion) {
  const specs = [];
  const cos = Math.cos(pose.tilt);
  const sin = Math.sin(pose.tilt);
  const drag = clamp(pose.vx, -1, 1) * pose.r * 0.2;
  for (let p = 0; p < TENTACLE_PAIRS; p++) {
    const level = motion.levels[p];
    const spread = ROOT_SPREAD_OUTER - ((ROOT_SPREAD_OUTER - ROOT_SPREAD_INNER) * p) / (TENTACLE_PAIRS - 1);
    for (const side of [-1, 1]) {
      const offset = side * spread * pose.w;
      specs.push({
        rootX: pose.x + offset * cos,
        rootY: pose.y + offset * sin + pose.r * 0.05,
        length: pose.r * TENTACLE_LENGTH * (0.5 + 0.5 * level) * (1 - 0.05 * p),
        amplitude: pose.r * (0.08 + 0.42 * level) * (1 - 0.5 * pose.thrust),
        splay: side * pose.r * 0.15 * pose.contraction,
        drag,
        wave: motion.waves[p] + pose.seed + side * 0.9,
        bend: 2.2 + 0.45 * p,
        level,
      });
    }
  }
  return specs;
}

// The wave runs from root to tip and grows toward the tip, where a tentacle hangs freest.
function tentacleX(spec, t) {
  return spec.rootX + spec.splay * t + spec.amplitude * t ** 1.3 * Math.sin(spec.wave - spec.bend * t) - spec.drag * t * t;
}

function traceTentacle(c, spec, bounds) {
  for (let i = 0; i <= TENTACLE_SEGMENTS; i++) {
    const t = i / TENTACLE_SEGMENTS;
    const x = clamp(tentacleX(spec, t), bounds.left, bounds.right);
    const y = clamp(spec.rootY + spec.length * t, bounds.top, bounds.bottom);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
}

// The frilled oral arms hang from the middle of the bell and curl slowly with the melody.
function paintOralArms(c, pose, layout, motion, ink) {
  const width = pose.r * ORAL_WIDTH;
  const bounds = insetBox(layout, width / 2 + 0.5);
  const length = pose.r * ORAL_LENGTH * (0.55 + 0.45 * motion.mid);
  c.beginPath();
  for (const side of [-1, 1]) {
    for (let i = 0; i <= ORAL_SEGMENTS; i++) {
      const t = i / ORAL_SEGMENTS;
      const curl = Math.sin(motion.curl + pose.seed + side * 1.3 - 2.4 * t);
      const frill = Math.sin(15 * t + 2 * motion.waves[3] + side);
      const x = clamp(pose.x + side * (pose.w * 0.12 + pose.r * 0.08 * t) + pose.r * t * (0.16 * curl + 0.04 * frill), bounds.left, bounds.right);
      const y = clamp(pose.y + length * t, bounds.top, bounds.bottom);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
  }
  c.lineWidth = width;
  c.strokeStyle = hsla(pose.hue + 20, ink.saturation, ink.tone, pose.alpha * ink.alpha * 0.18);
  c.stroke();
  c.lineWidth = Math.max(0.6, width * 0.25);
  c.strokeStyle = hsla(pose.hue + 20, ink.saturation, ink.accent, pose.alpha * 0.5);
  c.stroke();
}

// Drawn about the rim center in the bell's own tilted frame.
function paintBell(c, pose, motion, ink) {
  traceDome(c, pose);
  traceMarginLobes(c, pose);
  c.closePath();
  c.fillStyle = bellGradient(c, pose, motion, ink);
  c.fill();
  traceDome(c, pose);
  if (ink.glowPass) {
    c.lineWidth = pose.r * RIM_GLOW_WIDTH;
    c.strokeStyle = hsla(pose.hue, ink.saturation, ink.tone, pose.alpha * 0.16);
    c.stroke();
  }
  c.lineWidth = Math.max(0.8, pose.r * OUTLINE_WIDTH);
  c.strokeStyle = hsla(pose.hue, ink.saturation, ink.accent, pose.alpha * 0.8);
  c.stroke();
}

// A squeezed bell is narrower and taller, which the pose already carries in w and h.
function traceDome(c, { w, h }) {
  c.beginPath();
  c.moveTo(-w, 0);
  c.bezierCurveTo(-w, -h * 0.72, -w * 0.56, -h, 0, -h);
  c.bezierCurveTo(w * 0.56, -h, w, -h * 0.72, w, 0);
}

// The scalloped margin closes the dome, and its lobes deepen as the bell squeezes.
function traceMarginLobes(c, pose) {
  const dip = pose.r * (LOBE_DIP + 0.05 * pose.contraction);
  const step = (2 * pose.w) / LOBES;
  for (let k = 1; k <= LOBES; k++) {
    const x = pose.w - step * k;
    c.quadraticCurveTo(x + step / 2, dip, x, 0);
  }
}

// Thicker jelly at the margin catches more light, so the rim glows brighter than the middle of the bell.
function bellGradient(c, pose, motion, ink) {
  const { w, h, hue, alpha } = pose;
  const body = c.createRadialGradient(0, -h * 0.75, 0, 0, -h * 0.35, w * 1.15);
  const flash = ink.glowPass ? 10 * motion.kick : 0;
  body.addColorStop(0, hsla(hue, ink.saturation, Math.min(96, ink.belly + flash), alpha * ink.alpha * 0.4));
  body.addColorStop(0.6, hsla(hue, ink.saturation, ink.tone, alpha * ink.alpha * 0.14));
  body.addColorStop(1, hsla(hue + 25, ink.saturation, ink.tone, alpha * ink.alpha * 0.42));
  return body;
}

// Comb rows split light into a rainbow that runs down the bell, as a ctenophore's cilia do, quickened by the treble.
function paintCombRows(c, pose, motion, ink) {
  const { w, h } = pose;
  const shimmer = c.createLinearGradient(0, -h, 0, 0);
  for (let i = 0; i < COMB_STOPS; i++) {
    const hue = (motion.shimmer * DEG_PER_RAD - 60 * i + 720) % 360;
    const pulse = 0.5 + 0.5 * Math.sin(1.6 * i - 2 * motion.shimmer);
    shimmer.addColorStop(i / (COMB_STOPS - 1), hsla(hue, ink.saturation, ink.comb, pose.alpha * (0.12 + 0.6 * motion.treble * pulse)));
  }
  c.strokeStyle = shimmer;
  c.lineWidth = Math.max(0.6, pose.r * 0.03);
  c.beginPath();
  for (let k = 0; k < COMB_ROWS; k++) {
    const x = w * (-0.72 + (1.44 * k) / (COMB_ROWS - 1));
    c.moveTo(x * 0.2, -h * 0.86);
    c.quadraticCurveTo(x * 0.85, -h * 0.7, x, -h * 0.08);
  }
  c.stroke();
}

// The four gonads of a moon jelly glow inside the bell and brighten with the melody.
function paintGonads(c, pose, motion, ink) {
  const { w, h } = pose;
  const y = -h * 0.42;
  c.fillStyle = hsla(pose.hue + 40, ink.saturation, ink.accent, pose.alpha * (0.25 + 0.6 * motion.mid));
  c.beginPath();
  for (const [offset, size] of GONADS) {
    const radiusX = w * size;
    c.moveTo(w * offset + radiusX, y);
    c.ellipse(w * offset, y, radiusX, h * 0.09, 0, 0, TAU);
  }
  c.fill();
}

// The opening under the bell, seen edge on, gives the dome its depth.
function paintMargin(c, pose, ink) {
  c.lineWidth = Math.max(0.6, pose.r * 0.025);
  c.strokeStyle = hsla(pose.hue + 25, ink.saturation, ink.accent, pose.alpha * 0.35);
  c.beginPath();
  c.ellipse(0, 0, pose.w * 0.96, pose.r * (0.1 + 0.05 * pose.contraction), 0, 0, TAU);
  c.stroke();
}

function insetBox(layout, margin) {
  return { left: layout.left + margin, top: layout.top + margin, right: layout.right - margin, bottom: layout.bottom - margin };
}

function hsla(hue, saturation, lightness, alpha) {
  return `hsla(${hue.toFixed(1)}, ${saturation}%, ${lightness}%, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function wrap(value) {
  return value - Math.floor(value);
}

export default { label: 'Abyssal jellies', draw };
