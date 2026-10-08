import { average, detectBeat } from '../visualizer-kit.js';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// An 8-bit channel rounds an alpha under this to nothing, so paint that faint is skipped.
const VISIBLE_ALPHA = 0.003;

// Shell hues run from red in the bass to violet in the treble, so a burst wears the color of the band that fired it.
const HUE_BASS = 350;
const HUE_SPAN = 290;
const HUE_JITTER = 16;
// Willows burn gold whatever band fires them, the way charcoal stars do.
const GOLD_HUE = 40;
const GOLD_PULL = 0.75;
const BASS_BANDS = 4;
const TREBLE_FROM = 11;

// Burst radius as a share of the sky's shorter side, at rest and added at full level.
const SIZE_BASE = 0.24;
const SIZE_LEVEL = 0.22;
// Louder bands climb higher, the way a heavier lift charge carries a shell further.
const LOUD_LIFT = 0.6;
// Spots tried around the band's column, and how far from it a try may stray as a share of the sky's width.
const SPOT_TRIES = 4;
const COLUMN_SPREAD = 0.5;
const MIN_BURST_PX = 4;
// A pistil or a second ring needs this much room around it to read as its own shape.
const COMPANION_MIN_PX = 16;

// Drag and life are per second. Gravity counts burst radii per second squared, so a small burst droops like a big one.
const KINDS = {
  peony: { drag: 3.2, gravity: 0.55, life: 1.7, trail: 0.24, density: 1, shape: 'sphere', hueShift: 40, crackle: 1, gold: false, companion: { kind: 'pistil', size: 0.42, hueTurn: 180 } },
  pistil: { drag: 3.4, gravity: 0.5, life: 1.3, trail: 0.16, density: 1, shape: 'sphere', hueShift: -25, crackle: 0.5, gold: false, companion: null },
  ring: { drag: 3.6, gravity: 0.4, life: 1.5, trail: 0.2, density: 0.8, shape: 'ring', hueShift: -30, crackle: 0.8, gold: false, companion: { kind: 'halo', size: 0.62, hueTurn: 150 } },
  halo: { drag: 3.6, gravity: 0.4, life: 1.4, trail: 0.18, density: 0.8, shape: 'ring', hueShift: 30, crackle: 0.8, gold: false, companion: null },
  willow: { drag: 4.5, gravity: 1.4, life: 2.3, trail: 0.55, density: 0.6, shape: 'sphere', hueShift: 0, crackle: 0.35, gold: true, companion: null },
};
// Stars of a sphere fly a little slower or faster, so the shell has depth instead of one hard rim.
const SPHERE_SPEED_MIN = 0.9;
// A ring flattened to this share of its width or less reads as a line, so tilts stop short of edge-on.
const RING_TILT_MIN = 0.25;

// Dark theme stars burst white hot, settle into their color, then cool toward embers.
const WHITE_HOT = 96;
const HEAT_DECAY = 7;
const DARK_LIGHT = 62;
const DARK_GOLD_LIGHT = 60;
const DARK_COOLING = 16;
// Light theme stars stay deep and saturated, since white hot light vanishes on a white card.
const LIGHT_LIGHT = 48;
const LIGHT_GOLD_LIGHT = 42;
const LIGHT_COOLING = 12;
// Yellow reads far paler than blue at the same lightness on white, so it deepens further.
const YELLOW_DEEPEN = 9;

const TRAIL_SEGMENTS = 4;
// Older stretches of a trail are thinner and fainter, so every trail tapers to nothing.
const TRAIL_WIDTH = [1, 0.8, 0.62, 0.45];
const TRAIL_ALPHA = [0.95, 0.55, 0.28, 0.12];
const MIN_STRETCH_PX = 0.3;
// A wide faint stroke over the newest stretch stands in for shadowBlur, which costs too much per star.
const GLOW_WIDTH = 3.4;
const GLOW_ALPHA = 0.14;
const GLOW_LIGHT = 60;
const HEAD_SCALE = 0.85;
// Stars hold full brightness for this share of their life, then fade.
const FADE_FROM = 0.55;
const FADE_POWER = 1.6;

