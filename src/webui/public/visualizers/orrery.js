import { average, detectBeat, rgba } from '../visualizer-kit.js';

const TAU = Math.PI * 2;
// Kept clear inside the pad as well, so antialiased edges never reach the faded border.
const SAFETY_PX = 1;
// Below this the area is too small to hold the orrery.
const MIN_ORBIT_PX = 2;

// Inner planets ride the treble and outer ones the bass, so the spectrum reads outward from the sun.
// Orbits are fractions of the dial's radius and sizes are fractions of the planet unit.
const PLANETS = [
  { orbit: 0.25, size: 0.36, hue: 228, saturation: 24 },
  { orbit: 0.335, size: 0.48, hue: 44, saturation: 88 },
  { orbit: 0.42, size: 0.52, hue: 200, saturation: 86 },
  { orbit: 0.505, size: 0.44, hue: 10, saturation: 80 },
  { orbit: 0.59, size: 0.56, hue: 162, saturation: 62 },
  { orbit: 0.675, size: 0.74, hue: 40, saturation: 68, ring: true },
  { orbit: 0.77, size: 1, hue: 22, saturation: 84, moon: true },
  { orbit: 0.875, size: 0.7, hue: 226, saturation: 78 },
];
const BANDS_PER_PLANET = 2;
const MOON_HOST = PLANETS.findIndex((planet) => planet.moon === true);
// The golden angle spreads the planets at the start, so no two line up.
const GOLDEN_ANGLE = 2.39996;

// The orrery is seen from above at a tilt, the ratio of each orbit's height to its width. The phone strip
// gets a low tilt and a square area a steep one.
const MIN_TILT = 0.12;
const MAX_TILT = 0.6;
// The planet unit as a fraction of the shorter side, so planets keep their size relative to the area. The
// width cap keeps planets in scale with the orbits when a square or tall area narrows them.
const PLANET_SCALE = 0.045;
const PLANET_WIDTH_SCALE = 0.021;
const BODY_BASE = 0.7;
const BODY_GAIN = 0.5;
const MIN_BODY_PX = 1;
// Near planets draw larger than far ones, which sells the tilt.
const DEPTH_SCALE = 0.15;
// Reaches from a planet's center, in body radii. The trail glow stays inside the halo's reach.
const HALO_RATIO = 1.9;
const RING_RATIO = 2.05;
const RING_WIDTH_RATIO = 0.3;
const MOON_ORBIT_RATIO = 2.4;
const MOON_SIZE_RATIO = 0.28;
const TRAIL_GLOW_RATIO = 1.3;
const TRAIL_CORE_RATIO = 0.5;
// The ring leans out of the orbital plane, the way Saturn's does.
const RING_ROLL = -0.35;
const RING_STEPS = 14;
const RING_ALPHA = 0.85;
// The highlight sits this far toward the sun, in body radii, so each planet shows a phase.
const LIGHT_OFFSET = 0.45;
const MIN_MOON_PX = 0.4;

// Angular speed in radians per second at the dial. Kepler's law has an exponent of 1.5, softened here so the
// inner planets stay easy to follow.
const ORBIT_RATE = 0.32;
const KEPLER_EXPONENT = 1.25;
const SPEED_FLOOR = 0.35;
const SPEED_GAIN = 1.4;
const MOON_RATE = 2.2;
// A beat jolts the whole clockwork forward, then the jolt decays.
const LURCH_GAIN = 1;
const KICK_DECAY_PER_SECOND = 5;
// A quiet band pulls its orbit in by up to this fraction, well under the gap between orbits so rings never cross.
const ORBIT_SHRINK = 0.04;

// A trail covers the arc its planet swept in this time, so faster planets draw longer streaks.
const TRAIL_SECONDS = 1.1;
const TRAIL_MAX_RAD = 2.6;
const MIN_TRAIL_RAD = 0.02;
const TRAIL_PIECES = 10;
const TRAIL_FADE_POWER = 1.6;
const TRAIL_TAPER = 0.65;
const TRAIL_BASE = 0.25;
const TRAIL_GAIN = 0.7;
// Ellipses are traced as lines, so their bounds stay exact. This chord keeps them round on the widest area.
const ARC_CHORD_PX = 9;
const MAX_ARC_STEPS = 72;

// The sun's radius in planet units.
const SUN_RATIO = 1.33;
const SUN_CORE_BASE = 0.85;
const SUN_CORE_BASS = 0.3;
const SUN_GLOW_BASE = 2.4;
const SUN_GLOW_BASS = 1;
const SUN_GLOW_KICK = 1.2;
// The corona's widest reach in sun radii, which sizes the sun so the corona stays inside the area.
const SUN_GLOW_REACH = SUN_GLOW_BASE + SUN_GLOW_BASS + SUN_GLOW_KICK;
// Arms start just outside the sun's disc, so they read as passing beneath it.
const ARM_CLEARANCE = 1.15;
const ARM_WIDTH_RATIO = 0.09;
const MIN_ARM_PX = 0.6;

