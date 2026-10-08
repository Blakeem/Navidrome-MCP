import { average, detectBeat, resample, rgba } from '../visualizer-kit.js';

const TAU = Math.PI * 2;
const BANDS = 16;

// Additive light vanishes on white, so the light theme prints deeper teal with plain blending.
const INKS = {
  dark: {
    line: { r: 72, g: 226, b: 255 },
    hot: { r: 224, g: 253, b: 255 },
    glow: { r: 0, g: 176, b: 255 },
    blend: 'lighter',
    glowAlpha: 0.26,
    dim: 0.17,
    scanlineAlpha: 0.3,
    scanBandAlpha: 0.45,
  },
  light: {
    line: { r: 0, g: 124, b: 160 },
    hot: { r: 0, g: 56, b: 88 },
    glow: { r: 0, g: 150, b: 192 },
    blend: 'source-over',
    glowAlpha: 0.1,
    dim: 0.18,
    scanlineAlpha: 0.16,
    scanBandAlpha: 0.35,
  },
};
// Erasing ignores color and keeps only alpha.
const ERASE_INK = { r: 0, g: 0, b: 0 };

// The HUD reaches full strength at an energy of 0.25, under the average of the quietest tracks.
const PRESENCE_GAIN = 4;
// Natural-log fade per second once the music stops, so the HUD is gone in about 2 s.
const FADE_PER_SECOND = 2.4;
const MIN_PRESENCE = 0.01;
// Seconds the HUD takes to draw itself on when the music starts.
const BOOT_SECONDS = 1.4;

// Room inside the pad for the widest glow stroke.
const EDGE_MARGIN = 5;
// Glow is a wider translucent stroke under each line, far cheaper than shadowBlur.
const GLOW_PX = 2.2;
const LINE_RATIO = 0.014;

// The targeting brackets frame the reticle this many radii out to each side.
const BRACKET_SPREAD = 1.32;
const BRACKET_ARM = 0.26;
const BRACKET_TICK = 0.1;
const BRACKET_SNAP_X = 0.14;
const BRACKET_SNAP_Y = 0.07;
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

// Reticle radii as fractions of the reticle radius, from the core out to the bezel.
const CORE_RING = 0.1;
const CORE_PIP = 0.035;
const CORE_PIP_BASS = 0.045;
const CROSSHAIR_GAP = 0.14;
const RADAR_RADIUS = 0.5;
const RANGE_RINGS = 3;
const GAUGE_RADIUS = 0.585;
const GAUGE_WIDTH = 0.05;
const TICK_INNER = 0.67;
const TICK_BASE = 0.03;
const TICK_REACH = 0.15;
const ARC_RADIUS = 0.885;
const PING_REACH = 0.93;
const NOTCH_TIP = 0.915;
const BEZEL_RADIUS = 0.965;
const BEZEL_TICK = 0.03;

// Radians per second, so louder passages spin the beam faster.
const SWEEP_BASE = 1.6;
const SWEEP_ENERGY = 3.2;
const SWEEP_TRAIL = 1.2;
const SWEEP_ALPHA = 0.32;
// Natural-log fade per second of a painted contact, close to one beam turn of afterglow.
const CONTACT_FADE = 1.3;
const CONTACT_INNER = 0.16;
const CONTACT_SPAN = 0.78;
// Bands step around the scope by a stride coprime to 16, so neighbouring bands land far apart.
const CONTACT_STRIDE = 5;
const CONTACT_BUCKETS = 5;
const CONTACT_DOT = 0.03;
const CONTACT_MIN_PX = 1.2;

const LOCK_MIN_GLOW = 0.2;
const LOCK_FOLLOW = 10;
const LOCK_ACQUIRE_SECONDS = 0.35;
const LOCK_HOLD_SECONDS = 1.8;
const LOCK_FADE_SECONDS = 0.6;
const LOCK_SIZE = 0.085;
const LOCK_MIN_PX = 3;
// The lock bracket starts this much larger and turned 45 degrees, then snaps onto its contact.
const LOCK_ZOOM = 1.4;
// Natural-log decays per second of the effects a beat sets off.
const BRACKET_SNAP_DECAY = 5;
const FLASH_DECAY = 7;
const GLITCH_DECAY = 14;

const GAUGE_SEGMENTS = 36;
// The gauge runs clockwise from lower left to lower right, leaving the bottom open for the bass chevrons.
const GAUGE_START = Math.PI * 0.75;
const GAUGE_SWEEP = Math.PI * 1.5;
const GAUGE_FILL = 0.72;
// Energy runs from about 0.25 to 0.6 by track, so this range keeps the gauge off both stops.
const GAUGE_FLOOR = 0.08;
const GAUGE_SPAN = 0.62;
const GAUGE_PEAK_FALL = 0.35;
const CHEVRON_STEPS = [0.35, 0.55, 0.75];
const CHEVRON_FIRST = 0.535;
const CHEVRON_PITCH = 0.04;
const CHEVRON_HALF_WIDTH = 0.05;
const CHEVRON_DEPTH = 0.025;

// Ticks closer than this blur into a solid ring on a small reticle.
const TICK_SPACING_PX = 3.2;
const TICKS_MAX = 96;
const TICK_WIDTH = 1.2;
const MAJOR_TICKS = 8;