// Late in life stars crackle, each flashing on random ticks of this clock, more often with more treble.
const TWINKLE_HZ = 18;
const CRACKLE_FROM = 0.45;
const CRACKLE_RAMP = 0.15;
const CRACKLE_BASE = 0.18;
const CRACKLE_TREBLE = 0.6;
const CRACKLE_DIM = 0.6;
const LIT_SCALE = 1.35;
const LIT_BOOST = 1.8;
const LIT_DARK = 92;
const LIT_LIGHT = 30;

// A burst lights its own smoke: a hot core that dies in a blink over a tinted wash that lingers.
const FLASH_PEAK = 0.5;
const FLASH_DECAY = 9;
const WASH_PEAK = 0.1;
const WASH_DECAY = 2.5;
const WASH_REACH = 1.5;
const FLASH_CORE_LIGHT = 92;
const LIGHT_FLASH_SCALE = 0.35;

// About one beat at 90 to 120 BPM, so a rocket launched on a beat tends to burst on the next.
const FLIGHT_S = 0.7;
const FLIGHT_JITTER = 0.3;
// A beat bursts a rocket once it has flown this share of its flight, so bursts snap to the beat.
const BEAT_BURST_FROM = 0.65;
// Without a beat the fuse runs a little past the apex, where a real shell bursts as it slows.
const FUSE_END = 1.2;
// Sideways lean as a share of the rise, so rockets do not all climb straight up.
const ROCKET_LEAN = 0.3;
const ROCKET_TAIL_S = [0, 0.05, 0.14];
const ROCKET_TAIL_WIDTH = [1.2, 0.7];
const ROCKET_TAIL_ALPHA = [0.9, 0.4];
const ROCKET_HEAD_SCALE = 0.9;
// Sparks shed on a fixed clock of the rocket's age, so each one keeps its place from frame to frame.
const SPARK_STEP_S = 0.03;
const SPARK_LIFE_S = 0.32;
// Spark fall and scatter count sky units per second, so the tail keeps its shape at every size.
const SPARK_FALL = 0.9;
const SPARK_SCATTER = 0.12;
const SPARK_SCALE = 0.5;
const SPARK_ALPHA = [0.9, 0.35];
const ROCKET_DARK = { tail: { hue: 38, sat: 100, light: 72 }, spark: { hue: 34, sat: 100, light: 66 }, head: { hue: 45, sat: 100, light: 92 } };
const ROCKET_LIGHT = { tail: { hue: 26, sat: 95, light: 42 }, spark: { hue: 22, sat: 95, light: 44 }, head: { hue: 20, sat: 95, light: 34 } };

// Ambient launches per second for each unit of loudness over the floor, so music with soft beats still has a show.
const AMBIENT_RATE = 2.2;
const AMBIENT_FLOOR = 0.2;
const SALVO_BASS = 0.7;
const SALVO_ENERGY = 0.5;
// A rising band pulls the beat's rockets toward it, so the shells answer the sound that made the beat.
const ONSET_WEIGHT = 4;
const ONSET_DECAY_PER_SECOND = 12;
// Presence maps loudness to how lit the sky is, and launches need most of it, so the fall to silence fires nothing.
const PRESENCE_FLOOR = 0.02;
const PRESENCE_GAIN = 6;
const LAUNCH_PRESENCE = 0.5;
const DUSK_RISE_PER_SECOND = 8;
// After the music stops the sky dims over about 1.5 s, inside the 3 s the host allows.
const DUSK_FALL_PER_SECOND = 0.7;
const DUSK_OFF = 0.01;
// Under reduced motion a burst shows still, at this age of its spread, and only fades.
const FROZEN_AGE = 0.55;