const ORBIT_LINE_PX = 0.8;
const ORBIT_BASE = 0.05;
const ORBIT_GAIN = 0.3;
const DIAL_LINE_PX = 1;
const DIAL_TICKS = 36;
const DIAL_TICK = 0.045;
const DIAL_TICK_LONG = 0.085;
const DIAL_BASE = 0.1;
const DIAL_GAIN = 0.25;
const HALO_BASE = 0.25;
const HALO_GAIN = 0.6;

const FLARE_SECONDS = 1.1;
const FLARE_MAX = 3;
const FLARE_START = 0.12;
const FLARE_WIDTH_RATIO = 0.3;
// A flare lights each planet it crosses, within this distance in fractions of the dial's radius.
const FLARE_HIT_WIDTH = 0.06;
const FLASH_LIGHTNESS = 14;

const COMET_MAX = 3;
// Comets wait this long between launches, so each one reads as an event rather than noise.
const COMET_GAP_S = 1.4;
// Gravity in dial radii cubed per second squared, set so a pass through the system takes about two seconds.
const COMET_GM = 0.45;
const COMET_PERIHELION_MIN = 0.12;
const COMET_PERIHELION_MAX = 0.3;
// The aphelion lies past the dial, so every comet enters at the rim and leaves at the rim.
const COMET_APHELION_MIN = 1.4;
const COMET_APHELION_MAX = 2.6;
const COMET_TAIL_POINTS = 10;
const COMET_TAIL_SECONDS = 0.4;
const COMET_TAIL_PIECES = 3;
const COMET_ION_LENGTH = 0.45;
const COMET_ION_WIDTH_RATIO = 0.4;
const COMET_DUST_WIDTH_RATIO = 0.35;
const COMET_GLOW_RATIO = 0.9;
const COMET_CORE_RATIO = 0.22;
const MIN_COMET_CORE_PX = 0.8;
// A comet fades over this last stretch before the dial, so it never pops in or out.
const COMET_EDGE_FADE = 0.18;
// Each midpoint step turns at most this far, which stays accurate where the comet whips round the sun.
const MAX_STEP_RAD = 0.06;
const MAX_SUBSTEPS = 64;

const STAR_MAX = 48;
const STAR_MIN = 10;
// One star per this many square pixels, capped, so the wide area stays as light as the default one.
const STAR_AREA_PX = 2400;
const STAR_SHADES = 3;
const STAR_MIN_PX = 0.5;
const STAR_SPAN_PX = 0.7;
// Stars twinkle with the bands from this one up.
const STAR_FIRST_BAND = 9;

// The fraction of the orrery's brightness left one second after the music stops.
const RETAIN_PER_SECOND = 0.08;
const PRESENCE_GAIN = 4;
const MIN_GLOW = 0.01;
// An alpha under this rounds to nothing in an 8-bit channel.
const MIN_ALPHA = 0.003;
// A fixed seed, so every page load starts the same sky.
const SEED = 0x2545f491;

// Additive glow shines on the dark card but washes out on white, so the light theme paints deeper colors over.
const LOOKS = {
  dark: {
    glowOp: 'lighter',
    brass: { r: 222, g: 184, b: 112 },
    flare: { r: 255, g: 206, b: 122 },
    sunHot: { r: 255, g: 251, b: 236 },
    sunEdge: { r: 255, g: 190, b: 84 },
    sunGlow: { r: 255, g: 146, b: 48 },
    dust: { r: 255, g: 226, b: 188 },
    star: { r: 214, g: 226, b: 255 },
    moon: { r: 206, g: 212, b: 226 },
    litLight: 72,
    shadeLight: 22,
    trailLight: 64,
    haloLight: 60,
    ringLight: 76,
    dialAlpha: 1,
    orbitAlpha: 1,
    armAlpha: 0.26,
    flareAlpha: 0.6,
    sunGlowAlpha: 0.6,
    haloAlpha: 0.3,
    trailGlowAlpha: 0.2,
    trailCoreAlpha: 0.9,
    starAlpha: 0.7,
    dustAlpha: 0.55,
    ionAlpha: 0.7,
    cometGlowAlpha: 0.7,
  },
  light: {
    glowOp: 'source-over',
    brass: { r: 146, g: 100, b: 36 },
    flare: { r: 206, g: 124, b: 26 },
    sunHot: { r: 255, g: 210, b: 92 },
    sunEdge: { r: 220, g: 108, b: 16 },
    sunGlow: { r: 245, g: 150, b: 40 },
    dust: { r: 170, g: 104, b: 34 },
    star: { r: 64, g: 74, b: 140 },
    moon: { r: 112, g: 118, b: 134 },
    litLight: 56,
    shadeLight: 24,
    trailLight: 42,
    haloLight: 50,
    ringLight: 40,
    dialAlpha: 1.3,
    orbitAlpha: 1.3,
    armAlpha: 0.34,
    flareAlpha: 0.55,
    sunGlowAlpha: 0.36,
    haloAlpha: 0.14,
    trailGlowAlpha: 0.12,
    trailCoreAlpha: 0.85,
    starAlpha: 0.4,
    dustAlpha: 0.5,
    ionAlpha: 0.6,
    cometGlowAlpha: 0.45,
  },
};