const ARC_COUNT = 3;
const ARC_LENGTH = 0.75;
const ARC_SPIN_BASE = 0.25;
const ARC_SPIN_TREBLE = 1.8;
const BEZEL_TICKS = 36;
const NOTCH_HALF_WIDTH = 0.035;

const PING_SECONDS = 0.55;
const PACKET_SECONDS = 0.75;
const PACKET_LENGTH = 0.18;
const MAX_PULSES = 4;

const WING_GAP = 0.14;
const WING_MIN_WIDTH = 36;
const WING_HEIGHT = 0.86;
const WING_INSET = 0.08;
const WING_BEND = 0.06;
const WING_ROWS = 8;
const WING_SPLIT_GAP = 0.16;
// A wing this wide puts its telemetry trace beside the bars, and one this tall puts it below them.
const TRACE_BESIDE_WIDTH = 110;
const TRACE_BELOW_HEIGHT = 90;
const BAR_SHARE = 0.45;
const BAR_SHARE_STACKED = 0.6;
const PIP_SIZE = 0.09;
const PIP_LIFT = 0.035;
const BEAT_PIPS = 4;
const SIGNAL_PIPS = 5;

const TRACE_RATE = 30;
const TRACE_SAMPLES = 96;
const TRACE_GRID_LINES = 3;
// A time tick every half second of history, so the grid scrolls with the trace.
const TRACE_TICK_EVERY = 15;
const TRACE_TICK = 0.05;

const SCANLINE_PITCH = 3;
const SCANLINE_WIDTH = 1;
const SCANLINE_DRIFT = 4;
const SCAN_BAND_SECONDS = 2.6;
const SCAN_BAND_HEIGHT = 0.22;
const FLICKER_DEPTH = 0.12;
const GLITCH_TEARS = 3;

/**
 * A holographic targeting HUD. A radar beam paints the bands as contacts inside rings of gauges and
 * spectrum ticks, brackets lock on with each beat, and data wings stream the levels and their history.
 */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const presence = updatePresence(state, frame);
  if (presence < MIN_PRESENCE) {
    // The next start boots the HUD again from an empty screen.
    state.hud = undefined;
    return false;
  }

  const hud = advanceHud(state, frame, beat);
  const layout = layoutHud(frame);
  const ink = frame.theme === 'light' ? INKS.light : INKS.dark;
  const scene = { c: ctx, frame, hud, layout, ink, alpha: presence * flickerOf(hud, frame) };
  ctx.globalCompositeOperation = ink.blend;
  ctx.lineJoin = 'round';
  drawReticle(scene);
  if (layout.wingWidth > 0) {
    drawWing(scene, -1);
    drawWing(scene, 1);
  }
  applyHologram(scene);
  // The HUD fades after the music, so the host keeps drawing until it is gone.
  return true;
}

function updatePresence(state, frame) {
  const target = Math.min(1, frame.energy * PRESENCE_GAIN);
  state.presence = Math.max(target, (state.presence ?? 0) * Math.exp(-FADE_PER_SECOND * frame.dtSeconds));
  return state.presence;
}

function createHud() {
  return {
    time: 0,
    boot: 0,
    sweep: -Math.PI / 2,
    arcSpin: 0,
    bracketSnap: 0,
    flash: 0,
    glitch: 0,
    beats: 0,
    gauge: 0,
    gaugePeak: 0,
    pings: [],
    packets: [],
    lock: null,
    contacts: Array.from({ length: BANDS }, (_, band) => ({ angle: ((((band * CONTACT_STRIDE) % BANDS) + 0.5) / BANDS) * TAU, reach: 0, glow: 0 })),
    history: { bass: new Float32Array(TRACE_SAMPLES), treble: new Float32Array(TRACE_SAMPLES), head: 0, total: 0, clock: 0 },
  };
}

function advanceHud(state, frame, beat) {
  const hud = (state.hud ??= createHud());
  const dt = frame.dtSeconds;
  const moving = frame.reducedMotion ? 0 : dt;
  const animate = beat && !frame.reducedMotion;
  const treble = average(frame.values, BANDS - 5, BANDS);
  const swept = moving * (SWEEP_BASE + SWEEP_ENERGY * frame.energy);
  const previousSweep = hud.sweep;

  hud.time += moving;
  hud.boot = frame.reducedMotion ? 1 : Math.min(1, hud.boot + dt / BOOT_SECONDS);
  hud.sweep = (hud.sweep + swept) % TAU;
  hud.arcSpin = (hud.arcSpin + moving * (ARC_SPIN_BASE + ARC_SPIN_TREBLE * treble)) % TAU;
  hud.bracketSnap = frame.reducedMotion ? 0 : pulse(hud.bracketSnap, beat, BRACKET_SNAP_DECAY, dt);
  hud.flash = pulse(hud.flash, beat, FLASH_DECAY, dt);
  hud.glitch = frame.reducedMotion ? 0 : pulse(hud.glitch, beat, GLITCH_DECAY, dt);
  if (beat) hud.beats += 1;
  hud.gauge = clamp((frame.energy - GAUGE_FLOOR) / GAUGE_SPAN);
  hud.gaugePeak = Math.max(hud.gauge, hud.gaugePeak - GAUGE_PEAK_FALL * dt);
  hud.pings = agePulses(hud.pings, dt, PING_SECONDS, animate);
  hud.packets = agePulses(hud.packets, dt, PACKET_SECONDS, animate);
  paintContacts(hud.contacts, frame, previousSweep, swept);
  updateLock(hud, frame, beat);
  recordHistory(hud.history, frame, treble);
  return hud;
}