// The mode fades its own edges over this share of the shorter side, inside the host's feather.
const FEATHER_RATIO = 0.05;
const LINE_RATIO = 0.012;
const MIN_LINE = 1;
const MAX_LINE = 2.4;
// Shells in the air at once per sky unit of width, so the phone strip holds a row of small shows.
const SHELLS_PER_UNIT = 2.5;
const MIN_SHELLS = 4;
const MAX_SHELLS = 12;
// The budget holds at every size, so the wide desktop costs no more than the default.
const PARTICLE_BUDGET = 420;
const LAUNCH_HEADROOM = 0.85;
const PARTICLES_PER_PX = 0.85;
const MIN_PARTICLES = 12;
const MAX_PARTICLES = 64;

/** A fireworks show: beats launch rockets from the band that fired them, which burst in its color under gravity and drag. */
function draw(ctx, frame) {
  const sky = skyOf(frame);
  const show = showOf(frame.state, frame);
  const beat = detectBeat(frame.state, frame);
  trackOnsets(show, frame);
  show.dusk = nextDusk(show.dusk, frame);
  if (show.dusk < DUSK_OFF) {
    show.rockets = [];
    show.bursts = [];
    return false;
  }

  advanceShells(show, frame, sky, beat);
  launchShells(show, frame, sky, beat);
  if (show.rockets.length === 0 && show.bursts.length === 0) return false;
  paintShow(ctx, show, frame, sky);
  // Stars outlive the beat that fired them, so the host keeps drawing until they fade.
  return true;
}

// The sky keeps bursts clear of the pad and the feather, so a star rarely meets the edge fade.
function skyOf(frame) {
  const { width, height, pad } = frame;
  const shorter = Math.min(width, height);
  const feather = shorter * FEATHER_RATIO;
  const lineWidth = clamp((shorter - 2 * pad) * LINE_RATIO, MIN_LINE, MAX_LINE);
  const inset = pad + feather / 2 + lineWidth * LIT_SCALE;
  const spanX = Math.max(1, width - 2 * inset);
  const spanY = Math.max(1, height - 2 * inset);
  const unit = Math.min(spanX, spanY);
  return {
    left: inset,
    right: width - inset,
    top: inset,
    bottom: height - inset,
    spanX,
    spanY,
    unit,
    horizon: height - pad,
    feather,
    lineWidth,
    maxShells: Math.round(clamp((spanX / unit) * SHELLS_PER_UNIT, MIN_SHELLS, MAX_SHELLS)),
  };
}

// Shells are placed for one size, so a resize clears the sky.
function showOf(state, frame) {
  const key = `${frame.width}x${frame.height}`;
  if (state.show?.key !== key) {
    state.show = { key, rockets: [], bursts: [], credit: 0, dusk: 0, onsets: new Float32Array(frame.values.length), previous: Float32Array.from(frame.values) };
  }
  return state.show;
}

function trackOnsets(show, frame) {
  const keep = Math.exp(-ONSET_DECAY_PER_SECOND * frame.dtSeconds);
  for (let i = 0; i < frame.values.length; i++) {
    show.onsets[i] = show.onsets[i] * keep + Math.max(0, frame.values[i] - show.previous[i]);
    show.previous[i] = frame.values[i];
  }
}

function presenceOf(frame) {
  return clamp01((frame.energy - PRESENCE_FLOOR) * PRESENCE_GAIN);
}

function nextDusk(dusk, frame) {
  const presence = presenceOf(frame);
  if (presence > dusk) return Math.min(presence, dusk + DUSK_RISE_PER_SECOND * frame.dtSeconds);
  return Math.max(presence, dusk - DUSK_FALL_PER_SECOND * frame.dtSeconds);
}

function advanceShells(show, frame, sky, beat) {
  for (const burst of show.bursts) burst.age += frame.dtSeconds;
  show.bursts = show.bursts.filter((burst) => burst.age < KINDS[burst.kind].life);

  const flying = [];
  for (const rocket of show.rockets) {
    rocket.age += frame.dtSeconds;
    const ripe = beat && rocket.age >= rocket.flight * BEAT_BURST_FROM;
    if (frame.reducedMotion) {
      detonate(show, rocket, rocket.centerX, rocket.centerY, sky);
    } else if (ripe || rocket.age >= rocket.flight * FUSE_END) {
      const at = rocketAt(rocket, rocket.age);
      detonate(show, rocket, at.x, at.y, sky);
    } else {
      flying.push(rocket);
    }
  }
  show.rockets = flying;
}