// The far half of the orbital plane draws before the sun and the near half after it.
const BACK = { from: Math.PI, to: TAU, holds: (depth) => depth < 0 };
const FRONT = { from: 0, to: Math.PI, holds: (depth) => depth >= 0 };

/** A tilted brass orrery whose planets orbit at the speed and radius of their bands, with comets on beats. */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  state.glow = Math.max((state.glow ?? 0) * RETAIN_PER_SECOND ** frame.dtSeconds, presence);
  const view = layout(frame);
  if (state.glow < MIN_GLOW || view === null) {
    forgetTransients(state);
    return;
  }

  const levels = planetLevels(frame.values);
  advance(state, frame, levels, beat);
  paintScene(ctx, frame, view, composeScene(state, frame, view, levels));
  // The orrery dims with the glow after the music stops, so the host keeps drawing until it is gone.
  return true;
}

// The largest orbit ellipse that keeps every planet, halo, ring, moon, flare and comet inside the pad.
function layout(frame) {
  const { width, height, pad } = frame;
  const unit = Math.min(Math.min(width, height) * PLANET_SCALE, width * PLANET_WIDTH_SCALE);
  const halfX = width / 2 - pad - SAFETY_PX;
  const halfY = height / 2 - pad - SAFETY_PX;
  const rim = rimReach(unit);
  let radiusX = halfX - rim;
  let radiusY = halfY - rim;
  for (const planet of PLANETS) {
    const body = maxBodyRadius(unit, planet);
    radiusX = Math.min(radiusX, (halfX - body * reachAcross(planet)) / planet.orbit);
    radiusY = Math.min(radiusY, (halfY - body * reachUpDown(planet)) / planet.orbit);
  }
  radiusY = Math.min(radiusY, radiusX * MAX_TILT);
  radiusX = Math.min(radiusX, radiusY / MIN_TILT);
  if (!(radiusY > MIN_ORBIT_PX)) return null;

  return {
    centerX: width / 2,
    centerY: height / 2,
    radiusX,
    radiusY,
    tilt: radiusY / radiusX,
    unit,
    sunRadius: Math.min(unit * SUN_RATIO, Math.min(halfX, halfY) / SUN_GLOW_REACH),
    left: pad + SAFETY_PX,
    right: width - pad - SAFETY_PX,
    top: pad + SAFETY_PX,
    bottom: height - pad - SAFETY_PX,
  };
}

function maxBodyRadius(unit, planet) {
  return Math.max(MIN_BODY_PX, unit * planet.size * (BODY_BASE + BODY_GAIN)) * (1 + DEPTH_SCALE);
}

// The ring is rolled, so it takes its full reach both ways. The moon's orbit is flattened by the tilt.
function reachAcross(planet) {
  const ring = planet.ring ? RING_RATIO + RING_WIDTH_RATIO / 2 : 0;
  const moon = planet.moon ? MOON_ORBIT_RATIO + MOON_SIZE_RATIO : 0;
  return Math.max(HALO_RATIO, ring, moon);
}

function reachUpDown(planet) {
  const ring = planet.ring ? RING_RATIO + RING_WIDTH_RATIO / 2 : 0;
  const moon = planet.moon ? MOON_ORBIT_RATIO * MAX_TILT + MOON_SIZE_RATIO : 0;
  return Math.max(HALO_RATIO, ring, moon);
}

// What reaches past the dial's ellipse: the dial line, a flare at the rim, and a comet's head glow.
function rimReach(unit) {
  return Math.max(DIAL_LINE_PX / 2, (unit * FLARE_WIDTH_RATIO) / 2, unit * COMET_GLOW_RATIO);
}

// Each planet hears two adjacent bands, the innermost the highest pair.
function planetLevels(values) {
  return PLANETS.map((_, i) => average(values, values.length - BANDS_PER_PLANET * (i + 1), values.length - BANDS_PER_PLANET * i));
}