function pulse(value, beat, decay, dt) {
  return beat ? 1 : value * Math.exp(-decay * dt);
}

function agePulses(ages, dt, lifetime, spawn) {
  const next = ages.map((age) => age + dt).filter((age) => age < lifetime);
  if (spawn) next.push(0);
  return next.slice(-MAX_PULSES);
}

// The beam refreshes each contact as it passes, the way a radar echo holds until the next turn.
function paintContacts(contacts, frame, previousSweep, swept) {
  const fade = Math.exp(-CONTACT_FADE * frame.dtSeconds);
  for (const [band, contact] of contacts.entries()) {
    const level = frame.values[band];
    if (frame.reducedMotion) {
      contact.reach = CONTACT_INNER + CONTACT_SPAN * level;
      contact.glow = level;
      continue;
    }
    contact.glow *= fade;
    const ahead = (contact.angle - previousSweep + 2 * TAU) % TAU;
    if (ahead >= swept) continue;
    contact.reach = CONTACT_INNER + CONTACT_SPAN * level;
    contact.glow = level;
  }
}

function updateLock(hud, frame, beat) {
  const target = beat ? strongestContact(hud.contacts) : null;
  if (target !== null) {
    const from = hud.lock ?? contactPoint(target);
    hud.lock = { contact: target, x: from.x, y: from.y, age: 0 };
  }
  const lock = hud.lock;
  if (lock === null) return;
  lock.age += frame.dtSeconds;
  if (lock.age > LOCK_HOLD_SECONDS + LOCK_FADE_SECONDS) {
    hud.lock = null;
    return;
  }
  const goal = contactPoint(lock.contact);
  const follow = frame.reducedMotion ? 1 : 1 - Math.exp(-LOCK_FOLLOW * frame.dtSeconds);
  lock.x += (goal.x - lock.x) * follow;
  lock.y += (goal.y - lock.y) * follow;
}

function strongestContact(contacts) {
  let best = null;
  for (const contact of contacts) {
    if (contact.glow >= LOCK_MIN_GLOW && (best === null || contact.glow > best.glow)) best = contact;
  }
  return best;
}

// In radar radii from the reticle center.
function contactPoint(contact) {
  return { x: Math.cos(contact.angle) * contact.reach, y: Math.sin(contact.angle) * contact.reach };
}

// Samples at a fixed rate, so the trace scrolls at the same speed at any frame rate.
function recordHistory(history, frame, treble) {
  history.clock += frame.dtSeconds;
  while (history.clock >= 1 / TRACE_RATE) {
    history.clock -= 1 / TRACE_RATE;
    history.bass[history.head] = frame.bass;
    history.treble[history.head] = treble;
    history.head = (history.head + 1) % TRACE_SAMPLES;
    history.total += 1;
  }
}

function flickerOf(hud, frame) {
  if (frame.reducedMotion) return 1;
  const t = hud.time;
  // Three unrelated rates make the dips irregular, the way a weak projector stutters.
  const dip = Math.max(0, Math.sin(t * 11.3) * Math.sin(t * 3.7) * Math.sin(t * 23.9));
  return 1 - FLICKER_DEPTH * dip;
}

// The reticle fills the height, and on a wide area a data wing takes the room left beside the brackets.
function layoutHud(frame) {
  const { width, height, pad } = frame;
  const halfWidth = width / 2 - pad - EDGE_MARGIN;
  const halfHeight = height / 2 - pad - EDGE_MARGIN;
  const radius = Math.min(halfHeight, halfWidth / BRACKET_SPREAD);
  const wingStart = radius * (BRACKET_SPREAD + WING_GAP);
  const wingWidth = halfWidth - wingStart;
  return {
    centerX: width / 2,
    centerY: height / 2,
    radius,
    lineWidth: Math.min(2, Math.max(1, radius * LINE_RATIO)),
    wingStart,
    wingWidth: wingWidth >= WING_MIN_WIDTH ? wingWidth : 0,
  };
}

function drawReticle(scene) {
  drawBezel(scene);
  drawRadar(scene);
  drawTickRing(scene);
  drawGauge(scene);
  drawBassChevrons(scene);
  drawPings(scene);
  drawContacts(scene);
  drawLock(scene);
  drawCore(scene);
  drawBrackets(scene);
}