function launchShells(show, frame, sky, beat) {
  const ambient = AMBIENT_RATE * Math.max(0, frame.energy - AMBIENT_FLOOR) * frame.dtSeconds;
  // A beat spends the ambient credit, so steady beats lead and ambient launches only fill the gaps.
  show.credit = beat ? 0 : show.credit + ambient;
  if (presenceOf(frame) < LAUNCH_PRESENCE) return;

  let salvo = beat ? 1 + (frame.bass > SALVO_BASS && frame.energy > SALVO_ENERGY ? 1 : 0) : 0;
  if (show.credit >= 1) {
    salvo += 1;
    show.credit = 0;
  }
  for (const band of pickBands(show, frame, salvo, beat)) {
    if (!hasRoom(show, sky)) return;
    const plan = planShell(show, frame, sky, band);
    if (frame.reducedMotion) detonate(show, plan, plan.centerX, plan.centerY, sky);
    else show.rockets.push(plan);
  }
}

// Each rocket of a salvo takes a different band, so one beat paints several colors.
function pickBands(show, frame, count, beat) {
  const weights = Array.from(frame.values, (value, i) => value ** 3 + (beat ? ONSET_WEIGHT * show.onsets[i] : 0));
  const bands = [];
  for (let n = 0; n < count; n++) {
    const band = weightedPick(weights);
    if (band === -1) break;
    bands.push(band);
    weights[band] = 0;
  }
  return bands;
}

function weightedPick(weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return -1;
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0 && weights[i] > 0) return i;
  }
  return weights.findLastIndex((weight) => weight > 0);
}

function hasRoom(show, sky) {
  const shells = show.rockets.length + show.bursts.filter((burst) => burst.primary).length;
  return shells < sky.maxShells && particleCount(show) < PARTICLE_BUDGET * LAUNCH_HEADROOM;
}

function particleCount(show) {
  return show.bursts.reduce((sum, burst) => sum + burst.count, 0);
}

// Bass fires drooping willows, the mids fire peonies, and the treble fires rings.
function kindFor(band) {
  const roll = Math.random();
  if (band < BASS_BANDS) return roll < 0.55 ? 'willow' : 'peony';
  if (band < TREBLE_FROM) return roll < 0.7 ? 'peony' : 'ring';
  return roll < 0.55 ? 'ring' : 'peony';
}

// The band sets the column, the color and the height, and the burst is sized so its droop stays in the sky.
function planShell(show, frame, sky, band) {
  const kindName = kindFor(band);
  const kind = KINDS[kindName];
  const level = frame.values[band];
  const droop = droopOf(kind);
  const radius = Math.min(sky.unit * (SIZE_BASE + SIZE_LEVEL * level), sky.spanY / (2 + droop), sky.spanX / 2);
  const spot = pickSpot(show, sky, radius, droop, (band + 0.5) / frame.values.length, level);
  const rise = sky.horizon - spot.y;
  const flight = FLIGHT_S * (1 - FLIGHT_JITTER / 2 + FLIGHT_JITTER * Math.random());
  const launchX = clamp(spot.x + (Math.random() - 0.5) * rise * ROCKET_LEAN, sky.left, sky.right);
  return {
    kind: kindName,
    radius,
    hue: hueFor(band, kind, frame.values.length),
    centerX: spot.x,
    centerY: spot.y,
    launchX,
    launchY: sky.horizon,
    driftX: (spot.x - launchX) / flight,
    // The launch speed and a constant pull are matched, so the rocket stops at the planned height after one flight.
    lift: (2 * rise) / flight,
    fall: (2 * rise) / flight ** 2,
    flight,
    age: 0,
    seed: Math.random() * 1000,
  };
}