function advance(state, frame, levels, beat) {
  const still = frame.reducedMotion;
  const dt = still ? 0 : frame.dtSeconds;
  state.kick = still ? 0 : (beat ? 1 : (state.kick ?? 0)) * Math.exp(-KICK_DECAY_PER_SECOND * frame.dtSeconds);
  const lurch = 1 + LURCH_GAIN * state.kick;
  const angles = state.angles ?? PLANETS.map((_, i) => i * GOLDEN_ANGLE);
  state.rates = PLANETS.map((planet, i) => (still ? 0 : ORBIT_RATE * planet.orbit ** -KEPLER_EXPONENT * (SPEED_FLOOR + SPEED_GAIN * levels[i]) * lurch));
  state.angles = angles.map((angle, i) => (angle + state.rates[i] * dt) % TAU);
  state.moonAngle = ((state.moonAngle ?? 0) + MOON_RATE * (SPEED_FLOOR + SPEED_GAIN * levels[MOON_HOST]) * lurch * dt) % TAU;
  state.twinkle = (state.twinkle ?? 0) + dt;
  advanceComets(state, beat && !still, dt);
  advanceFlares(state, beat && !still, dt);
  if (still) forgetTransients(state);
}

// Comets and flares are motion of their own, so they go when the music fades or motion is reduced.
function forgetTransients(state) {
  state.comets = [];
  state.flares = [];
}

function advanceComets(state, launch, dt) {
  const comets = state.comets ?? [];
  state.cometWait = Math.max(0, (state.cometWait ?? 0) - dt);
  for (const comet of comets) comet.anomaly = stepAnomaly(comet, comet.anomaly, dt);
  state.comets = comets.filter((comet) => comet.anomaly < comet.exitAnomaly);
  if (!launch || state.cometWait > 0 || state.comets.length >= COMET_MAX) return;
  state.comets.push(newComet(state));
  state.cometWait = COMET_GAP_S;
}

function advanceFlares(state, launch, dt) {
  const ages = (state.flares ?? []).map((age) => age + dt).filter((age) => age < FLARE_SECONDS);
  if (launch) ages.push(0);
  state.flares = ages.slice(-FLARE_MAX);
}

// A Kepler ellipse with the sun at one focus, in dial radii. It enters at the rim, whips round the sun and leaves.
function newComet(state) {
  const perihelion = between(state, COMET_PERIHELION_MIN, COMET_PERIHELION_MAX);
  const aphelion = between(state, COMET_APHELION_MIN, COMET_APHELION_MAX);
  const eccentricity = (aphelion - perihelion) / (aphelion + perihelion);
  const latus = (2 * perihelion * aphelion) / (aphelion + perihelion);
  const exitAnomaly = Math.acos(Math.max(-1, Math.min(1, (latus - 1) / eccentricity)));
  return {
    eccentricity,
    latus,
    exitAnomaly,
    momentum: Math.sqrt(COMET_GM * latus),
    heading: between(state, 0, TAU),
    turn: random(state) < 0.5 ? -1 : 1,
    anomaly: -exitAnomaly,
  };
}

// Kepler's second law: the angle swept per second grows with the inverse square of the distance.
function anomalyRate(comet, anomaly) {
  const lift = 1 + comet.eccentricity * Math.cos(anomaly);
  return (comet.momentum * lift * lift) / (comet.latus * comet.latus);
}

function stepAnomaly(comet, anomaly, seconds) {
  const fastest = anomalyRate(comet, 0);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((fastest * Math.abs(seconds)) / MAX_STEP_RAD)));
  const step = seconds / steps;
  let value = anomaly;
  for (let k = 0; k < steps; k++) {
    const middle = value + 0.5 * step * anomalyRate(comet, value);
    value += step * anomalyRate(comet, middle);
  }
  return value;
}