function drawBezel(scene) {
  const { c, layout, hud, ink, alpha } = scene;
  const { centerX: x, centerY: y, radius } = layout;
  const reveal = stage(hud.boot, 0, 0.45);
  const ring = radius * BEZEL_RADIUS;
  const top = -Math.PI / 2;
  const arcRadius = radius * ARC_RADIUS;
  const arcLength = ARC_LENGTH * stage(hud.boot, 0.15, 0.4);

  c.beginPath();
  c.moveTo(x, y - ring);
  c.arc(x, y, ring, top, top + TAU * reveal);
  for (let k = 0; k < Math.round(BEZEL_TICKS * reveal); k++) radialSegment(c, layout, top + (k / BEZEL_TICKS) * TAU, ring - radius * BEZEL_TICK, ring);
  for (let k = 0; k < MAJOR_TICKS; k++) radialSegment(c, layout, (k / MAJOR_TICKS) * TAU, radius * (TICK_INNER - 0.04), radius * (TICK_INNER - 0.012));
  strokeFaint(scene, alpha * (ink.dim + 0.3 * hud.flash), layout.lineWidth);

  c.beginPath();
  for (let k = 0; k < ARC_COUNT; k++) {
    const from = hud.arcSpin + (k / ARC_COUNT) * TAU;
    c.moveTo(x + Math.cos(from) * arcRadius, y + Math.sin(from) * arcRadius);
    c.arc(x, y, arcRadius, from, from + arcLength);
  }
  strokeGlowing(scene, rgba(ink.line, alpha * 0.8), alpha * 0.8, layout.lineWidth * 1.6);

  c.beginPath();
  for (let k = 0; k < 4; k++) notchPath(c, layout, (k / 4) * TAU);
  c.fillStyle = rgba(ink.line, alpha * 0.55 * reveal);
  c.fill();
  // The heading pointer rides the bezel at the radar beam's bearing.
  c.beginPath();
  notchPath(c, layout, hud.sweep);
  c.fillStyle = rgba(ink.hot, alpha * 0.9 * reveal);
  c.fill();
}

function drawRadar(scene) {
  const { c, layout, hud, ink, alpha } = scene;
  const { centerX: x, centerY: y } = layout;
  const radar = radarRadius(layout, hud);
  const lead = SWEEP_TRAIL / TAU;
  if (radar < 1) return;

  c.beginPath();
  for (let ring = 1; ring <= RANGE_RINGS; ring++) circlePath(c, x, y, (radar * ring) / RANGE_RINGS);
  for (let k = 0; k < 4; k++) radialSegment(c, layout, (k / 4) * TAU, layout.radius * CROSSHAIR_GAP, radar);
  strokeFaint(scene, alpha * ink.dim * 1.4, layout.lineWidth * 0.8);

  const trail = c.createConicGradient(hud.sweep - SWEEP_TRAIL, x, y);
  trail.addColorStop(0, rgba(ink.line, 0));
  trail.addColorStop(lead, rgba(ink.line, alpha * SWEEP_ALPHA));
  trail.addColorStop(lead + 0.001, rgba(ink.line, 0));
  c.fillStyle = trail;
  c.beginPath();
  c.moveTo(x, y);
  c.arc(x, y, radar, hud.sweep - SWEEP_TRAIL, hud.sweep);
  c.closePath();
  c.fill();

  c.beginPath();
  radialSegment(c, layout, hud.sweep, 0, radar);
  strokeGlowing(scene, rgba(ink.hot, alpha * 0.9), alpha, layout.lineWidth);
}

// Both halves run from treble at the top to bass at the bottom, so the ring mirrors left and right.
function drawTickRing(scene) {
  const { c, layout, frame, hud, ink, alpha } = scene;
  const { centerX: x, centerY: y, radius } = layout;
  const count = tickCount(radius);
  const half = count / 2;
  const levels = resample(frame.values, half);
  const shown = Math.round(count * stage(hud.boot, 0.2, 0.5));
  const inner = radius * TICK_INNER;
  const outer = radius * (TICK_INNER + TICK_BASE + TICK_REACH);
  if (shown === 0) return;

  c.beginPath();
  for (let k = 0; k < shown; k++) {
    const fromTop = k < half ? k : count - 1 - k;
    const level = levels[half - 1 - fromTop];
    const angle = -Math.PI / 2 + ((k + 0.5) / count) * TAU;
    radialSegment(c, layout, angle, inner, inner + radius * (TICK_BASE + TICK_REACH * level));
  }
  const heat = c.createRadialGradient(x, y, inner, x, y, outer);
  heat.addColorStop(0, rgba(ink.line, alpha * 0.3));
  heat.addColorStop(0.5, rgba(ink.line, alpha * 0.85));
  heat.addColorStop(1, rgba(ink.hot, alpha));
  strokeGlowing(scene, heat, alpha * 0.8, layout.lineWidth * TICK_WIDTH);
}

function tickCount(radius) {
  const fit = Math.floor((TAU * TICK_INNER * radius) / TICK_SPACING_PX / 2);
  return 2 * Math.min(TICKS_MAX / 2, Math.max(8, fit));
}

function drawGauge(scene) {
  const { c, layout, hud, ink, alpha } = scene;
  const { centerX: x, centerY: y, radius } = layout;
  const ring = radius * GAUGE_RADIUS;
  const width = Math.max(1.5, radius * GAUGE_WIDTH);
  const available = Math.round(GAUGE_SEGMENTS * stage(hud.boot, 0.3, 0.4));
  const lit = Math.min(available, Math.round(hud.gauge * GAUGE_SEGMENTS));
  const peak = Math.min(available, Math.round(hud.gaugePeak * GAUGE_SEGMENTS)) - 1;

  c.beginPath();
  gaugeSegments(c, layout, ring, lit, available);
  strokeFaint(scene, alpha * ink.dim, width);
  if (lit > 0) {
    // Lit segments heat from the line color at the start to the hot color at the top of the scale.
    const heat = c.createConicGradient(GAUGE_START, x, y);
    heat.addColorStop(0, rgba(ink.line, alpha * 0.75));
    heat.addColorStop(GAUGE_SWEEP / TAU, rgba(ink.hot, alpha));
    c.beginPath();
    gaugeSegments(c, layout, ring, 0, lit);
    strokeGlowing(scene, heat, alpha, width);
  }
  if (peak >= lit) {
    c.beginPath();
    gaugeSegments(c, layout, ring, peak, peak + 1);
    strokeGlowing(scene, rgba(ink.hot, alpha), alpha, width);
  }
}