// The try farthest from the shells in the air wins, so bursts spread across the sky instead of stacking.
function pickSpot(show, sky, radius, droop, slot, level) {
  const spread = sky.spanX - 2 * radius;
  const highest = sky.top + radius;
  const lowest = sky.bottom - radius * (1 + droop);
  const taken = [
    ...show.rockets.map((rocket) => [rocket.centerX, rocket.centerY]),
    ...show.bursts.filter((burst) => burst.primary).map((burst) => [burst.x, burst.y]),
  ];
  let best = null;
  for (let n = 0; n < SPOT_TRIES; n++) {
    const x = sky.left + radius + spread * clamp01(slot + (Math.random() - 0.5) * COLUMN_SPREAD);
    const y = highest + (lowest - highest) * Math.random() * (1 - LOUD_LIFT * level);
    const gap = taken.reduce((nearest, [otherX, otherY]) => Math.min(nearest, Math.hypot(otherX - x, otherY - y)), Infinity);
    if (best === null || gap > best.gap) best = { x, y, gap };
  }
  return best;
}

function hueFor(band, kind, bands) {
  const hue = HUE_BASS + (band / (bands - 1)) * HUE_SPAN + (Math.random() - 0.5) * HUE_JITTER;
  return kind.gold ? mixHue(hue, GOLD_HUE, GOLD_PULL) : hue;
}

function rocketAt(rocket, age) {
  return { x: rocket.launchX + rocket.driftX * age, y: rocket.launchY - rocket.lift * age + 0.5 * rocket.fall * age * age };
}

// A rocket that bursts early or late sits off its plan, so the burst shrinks to the room around it.
function detonate(show, plan, x, y, sky) {
  const kind = KINDS[plan.kind];
  const room = Math.min(x - sky.left, sky.right - x, y - sky.top, (sky.bottom - y) / (1 + droopOf(kind)));
  const radius = Math.min(plan.radius, room);
  if (radius < MIN_BURST_PX) return;
  show.bursts.push(createBurst(show, plan.kind, x, y, radius, plan.hue, true));
  const companion = kind.companion;
  if (companion === null || radius < COMPANION_MIN_PX) return;
  show.bursts.push(createBurst(show, companion.kind, x, y, radius * companion.size, plan.hue + companion.hueTurn, false));
}

function createBurst(show, kindName, x, y, radius, hue, primary) {
  const kind = KINDS[kindName];
  const free = Math.max(MIN_PARTICLES, PARTICLE_BUDGET - particleCount(show));
  const count = Math.round(clamp(radius * PARTICLES_PER_PX * kind.density, MIN_PARTICLES, Math.min(MAX_PARTICLES, free)));
  return {
    kind: kindName,
    primary,
    x,
    y,
    radius,
    hue: wrapHue(hue),
    count,
    dirs: kind.shape === 'ring' ? ringDirections(count) : sphereDirections(count),
    seeds: Float32Array.from({ length: count }, () => Math.random() * 1000),
    age: 0,
  };
}

// A golden spiral on a sphere seen from the side, so the stars spread evenly and crowd toward the rim like a real shell.
function sphereDirections(count) {
  const dirs = new Float32Array(count * 2);
  const turn = Math.random() * TAU;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  for (let i = 0; i < count; i++) {
    const along = 1 - (2 * (i + 0.5)) / count;
    const speed = SPHERE_SPEED_MIN + (1 - SPHERE_SPEED_MIN) * Math.random();
    const x = along * speed;
    const y = Math.sqrt(1 - along * along) * Math.cos(i * GOLDEN_ANGLE) * speed;
    dirs[2 * i] = x * cos - y * sin;
    dirs[2 * i + 1] = x * sin + y * cos;
  }
  return dirs;
}