function cometPoint(comet, anomaly) {
  const radius = comet.latus / (1 + comet.eccentricity * Math.cos(anomaly));
  const angle = comet.heading + comet.turn * anomaly;
  return { radius, angle, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

// The dust tail is the path the comet just flew, so it stretches where the comet is fastest.
function cometTail(comet) {
  const points = [];
  const step = -COMET_TAIL_SECONDS / (COMET_TAIL_POINTS - 1);
  let anomaly = comet.anomaly;
  for (let k = 0; k < COMET_TAIL_POINTS; k++) {
    points.push(cometPoint(comet, anomaly));
    anomaly = Math.max(-comet.exitAnomaly, stepAnomaly(comet, anomaly, step));
  }
  return points;
}

function random(state) {
  state.seed = (Math.imul(state.seed ?? SEED, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

function between(state, low, high) {
  return low + (high - low) * random(state);
}

function composeScene(state, frame, view, levels) {
  const held = planetLevels(frame.peaks);
  const flares = state.flares.map(flareFront);
  return {
    glow: state.glow,
    kick: state.kick,
    moonAngle: state.moonAngle,
    twinkle: state.twinkle,
    planets: PLANETS.map((planet, i) => placePlanet(planet, i, state, view, { level: levels[i], held: held[i] }, flares)),
    comets: state.comets.map((comet) => ({ head: cometPoint(comet, comet.anomaly), tail: cometTail(comet) })),
    flares,
    stars: starField(state),
  };
}

// The flare eases out from the sun to the dial and fades as it goes.
function flareFront(age) {
  const progress = age / FLARE_SECONDS;
  return { fraction: FLARE_START + (1 - FLARE_START) * (1 - (1 - progress) ** 2), strength: (1 - progress) ** 2 };
}

function placePlanet(planet, index, state, view, { level, held }, flares) {
  const angle = state.angles[index];
  const orbit = planet.orbit - ORBIT_SHRINK * (1 - level);
  const depth = Math.sin(angle);
  const body = Math.max(MIN_BODY_PX, view.unit * planet.size * (BODY_BASE + BODY_GAIN * level)) * (1 + DEPTH_SCALE * depth);
  let flash = 0;
  for (const flare of flares) flash += flare.strength * Math.exp(-(((flare.fraction - orbit) / FLARE_HIT_WIDTH) ** 2));
  return { ...planet, angle, orbit, depth, body, level, held, flash: Math.min(1, flash), rate: state.rates[index], ...onPlane(view, orbit, angle) };
}

function onPlane(view, fraction, angle) {
  return { x: view.centerX + fraction * view.radiusX * Math.cos(angle), y: view.centerY + fraction * view.radiusY * Math.sin(angle) };
}

function toScreen(view, point) {
  return { x: view.centerX + point.x * view.radiusX, y: view.centerY + point.y * view.radiusY };
}

function starField(state) {
  state.stars ??= Array.from({ length: STAR_MAX }, () => ({
    u: random(state),
    v: random(state),
    size: random(state),
    phase: random(state) * TAU,
    rate: 0.6 + 1.8 * random(state),
    pitch: random(state),
  }));
  return state.stars;
}

function paintScene(c, frame, view, scene) {
  const look = LOOKS[frame.theme] ?? LOOKS.dark;
  const paint = { c, frame, view, scene, look };
  c.lineJoin = 'round';
  paintStars(paint);
  paintHalf(paint, BACK);
  paintSun(paint);
  paintHalf(paint, FRONT);
}

// Planets behind the sun pass under its glow and planets in front cross its disc.
function paintHalf(paint, side) {
  paintDial(paint, side);
  paintOrbits(paint, side);
  paintFlares(paint, side);
  paintArms(paint, side);
  paintTrails(paint, side);
  paintComets(paint, side);
  paintPlanets(paint, side);
}

// Stars sort into a few shades, so the whole field takes a few fills.
function paintStars({ c, frame, view, scene, look }) {
  const count = Math.min(STAR_MAX, Math.max(STAR_MIN, Math.round((frame.width * frame.height) / STAR_AREA_PX)));
  const bands = frame.values.length;
  const shades = Array.from({ length: STAR_SHADES }, () => []);
  for (const star of scene.stars.slice(0, count)) {
    const band = Math.min(bands - 1, STAR_FIRST_BAND + Math.floor(star.pitch * (bands - STAR_FIRST_BAND)));
    const twinkle = 0.5 + 0.5 * Math.sin(star.phase + scene.twinkle * star.rate);
    const intensity = (0.25 + 0.75 * frame.values[band]) * (0.35 + 0.65 * twinkle);
    shades[Math.min(STAR_SHADES - 1, Math.floor(intensity * STAR_SHADES))].push(star);
  }
  c.globalCompositeOperation = look.glowOp;
  shades.forEach((group, shade) => {
    const alpha = scene.glow * look.starAlpha * ((shade + 1) / STAR_SHADES);
    if (group.length === 0 || alpha < MIN_ALPHA) return;
    c.fillStyle = rgba(look.star, alpha);
    c.beginPath();
    for (const star of group) {
      const radius = STAR_MIN_PX + star.size * STAR_SPAN_PX;
      const x = view.left + radius + star.u * (view.right - view.left - 2 * radius);
      const y = view.top + radius + star.v * (view.bottom - view.top - 2 * radius);
      c.moveTo(x + radius, y);
      c.arc(x, y, radius, 0, TAU);
    }
    c.fill();
  });
  c.globalCompositeOperation = 'source-over';
}

// A calendar ring with a long tick every third, like the engraved base of a real orrery.
function paintDial({ c, frame, view, scene, look }, side) {
  c.lineWidth = DIAL_LINE_PX;
  c.strokeStyle = rgba(look.brass, scene.glow * look.dialAlpha * (DIAL_BASE + DIAL_GAIN * frame.energy));
  c.beginPath();
  traceArc(c, view, 1, side.from, side.to);
  for (let k = 0; k < DIAL_TICKS; k++) {
    const angle = (k / DIAL_TICKS) * TAU;
    if (!side.holds(Math.sin(angle))) continue;
    const outer = onPlane(view, 1, angle);
    const inner = onPlane(view, 1 - (k % 3 === 0 ? DIAL_TICK_LONG : DIAL_TICK), angle);
    c.moveTo(outer.x, outer.y);
    c.lineTo(inner.x, inner.y);
  }
  c.stroke();
}

// Rings hold their brightness with the band's held peak, so each one lights like a meter.
function paintOrbits({ c, view, scene, look }, side) {
  for (const planet of scene.planets) {
    const alpha = scene.glow * look.orbitAlpha * (ORBIT_BASE + ORBIT_GAIN * planet.held);
    strokeArc(c, view, { fraction: planet.orbit, from: side.from, to: side.to }, ORBIT_LINE_PX, rgba(look.brass, alpha));
  }
}

function paintFlares({ c, view, scene, look }, side) {
  c.globalCompositeOperation = look.glowOp;
  for (const flare of scene.flares) {
    const width = view.unit * FLARE_WIDTH_RATIO * (0.4 + 0.6 * flare.strength);
    const alpha = scene.glow * look.flareAlpha * flare.strength;
    strokeArc(c, view, { fraction: flare.fraction, from: side.from, to: side.to }, width, rgba(look.flare, alpha));
  }
  c.globalCompositeOperation = 'source-over';
}

function paintArms({ c, view, scene, look }, side) {
  const start = view.sunRadius * (SUN_CORE_BASE + SUN_CORE_BASS) * ARM_CLEARANCE;
  c.lineWidth = Math.max(MIN_ARM_PX, view.unit * ARM_WIDTH_RATIO);
  c.strokeStyle = rgba(look.brass, scene.glow * look.armAlpha);
  c.beginPath();
  for (const planet of scene.planets) {
    if (!side.holds(planet.depth)) continue;
    const dx = planet.x - view.centerX;
    const dy = planet.y - view.centerY;
    const length = Math.hypot(dx, dy);
    if (length <= start + planet.body) continue;
    c.moveTo(view.centerX + (dx * start) / length, view.centerY + (dy * start) / length);
    c.lineTo(planet.x, planet.y);
  }
  c.stroke();
}

// Each trail is cut into pieces that thin and fade toward its tail, a soft wide pass under a bright core.
function paintTrails({ c, view, scene, look }, side) {
  c.lineCap = 'butt';
  c.globalCompositeOperation = look.glowOp;
  for (const planet of scene.planets) {
    const span = Math.min(TRAIL_MAX_RAD, planet.rate * TRAIL_SECONDS);
    if (span < MIN_TRAIL_RAD) continue;
    const strength = scene.glow * (TRAIL_BASE + TRAIL_GAIN * planet.level);
    for (let k = 0; k < TRAIL_PIECES; k++) {
      const arc = { fraction: planet.orbit, from: planet.angle - (span * (k + 1)) / TRAIL_PIECES, to: planet.angle - (span * k) / TRAIL_PIECES };
      if (!side.holds(Math.sin((arc.from + arc.to) / 2))) continue;
      const fade = strength * (1 - k / TRAIL_PIECES) ** TRAIL_FADE_POWER;
      const taper = 1 - TRAIL_TAPER * (k / TRAIL_PIECES);
      strokeArc(c, view, arc, 2 * planet.body * TRAIL_GLOW_RATIO * taper, tone(planet, look.trailLight, fade * look.trailGlowAlpha));
      strokeArc(c, view, arc, 2 * planet.body * TRAIL_CORE_RATIO * taper, tone(planet, look.trailLight, fade * look.trailCoreAlpha));
    }
  }
  c.globalCompositeOperation = 'source-over';
}

function paintComets({ c, frame, view, scene, look }, side) {
  c.lineCap = 'round';
  c.globalCompositeOperation = look.glowOp;
  for (const comet of scene.comets) {
    if (!side.holds(comet.head.y)) continue;
    const brightness = scene.glow * Math.min(1, (1 - comet.head.radius) / COMET_EDGE_FADE);
    if (brightness < MIN_ALPHA) continue;
    paintDustTail(c, view, comet.tail, rgbaScaler(look.dust, brightness * look.dustAlpha));
    paintIonTail(c, view, comet.head, rgba(frame.palette.accent, brightness * look.ionAlpha), rgba(frame.palette.accent, 0));
    paintCometHead(c, view, comet.head, { glow: rgbaScaler(frame.palette.accent, brightness * look.cometGlowAlpha), core: rgba(frame.palette.text, brightness) });
  }
  c.globalCompositeOperation = 'source-over';
}

// A color at a fixed peak alpha that a caller scales down, for pieces that fade along a tail.
function rgbaScaler(color, alpha) {
  return (fraction) => rgba(color, alpha * fraction);
}

function paintDustTail(c, view, tail, colorAt) {
  const perPiece = (tail.length - 1) / COMET_TAIL_PIECES;
  for (let k = 0; k < COMET_TAIL_PIECES; k++) {
    const fade = (1 - k / COMET_TAIL_PIECES) ** 1.5;
    c.lineWidth = view.unit * COMET_DUST_WIDTH_RATIO * (1 - 0.25 * k);
    c.strokeStyle = colorAt(fade);
    c.beginPath();
    for (let i = Math.round(k * perPiece); i <= Math.round((k + 1) * perPiece); i++) {
      const point = toScreen(view, tail[i]);
      if (i === Math.round(k * perPiece)) c.moveTo(point.x, point.y);
      else c.lineTo(point.x, point.y);
    }
    c.stroke();
  }
}

// The ion tail points straight away from the sun, longest near it, and stops at the dial.
function paintIonTail(c, view, head, color, clear) {
  const length = Math.min(1 - head.radius, COMET_ION_LENGTH * (1 - 0.7 * head.radius));
  const start = toScreen(view, head);
  const tip = toScreen(view, { x: (head.radius + length) * Math.cos(head.angle), y: (head.radius + length) * Math.sin(head.angle) });
  const run = Math.hypot(tip.x - start.x, tip.y - start.y);
  if (run < 1) return;
  const spread = (view.unit * COMET_ION_WIDTH_RATIO) / run;
  const normalX = -(tip.y - start.y) * spread;
  const normalY = (tip.x - start.x) * spread;
  const fade = c.createLinearGradient(start.x, start.y, tip.x, tip.y);
  fade.addColorStop(0, color);
  fade.addColorStop(1, clear);
  c.fillStyle = fade;
  c.beginPath();
  c.moveTo(start.x + normalX, start.y + normalY);
  c.lineTo(tip.x, tip.y);
  c.lineTo(start.x - normalX, start.y - normalY);
  c.closePath();
  c.fill();
}

function paintCometHead(c, view, head, colors) {
  const { x, y } = toScreen(view, head);
  const glowRadius = view.unit * COMET_GLOW_RATIO;
  const coreRadius = Math.min(glowRadius, Math.max(MIN_COMET_CORE_PX, view.unit * COMET_CORE_RATIO));
  const halo = c.createRadialGradient(x, y, 0, x, y, glowRadius);
  halo.addColorStop(0, colors.glow(1));
  halo.addColorStop(1, colors.glow(0));
  c.fillStyle = halo;
  c.beginPath();
  c.arc(x, y, glowRadius, 0, TAU);
  c.fill();
  c.fillStyle = colors.core;
  c.beginPath();
  c.arc(x, y, coreRadius, 0, TAU);
  c.fill();
}

// The sun swells with the bass and flares on a beat. Its corona lies over the far half of the system.
function paintSun({ c, frame, view, scene, look }) {
  const { centerX: x, centerY: y, sunRadius } = view;
  const core = sunRadius * (SUN_CORE_BASE + SUN_CORE_BASS * frame.bass);
  const reach = sunRadius * (SUN_GLOW_BASE + SUN_GLOW_BASS * frame.bass + SUN_GLOW_KICK * scene.kick);
  const strength = scene.glow * look.sunGlowAlpha * (0.6 + 0.4 * frame.bass);
  const corona = c.createRadialGradient(x, y, core * 0.5, x, y, reach);
  corona.addColorStop(0, rgba(look.sunGlow, strength));
  corona.addColorStop(0.35, rgba(look.sunGlow, strength * 0.35));
  corona.addColorStop(1, rgba(look.sunGlow, 0));
  c.globalCompositeOperation = look.glowOp;
  c.fillStyle = corona;
  c.beginPath();
  c.arc(x, y, reach, 0, TAU);
  c.fill();
  c.globalCompositeOperation = 'source-over';

  const disc = c.createRadialGradient(x - core * 0.25, y - core * 0.25, 0, x, y, core);
  disc.addColorStop(0, rgba(look.sunHot, scene.glow));
  disc.addColorStop(1, rgba(look.sunEdge, scene.glow));
  c.fillStyle = disc;
  c.beginPath();
  c.arc(x, y, core, 0, TAU);
  c.fill();
}

// Far planets draw first, so a near one passes over a far one.
function paintPlanets(paint, side) {
  const planets = paint.scene.planets.filter((planet) => side.holds(planet.depth)).sort((a, b) => a.depth - b.depth);
  for (const planet of planets) {
    paintHalo(paint, planet);
    if (planet.ring) paintRing(paint, planet, BACK);
    if (planet.moon) paintMoon(paint, planet, BACK);
    paintBody(paint, planet);
    if (planet.ring) paintRing(paint, planet, FRONT);
    if (planet.moon) paintMoon(paint, planet, FRONT);
  }
}

function paintHalo({ c, scene, look }, planet) {
  const alpha = scene.glow * look.haloAlpha * (HALO_BASE + HALO_GAIN * planet.level + planet.flash);
  if (alpha < MIN_ALPHA) return;
  const radius = planet.body * HALO_RATIO;
  const halo = c.createRadialGradient(planet.x, planet.y, planet.body * 0.5, planet.x, planet.y, radius);
  halo.addColorStop(0, tone(planet, look.haloLight, alpha));
  halo.addColorStop(1, tone(planet, look.haloLight, 0));
  c.globalCompositeOperation = look.glowOp;
  c.fillStyle = halo;
  c.beginPath();
  c.arc(planet.x, planet.y, radius, 0, TAU);
  c.fill();
  c.globalCompositeOperation = 'source-over';
}

// The lit side faces the sun, so each planet waxes and wanes as it circles.
function paintBody({ c, view, scene, look }, planet) {
  const towardX = view.centerX - planet.x;
  const towardY = view.centerY - planet.y;
  const offset = (planet.body * LIGHT_OFFSET) / (Math.hypot(towardX, towardY) || 1);
  const shade = c.createRadialGradient(planet.x + towardX * offset, planet.y + towardY * offset, planet.body * 0.1, planet.x, planet.y, planet.body);
  shade.addColorStop(0, tone(planet, look.litLight + FLASH_LIGHTNESS * planet.flash, scene.glow));
  shade.addColorStop(1, tone(planet, look.shadeLight, scene.glow));
  c.fillStyle = shade;
  c.beginPath();
  c.arc(planet.x, planet.y, planet.body, 0, TAU);
  c.fill();
}

function paintRing({ c, view, scene, look }, planet, side) {
  const across = planet.body * RING_RATIO;
  const upDown = across * view.tilt;
  const rollCos = Math.cos(RING_ROLL);
  const rollSin = Math.sin(RING_ROLL);
  c.lineWidth = planet.body * RING_WIDTH_RATIO;
  c.strokeStyle = tone(planet, look.ringLight, scene.glow * RING_ALPHA, 0.6);
  c.beginPath();
  for (let k = 0; k <= RING_STEPS; k++) {
    const angle = side.from + ((side.to - side.from) * k) / RING_STEPS;
    const localX = Math.cos(angle) * across;
    const localY = Math.sin(angle) * upDown;
    const x = planet.x + localX * rollCos - localY * rollSin;
    const y = planet.y + localX * rollSin + localY * rollCos;
    if (k === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
}

function paintMoon({ c, view, scene, look }, planet, side) {
  const angle = scene.moonAngle;
  const radius = planet.body * MOON_SIZE_RATIO;
  if (!side.holds(Math.sin(angle)) || radius < MIN_MOON_PX) return;
  const x = planet.x + Math.cos(angle) * planet.body * MOON_ORBIT_RATIO;
  const y = planet.y + Math.sin(angle) * planet.body * MOON_ORBIT_RATIO * view.tilt;
  c.fillStyle = rgba(look.moon, scene.glow);
  c.beginPath();
  c.arc(x, y, radius, 0, TAU);
  c.fill();
}

function strokeArc(c, view, arc, width, style) {
  c.lineWidth = width;
  c.strokeStyle = style;
  c.beginPath();
  traceArc(c, view, arc.fraction, arc.from, arc.to);
  c.stroke();
}

function traceArc(c, view, fraction, from, to) {
  const length = Math.abs(to - from) * fraction * view.radiusX;
  const steps = Math.min(MAX_ARC_STEPS, Math.max(2, Math.ceil(length / ARC_CHORD_PX)));
  for (let k = 0; k <= steps; k++) {
    const point = onPlane(view, fraction, from + ((to - from) * k) / steps);
    if (k === 0) c.moveTo(point.x, point.y);
    else c.lineTo(point.x, point.y);
  }
}

function tone(planet, lightness, alpha, saturationScale = 1) {
  const light = Math.min(96, lightness).toFixed(1);
  const saturation = (planet.saturation * saturationScale).toFixed(1);
  return `hsla(${planet.hue}, ${saturation}%, ${light}%, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

export default { label: 'Brass orrery', draw };