function gaugeSegments(c, layout, ring, from, to) {
  const step = GAUGE_SWEEP / GAUGE_SEGMENTS;
  for (let k = from; k < to; k++) {
    const start = GAUGE_START + k * step;
    c.moveTo(layout.centerX + Math.cos(start) * ring, layout.centerY + Math.sin(start) * ring);
    c.arc(layout.centerX, layout.centerY, ring, start, start + step * GAUGE_FILL);
  }
}

function drawBassChevrons(scene) {
  const { c, layout, frame, ink, alpha } = scene;
  const { centerX: x, centerY: y, radius } = layout;
  const halfWidth = radius * CHEVRON_HALF_WIDTH;
  const depth = radius * CHEVRON_DEPTH;
  const width = layout.lineWidth * 1.2;

  for (const lit of [false, true]) {
    c.beginPath();
    for (const [k, step] of CHEVRON_STEPS.entries()) {
      if ((frame.bass > step) !== lit) continue;
      const top = y + radius * (CHEVRON_FIRST + k * CHEVRON_PITCH);
      c.moveTo(x - halfWidth, top);
      c.lineTo(x, top + depth);
      c.lineTo(x + halfWidth, top);
    }
    if (lit) strokeGlowing(scene, rgba(ink.hot, alpha), alpha, width);
    else strokeFaint(scene, alpha * ink.dim * 1.5, width);
  }
}

// Each beat sends a ring out from the core to the bezel.
function drawPings(scene) {
  const { c, layout, hud, ink, alpha } = scene;
  const { centerX: x, centerY: y, radius } = layout;
  for (const age of hud.pings) {
    const t = age / PING_SECONDS;
    const strength = alpha * 0.8 * (1 - t) ** 2;
    c.beginPath();
    circlePath(c, x, y, radius * (CORE_RING + (PING_REACH - CORE_RING) * easeOut(t)));
    strokeGlowing(scene, rgba(ink.line, strength), strength, layout.lineWidth * (1 + 1.5 * (1 - t)));
  }
}

// Contacts share a few brightness steps, so each step is one batched fill.
function drawContacts(scene) {
  const { c, layout, hud, ink, alpha } = scene;
  const radar = radarRadius(layout, hud);
  const dot = Math.max(CONTACT_MIN_PX, layout.radius * CONTACT_DOT);
  const buckets = Array.from({ length: CONTACT_BUCKETS }, () => []);
  for (const contact of hud.contacts) {
    const bucket = Math.round(contact.glow * CONTACT_BUCKETS);
    if (bucket > 0) buckets[bucket - 1].push(contactPoint(contact));
  }

  for (const [index, points] of buckets.entries()) {
    if (points.length === 0) continue;
    const strength = (alpha * (index + 1)) / CONTACT_BUCKETS;
    c.beginPath();
    dotsPath(c, layout, radar, points, dot * 2.4);
    c.fillStyle = rgba(ink.glow, strength * ink.glowAlpha * 1.5);
    c.fill();
    c.beginPath();
    dotsPath(c, layout, radar, points, dot);
    c.fillStyle = rgba(ink.hot, strength);
    c.fill();
  }
}

function dotsPath(c, layout, radar, points, size) {
  for (const point of points) circlePath(c, layout.centerX + point.x * radar, layout.centerY + point.y * radar, size);
}