// A flat ring tilted away from the viewer, so it shows as an ellipse at a random angle.
function ringDirections(count) {
  const dirs = new Float32Array(count * 2);
  const tilt = RING_TILT_MIN + (1 - RING_TILT_MIN) * Math.random();
  const turn = Math.random() * Math.PI;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  for (let i = 0; i < count; i++) {
    const around = ((i + 0.25 * Math.random()) / count) * TAU;
    const speed = 0.97 + 0.03 * Math.random();
    const x = Math.cos(around) * speed;
    const y = Math.sin(around) * tilt * speed;
    dirs[2 * i] = x * cos - y * sin;
    dirs[2 * i + 1] = x * sin + y * cos;
  }
  return dirs;
}

// Linear drag and gravity have a closed form, so a star's past positions draw its trail without stored history.
function travel(burst, kind, age) {
  const spent = 1 - Math.exp(-kind.drag * age);
  return { reach: burst.radius * spent, drop: ((burst.radius * kind.gravity) / kind.drag) * (age - spent / kind.drag) };
}

// How far a star sinks over its life, in burst radii.
function droopOf(kind) {
  const spent = 1 - Math.exp(-kind.drag * kind.life);
  return (kind.gravity / kind.drag) * (kind.life - spent / kind.drag);
}

function lifeAlpha(age, kind) {
  const progress = age / kind.life;
  if (progress >= 1) return 0;
  if (progress <= FADE_FROM) return 1;
  return ((1 - progress) / (1 - FADE_FROM)) ** FADE_POWER;
}

function shade(burst, kind, age, look) {
  const progress = clamp01(Math.max(0, age) / kind.life);
  const hue = wrapHue(burst.hue + kind.hueShift * progress);
  if (look.dark) {
    const ember = (kind.gold ? DARK_GOLD_LIGHT : DARK_LIGHT) - DARK_COOLING * progress;
    const heat = Math.exp(-Math.max(0, age) * HEAT_DECAY);
    return { hue, sat: kind.gold ? 92 : 100, light: ember + (WHITE_HOT - ember) * heat };
  }
  const yellow = Math.exp(-(((hue - 60) / 30) ** 2));
  return { hue, sat: 95, light: (kind.gold ? LIGHT_GOLD_LIGHT : LIGHT_LIGHT) - LIGHT_COOLING * progress - YELLOW_DEEPEN * yellow };
}

function paintShow(ctx, show, frame, sky) {
  const look = {
    dark: frame.theme === 'dark',
    dusk: show.dusk,
    treble: average(frame.values, TREBLE_FROM, frame.values.length),
    reducedMotion: frame.reducedMotion,
  };
  // Additive light glows on the dark card but washes out on white, where plain paint keeps the colors deep.
  ctx.globalCompositeOperation = look.dark ? 'lighter' : 'source-over';
  ctx.lineCap = 'butt';
  for (const burst of show.bursts) paintWash(ctx, burst, look);
  for (const burst of show.bursts) paintBurst(ctx, burst, look, sky);
  paintRockets(ctx, show.rockets, look, sky);
  featherEdges(ctx, frame, sky);
}