// A small bracket spins in and snaps onto the strongest contact on each beat, joined to the core by a dashed line.
function drawLock(scene) {
  const { c, layout, frame, hud, ink, alpha } = scene;
  const lock = hud.lock;
  if (lock === null) return;
  const radar = radarRadius(layout, hud);
  const acquire = frame.reducedMotion ? 1 : easeOut(Math.min(1, lock.age / LOCK_ACQUIRE_SECONDS));
  const strength = alpha * (1 - stage(lock.age, LOCK_HOLD_SECONDS, LOCK_FADE_SECONDS));
  const size = Math.max(LOCK_MIN_PX, layout.radius * LOCK_SIZE) * (1 + LOCK_ZOOM * (1 - acquire));
  const arm = size * 0.55;
  const turn = (Math.PI / 4) * (1 - acquire);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const lockX = layout.centerX + lock.x * radar;
  const lockY = layout.centerY + lock.y * radar;
  const distance = Math.hypot(lock.x, lock.y) * radar;
  const coreEdge = layout.radius * CORE_RING;

  if (distance > coreEdge + size) {
    const unitX = (lock.x * radar) / distance;
    const unitY = (lock.y * radar) / distance;
    c.beginPath();
    c.moveTo(layout.centerX + unitX * coreEdge, layout.centerY + unitY * coreEdge);
    c.lineTo(lockX - unitX * size, lockY - unitY * size);
    c.setLineDash([2, 3]);
    strokeFaint(scene, strength * 0.5, layout.lineWidth * 0.8);
    c.setLineDash([]);
  }

  c.beginPath();
  for (const [sx, sy] of CORNERS) {
    const corner = [[sx * size, sy * (size - arm)], [sx * size, sy * size], [sx * (size - arm), sy * size]];
    for (const [k, [u, v]] of corner.entries()) {
      const px = lockX + u * cos - v * sin;
      const py = lockY + u * sin + v * cos;
      if (k === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
  }
  strokeGlowing(scene, rgba(ink.hot, strength), strength, layout.lineWidth * 1.2);
}

function drawCore(scene) {
  const { c, layout, frame, ink, alpha } = scene;
  const { centerX: x, centerY: y, radius } = layout;
  c.beginPath();
  circlePath(c, x, y, radius * CORE_RING);
  strokeGlowing(scene, rgba(ink.line, alpha * 0.7), alpha * 0.7, layout.lineWidth);
  c.beginPath();
  circlePath(c, x, y, radius * (CORE_PIP + CORE_PIP_BASS * frame.bass));
  c.fillStyle = rgba(ink.hot, alpha * (0.35 + 0.65 * frame.bass));
  c.fill();
}

// The corner brackets snap inward and flash hot on each beat, then ease back out.
function drawBrackets(scene) {
  const { c, layout, hud, ink, alpha } = scene;
  const { centerX: x, centerY: y, radius } = layout;
  const arm = radius * BRACKET_ARM * stage(hud.boot, 0.35, 0.4);
  const halfWidth = radius * (BRACKET_SPREAD - BRACKET_SNAP_X * hud.bracketSnap);
  const halfHeight = radius * (1 - BRACKET_SNAP_Y * hud.bracketSnap);
  const strength = alpha * (0.65 + 0.35 * hud.flash);
  if (arm < 0.5) return;

  c.beginPath();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cornerX = x + sx * halfWidth;
      const cornerY = y + sy * halfHeight;
      c.moveTo(cornerX - sx * arm, cornerY);
      c.lineTo(cornerX, cornerY);
      c.lineTo(cornerX, cornerY - sy * arm);
    }
    c.moveTo(x + sx * halfWidth, y);
    c.lineTo(x + sx * (halfWidth - radius * BRACKET_TICK), y);
  }
  strokeGlowing(scene, rgba(mix(ink.line, ink.hot, hud.flash), strength), strength, layout.lineWidth * 1.5);
}

function drawWing(scene, side) {
  const wing = wingGeometry(scene.layout, side);
  drawWingRules(scene, wing);
  drawDataBars(scene, wing);
  drawTrace(scene, wing);
  drawWingPips(scene, wing);
  drawPackets(scene, wing);
}

// Distances run outward from the wing's inner edge beside the brackets, so one geometry serves both sides.
function wingGeometry(layout, side) {
  const { radius, wingWidth, wingStart, centerX, centerY } = layout;
  const top = centerY - radius * WING_HEIGHT;
  const bottom = centerY + radius * WING_HEIGHT;
  const rowTop = top + radius * WING_INSET;
  const rowBottom = bottom - radius * WING_INSET;
  const gap = radius * WING_SPLIT_GAP;
  const base = { side, width: wingWidth, top, bottom, xAt: (distance) => centerX + side * (wingStart + distance) };
  if (wingWidth >= TRACE_BESIDE_WIDTH) {
    const barsEnd = wingWidth * BAR_SHARE;
    return {
      ...base,
      bars: { from: 0, to: barsEnd, top: rowTop, bottom: rowBottom },
      trace: { from: barsEnd + gap, to: wingWidth, top: rowTop, bottom: rowBottom },
    };
  }
  if (rowBottom - rowTop >= TRACE_BELOW_HEIGHT) {
    const barsBottom = rowTop + (rowBottom - rowTop) * BAR_SHARE_STACKED;
    return {
      ...base,
      bars: { from: 0, to: wingWidth, top: rowTop, bottom: barsBottom },
      trace: { from: 0, to: wingWidth, top: barsBottom + gap, bottom: rowBottom },
    };
  }
  return { ...base, bars: { from: 0, to: wingWidth, top: rowTop, bottom: rowBottom }, trace: null };
}

function drawWingRules(scene, wing) {
  const { c, layout, hud, alpha } = scene;
  const length = wing.width * stage(hud.boot, 0.45, 0.35);
  const bend = layout.radius * WING_BEND;
  if (length < 1) return;

  c.beginPath();
  for (const [y, inward] of [[wing.top, 1], [wing.bottom, -1]]) {
    c.moveTo(wing.xAt(0), y + inward * bend);
    c.lineTo(wing.xAt(Math.min(bend, length)), y);
    c.lineTo(wing.xAt(length), y);
    c.lineTo(wing.xAt(length), y + inward * bend * 0.7);
  }
  strokeFaint(scene, alpha * 0.45, layout.lineWidth);
}

// Bass sits on the bottom row, so both wings read upward from low to high, and bars grow away from the reticle.
function drawDataBars(scene, wing) {
  const { c, frame, hud, ink, alpha } = scene;
  const box = wing.bars;
  const pitch = (box.bottom - box.top) / WING_ROWS;
  const thickness = clamp(pitch * 0.48, 1.5, 5);
  const step = clamp(thickness * 1.2, 3, 6);
  const block = { step, width: step * 0.68, thickness };
  const available = Math.round(Math.floor((box.to - box.from) / step) * stage(hud.boot, 0.5, 0.4));
  const firstBand = wing.side < 0 ? 0 : WING_ROWS;
  const rows = Array.from({ length: WING_ROWS }, (_, row) => {
    const band = firstBand + WING_ROWS - 1 - row;
    return {
      y: box.top + pitch * (row + 0.5) - thickness / 2,
      lit: Math.round(frame.values[band] * available),
      peak: Math.round(frame.peaks[band] * available) - 1,
    };
  });
  const heat = c.createLinearGradient(wing.xAt(box.from), 0, wing.xAt(box.to), 0);
  heat.addColorStop(0, rgba(ink.line, alpha * 0.7));
  heat.addColorStop(1, rgba(ink.hot, alpha));

  c.beginPath();
  for (const row of rows) addBlocks(c, wing, box, row.y, block, row.lit, available, 0);
  c.fillStyle = rgba(ink.line, alpha * ink.dim * 0.8);
  c.fill();
  c.beginPath();
  for (const row of rows) addBlocks(c, wing, box, row.y, block, 0, row.lit, Math.min(2, thickness * 0.45));
  c.fillStyle = rgba(ink.glow, alpha * ink.glowAlpha);
  c.fill();
  c.beginPath();
  for (const row of rows) addBlocks(c, wing, box, row.y, block, 0, row.lit, 0);
  c.fillStyle = heat;
  c.fill();
  c.beginPath();
  for (const row of rows) if (row.peak >= row.lit) addBlocks(c, wing, box, row.y, block, row.peak, row.peak + 1, 0);
  c.fillStyle = rgba(ink.hot, alpha * 0.9);
  c.fill();
}

function addBlocks(c, wing, box, y, block, from, to, grow) {
  for (let s = from; s < to; s++) {
    const near = wing.xAt(box.from + s * block.step);
    const far = wing.xAt(box.from + s * block.step + block.width);
    c.rect(Math.min(near, far) - grow, y - grow, block.width + 2 * grow, block.thickness + 2 * grow);
  }
}

// Telemetry scrolls away from the reticle: bass history on the left wing, treble on the right.
function drawTrace(scene, wing) {
  const { c, frame, hud, layout, ink, alpha } = scene;
  const box = wing.trace;
  if (box === null) return;
  const length = (box.to - box.from) * stage(hud.boot, 0.6, 0.4);
  if (length < 2) return;
  const series = traceSeries(frame, hud, wing.side);
  const span = box.bottom - box.top;
  const last = series.length - 1;
  const xOf = (j) => wing.xAt(box.from + (j / last) * length);
  const yOf = (j) => box.bottom - series[j] * span;
  const fill = c.createLinearGradient(0, box.top, 0, box.bottom);
  fill.addColorStop(0, rgba(ink.line, alpha * 0.3));
  fill.addColorStop(1, rgba(ink.line, alpha * 0.02));

  c.beginPath();
  for (let g = 0; g < TRACE_GRID_LINES; g++) {
    const y = box.top + (span * g) / (TRACE_GRID_LINES - 1);
    c.moveTo(xOf(0), y);
    c.lineTo(xOf(last), y);
  }
  for (let j = 0; j <= last; j++) {
    if ((hud.history.total - j) % TRACE_TICK_EVERY !== 0) continue;
    c.moveTo(xOf(j), box.bottom);
    c.lineTo(xOf(j), box.bottom - layout.radius * TRACE_TICK);
  }
  strokeFaint(scene, alpha * ink.dim, layout.lineWidth * 0.8);

  c.beginPath();
  c.moveTo(xOf(0), box.bottom);
  for (let j = 0; j <= last; j++) c.lineTo(xOf(j), yOf(j));
  c.lineTo(xOf(last), box.bottom);
  c.closePath();
  c.fillStyle = fill;
  c.fill();

  c.beginPath();
  c.moveTo(xOf(0), yOf(0));
  for (let j = 1; j <= last; j++) c.lineTo(xOf(j), yOf(j));
  strokeGlowing(scene, rgba(ink.line, alpha * 0.95), alpha, layout.lineWidth);

  c.beginPath();
  circlePath(c, xOf(0), yOf(0), Math.max(1.2, layout.radius * 0.025));
  c.fillStyle = rgba(ink.hot, alpha);
  c.fill();
}

// Newest first. Under reduced motion the history stands still, so the trace shows that wing's half of the spectrum.
function traceSeries(frame, hud, side) {
  if (frame.reducedMotion) {
    const half = side < 0 ? frame.values.slice(0, BANDS / 2) : frame.values.slice(BANDS / 2);
    return resample(half, TRACE_SAMPLES);
  }
  const { history } = hud;
  const source = side < 0 ? history.bass : history.treble;
  const series = new Float32Array(TRACE_SAMPLES);
  for (let j = 0; j < TRACE_SAMPLES; j++) series[j] = source[(history.head - 1 - j + TRACE_SAMPLES) % TRACE_SAMPLES];
  return series;
}