// The core flash is skipped under reduced motion, since a sudden flare is the harshest change on screen.
function paintWash(ctx, burst, look) {
  if (!burst.primary) return;
  const scale = look.dark ? 1 : LIGHT_FLASH_SCALE;
  const wash = WASH_PEAK * Math.exp(-burst.age * WASH_DECAY) * look.dusk * scale;
  const flash = look.reducedMotion ? 0 : FLASH_PEAK * Math.exp(-burst.age * FLASH_DECAY) * look.dusk * scale;
  if (wash + flash < VISIBLE_ALPHA) return;
  const tone = { hue: burst.hue, sat: 100, light: look.dark ? GLOW_LIGHT : LIGHT_LIGHT };
  const core = { ...tone, light: look.dark ? FLASH_CORE_LIGHT : LIGHT_LIGHT };
  const reach = burst.radius * WASH_REACH;
  const gradient = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, reach);
  gradient.addColorStop(0, hsla(core, flash + wash));
  gradient.addColorStop(0.22, hsla(tone, flash * 0.25 + wash * 0.8));
  gradient.addColorStop(0.6, hsla(tone, wash * 0.35));
  gradient.addColorStop(1, hsla(tone, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(burst.x, burst.y, reach, 0, TAU);
  ctx.fill();
}

function paintBurst(ctx, burst, look, sky) {
  const kind = KINDS[burst.kind];
  const fade = lifeAlpha(burst.age, kind) * look.dusk;
  if (fade < VISIBLE_ALPHA) return;
  const shapeAge = look.reducedMotion ? FROZEN_AGE : burst.age;
  const samples = [];
  for (let k = 0; k <= TRAIL_SEGMENTS; k++) samples.push(travel(burst, kind, Math.max(0, shapeAge - (kind.trail * k) / TRAIL_SEGMENTS)));
  if (look.dark) strokeGlow(ctx, burst, kind, samples, fade, look, sky);
  strokeTrail(ctx, burst, kind, samples, fade, look, sky);
  fillHeads(ctx, burst, kind, samples[0], fade, look, sky);
}

function strokeGlow(ctx, burst, kind, samples, fade, look, sky) {
  if (!hasLength(samples[0], samples[2])) return;
  ctx.lineWidth = sky.lineWidth * GLOW_WIDTH;
  ctx.strokeStyle = hsla({ ...shade(burst, kind, burst.age, look), light: GLOW_LIGHT }, fade * GLOW_ALPHA);
  traceStretch(ctx, burst, samples[0], samples[2]);
  ctx.stroke();
}

// Each stretch takes the color the star had when it passed there, so a trail runs from hot to cool.
function strokeTrail(ctx, burst, kind, samples, fade, look, sky) {
  for (let k = 0; k < TRAIL_SEGMENTS; k++) {
    if (!hasLength(samples[k], samples[k + 1])) continue;
    const tone = shade(burst, kind, burst.age - (kind.trail * (k + 0.5)) / TRAIL_SEGMENTS, look);
    ctx.lineWidth = sky.lineWidth * TRAIL_WIDTH[k];
    ctx.strokeStyle = hsla(tone, fade * TRAIL_ALPHA[k]);
    traceStretch(ctx, burst, samples[k], samples[k + 1]);
    ctx.stroke();
  }
}

function hasLength(near, far) {
  return near.reach - far.reach + near.drop - far.drop >= MIN_STRETCH_PX;
}

function traceStretch(ctx, burst, near, far) {
  const { x, y, dirs, count } = burst;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const dx = dirs[2 * i];
    const dy = dirs[2 * i + 1];
    ctx.moveTo(x + dx * near.reach, y + dy * near.reach + near.drop);
    ctx.lineTo(x + dx * far.reach, y + dy * far.reach + far.drop);
  }
}

// Crackle splits the stars into a dimmed batch and a flashing batch, so each batch is one fill.
function fillHeads(ctx, burst, kind, head, fade, look, sky) {
  const progress = burst.age / kind.life;
  const crackle = look.reducedMotion ? 0 : kind.crackle * clamp01((progress - CRACKLE_FROM) / CRACKLE_RAMP);
  const chance = crackle * (CRACKLE_BASE + CRACKLE_TREBLE * look.treble);
  const tick = Math.floor(burst.age * TWINKLE_HZ);
  const tone = shade(burst, kind, burst.age, look);
  ctx.fillStyle = hsla(tone, fade * (1 - CRACKLE_DIM * crackle));
  traceHeads(ctx, burst, head, sky.lineWidth * HEAD_SCALE, tick, chance, false);
  ctx.fill();
  if (chance <= 0) return;
  ctx.fillStyle = hsla({ ...tone, light: look.dark ? LIT_DARK : LIT_LIGHT }, fade * LIT_BOOST);
  traceHeads(ctx, burst, head, sky.lineWidth * LIT_SCALE, tick, chance, true);
  ctx.fill();
}

function traceHeads(ctx, burst, head, radius, tick, chance, lit) {
  ctx.beginPath();
  for (let i = 0; i < burst.count; i++) {
    if ((sparkleHash(burst.seeds[i], tick) < chance) !== lit) continue;
    const x = burst.x + burst.dirs[2 * i] * head.reach;
    const y = burst.y + burst.dirs[2 * i + 1] * head.reach + head.drop;
    ctx.moveTo(x + radius, y);
    ctx.arc(x, y, radius, 0, TAU);
  }
}