// The left wing counts beats in fours, and the right wing shows a signal ladder from the energy gauge.
function drawWingPips(scene, wing) {
  const { c, layout, hud, ink, alpha } = scene;
  const reveal = stage(hud.boot, 0.7, 0.3);
  const size = clamp(layout.radius * PIP_SIZE, 2, 5);
  const step = size * 1.7;
  const counter = wing.side < 0;
  const count = counter ? BEAT_PIPS : SIGNAL_PIPS;
  const counted = hud.beats === 0 ? 0 : ((hud.beats - 1) % BEAT_PIPS) + 1;
  const bottom = wing.top - layout.radius * PIP_LIFT;
  if (reveal <= 0) return;

  for (const lit of [false, true]) {
    c.beginPath();
    for (let k = 0; k < count; k++) {
      const on = counter ? k < counted : hud.gauge > (k + 0.5) / count;
      if (on !== lit) continue;
      const height = counter ? size : size * (0.4 + (0.6 * k) / (count - 1));
      const near = wing.xAt(wing.width - (count - k) * step);
      const far = wing.xAt(wing.width - (count - k) * step + size);
      c.rect(Math.min(near, far), bottom - height, size, height);
    }
    c.fillStyle = lit ? rgba(ink.hot, alpha * reveal * 0.95) : rgba(ink.line, alpha * reveal * ink.dim * 1.5);
    c.fill();
  }
}

// Each beat fires a data packet along the bottom rule, out from the reticle.
function drawPackets(scene, wing) {
  const { c, layout, hud, ink, alpha } = scene;
  const length = layout.radius * PACKET_LENGTH;
  if (hud.packets.length === 0) return;

  c.beginPath();
  for (const age of hud.packets) {
    const travel = (age / PACKET_SECONDS) * (wing.width + length);
    const head = Math.min(wing.width, travel);
    const tail = Math.max(0, travel - length);
    if (head - tail < 0.5) continue;
    c.moveTo(wing.xAt(tail), wing.bottom);
    c.lineTo(wing.xAt(head), wing.bottom);
  }
  strokeGlowing(scene, rgba(ink.hot, alpha), alpha, layout.lineWidth * 1.8);
}

// Scanlines, beat tears and a rolling scan band act only on what is already drawn, so they never add pixels.
function applyHologram(scene) {
  const { c, frame, hud, ink } = scene;
  const area = { left: frame.pad, top: frame.pad, width: frame.width - 2 * frame.pad, height: frame.height - 2 * frame.pad };
  const offset = (hud.time * SCANLINE_DRIFT) % SCANLINE_PITCH;

  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = rgba(ERASE_INK, ink.scanlineAlpha);
  c.beginPath();
  for (let y = area.top + offset; y < area.top + area.height; y += SCANLINE_PITCH) c.rect(area.left, y, area.width, SCANLINE_WIDTH);
  c.fill();
  if (frame.reducedMotion) return;

  if (hud.glitch > 0.05) {
    c.fillStyle = rgba(ERASE_INK, hud.glitch * 0.7);
    c.beginPath();
    for (let k = 1; k <= GLITCH_TEARS; k++) {
      c.rect(area.left, area.top + area.height * hash(hud.beats * 7.13 + k * 1.37), area.width, 1 + 2 * hash(hud.beats + k * 3.1));
    }
    c.fill();
  }

  const bandHeight = area.height * SCAN_BAND_HEIGHT;
  const bandTop = area.top - bandHeight + ((hud.time / SCAN_BAND_SECONDS) % 1) * (area.height + bandHeight);
  const band = c.createLinearGradient(0, bandTop, 0, bandTop + bandHeight);
  band.addColorStop(0, rgba(ink.hot, 0));
  band.addColorStop(0.5, rgba(ink.hot, ink.scanBandAlpha));
  band.addColorStop(1, rgba(ink.hot, 0));
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = band;
  c.fillRect(area.left, bandTop, area.width, bandHeight);
}

function strokeGlowing(scene, style, alpha, width) {
  const { c, ink } = scene;
  c.lineWidth = width + 2 * GLOW_PX;
  c.strokeStyle = rgba(ink.glow, alpha * ink.glowAlpha);
  c.stroke();
  c.lineWidth = width;
  c.strokeStyle = style;
  c.stroke();
}

function strokeFaint(scene, alpha, width) {
  scene.c.lineWidth = width;
  scene.c.strokeStyle = rgba(scene.ink.line, alpha);
  scene.c.stroke();
}

function radarRadius(layout, hud) {
  return layout.radius * RADAR_RADIUS * stage(hud.boot, 0.1, 0.4);
}

function radialSegment(c, layout, angle, from, to) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  c.moveTo(layout.centerX + cos * from, layout.centerY + sin * from);
  c.lineTo(layout.centerX + cos * to, layout.centerY + sin * to);
}

// A small triangle on the bezel pointing in at the given bearing.
function notchPath(c, layout, angle) {
  const { centerX: x, centerY: y, radius } = layout;
  const tip = radius * NOTCH_TIP;
  const base = radius * BEZEL_RADIUS;
  const spread = NOTCH_HALF_WIDTH / BEZEL_RADIUS;
  c.moveTo(x + Math.cos(angle) * tip, y + Math.sin(angle) * tip);
  c.lineTo(x + Math.cos(angle - spread) * base, y + Math.sin(angle - spread) * base);
  c.lineTo(x + Math.cos(angle + spread) * base, y + Math.sin(angle + spread) * base);
  c.closePath();
}

function circlePath(c, x, y, radius) {
  c.moveTo(x + radius, y);
  c.arc(x, y, radius, 0, TAU);
}

// A smoothstep from start to start + span, so each part of the boot eases in on its own cue.
function stage(value, start, span) {
  const t = clamp((value - start) / span);
  return t * t * (3 - 2 * t);
}

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function mix(from, to, t) {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

// A repeatable pseudo-random fraction, so each beat tears the image in the same places on every frame of its fade.
function hash(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export default { label: 'Hologram HUD', draw };