function paintRockets(ctx, rockets, look, sky) {
  if (rockets.length === 0) return;
  const tones = look.dark ? ROCKET_DARK : ROCKET_LIGHT;
  for (let k = 0; k < ROCKET_TAIL_WIDTH.length; k++) {
    ctx.lineWidth = sky.lineWidth * ROCKET_TAIL_WIDTH[k];
    ctx.strokeStyle = hsla(tones.tail, look.dusk * ROCKET_TAIL_ALPHA[k]);
    ctx.beginPath();
    for (const rocket of rockets) {
      const near = rocketAt(rocket, Math.max(0, rocket.age - ROCKET_TAIL_S[k]));
      const far = rocketAt(rocket, Math.max(0, rocket.age - ROCKET_TAIL_S[k + 1]));
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(far.x, far.y);
    }
    ctx.stroke();
  }
  for (const [index, young] of [true, false].entries()) {
    ctx.fillStyle = hsla(tones.spark, look.dusk * SPARK_ALPHA[index]);
    traceSparks(ctx, rockets, sky, young);
    ctx.fill();
  }
  const radius = sky.lineWidth * ROCKET_HEAD_SCALE;
  ctx.fillStyle = hsla(tones.head, look.dusk);
  ctx.beginPath();
  for (const rocket of rockets) {
    const at = rocketAt(rocket, rocket.age);
    ctx.moveTo(at.x + radius, at.y);
    ctx.arc(at.x, at.y, radius, 0, TAU);
  }
  ctx.fill();
}

// Sparks fall and scatter from where the rocket was when it shed them.
function traceSparks(ctx, rockets, sky, young) {
  const scatter = sky.unit * SPARK_SCATTER;
  const fall = sky.unit * SPARK_FALL;
  const radius = sky.lineWidth * SPARK_SCALE;
  ctx.beginPath();
  for (const rocket of rockets) {
    const first = Math.max(0, Math.ceil((rocket.age - SPARK_LIFE_S) / SPARK_STEP_S));
    for (let step = first; step * SPARK_STEP_S <= rocket.age; step++) {
      const sparkAge = rocket.age - step * SPARK_STEP_S;
      if ((sparkAge < SPARK_LIFE_S / 2) !== young) continue;
      const origin = rocketAt(rocket, step * SPARK_STEP_S);
      const x = origin.x + (sparkleHash(rocket.seed, step) - 0.5) * scatter * sparkAge;
      const y = origin.y + (sparkleHash(rocket.seed + 31, step) - 0.5) * scatter * sparkAge + 0.5 * fall * sparkAge * sparkAge;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, TAU);
    }
  }
}

// The sky fades to nothing at the pad, so a star or a wash that reaches the edge dissolves instead of clipping.
function featherEdges(ctx, frame, sky) {
  const { width, height, pad } = frame;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = edgeFade(ctx.createLinearGradient(pad, 0, width - pad, 0), sky.feather / (width - 2 * pad));
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = edgeFade(ctx.createLinearGradient(0, pad, 0, height - pad), sky.feather / (height - 2 * pad));
  ctx.fillRect(0, 0, width, height);
}

function edgeFade(gradient, fraction) {
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(fraction, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(1 - fraction, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  return gradient;
}

function hsla(tone, alpha) {
  return `hsla(${tone.hue.toFixed(1)}, ${tone.sat}%, ${tone.light.toFixed(1)}%, ${clamp01(alpha).toFixed(3)})`;
}

// A stateless hash, so a spark's scatter and a star's flicker stay fixed for a given seed and tick.
function sparkleHash(seed, tick) {
  const value = Math.sin(seed * 12.9898 + tick * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function mixHue(from, to, amount) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta * amount;
}

function wrapHue(hue) {
  return ((hue % 360) + 360) % 360;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

export default { label: 'Fireworks', draw };
