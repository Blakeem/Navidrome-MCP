import { average, detectBeat, hslOf } from '../visualizer-kit.js';

// Lengths are CSS pixels at the desktop area's 196 pixel height, and they scale with the shorter side.
const REFERENCE_SIDE = 196;
// The phone strip keeps stars large enough to read, and a wide window keeps them from swelling into blobs.
const MIN_UNIT = 0.6;
const MAX_UNIT = 1.25;
// One star per this many square pixels, so the web keeps one density at every size.
const AREA_PER_STAR = 1000;
const MIN_STARS = 16;
// The wide window stays about as light as the default size, so the count stops here.
const MAX_STARS = 64;
const DUST_PER_STAR = 1.2;
// Bass, low mids, high mids and treble each take one color family.
const GROUPS = 4;
// Hue offsets from the theme accent per family, so the map follows the theme's own color.
const GROUP_HUE_OFFSETS = [110, 60, 5, -40];
// The plastic number's R2 sequence and the golden angle spread the first stars evenly over the field.
const R2_X = 0.7548776662;
const R2_Y = 0.569840291;
const GOLDEN_ANGLE = 2.399963;

// A lit star's halo and spikes reach this far, which sets the margin every star center keeps from the pad.
const HALO_MAX = 13;
const HALO_MIN = 3;
const HALO_FROM = 0.08;
// Alpha at each fraction of the halo radius, a bright pinpoint inside a wide soft bloom.
const HALO_PROFILE = [[0, 1], [0.12, 0.65], [0.4, 0.18], [1, 0]];
const SPRITE_SIZE = 32;
const SPIKE_FROM = 0.62;
// The spikes' inner corners as a fraction of their length, which keeps them thin like telescope diffraction.
const SPIKE_WAIST = 0.18;
const SPIKE_SHORTEST = 1.5;
const CORE_BASE = 0.8;
const CORE_MASS = 0.8;
const CORE_GROW = 1.8;
const CORE_DIM = 0.4;
const DUST_RADIUS = 0.7;

// Link reach as a multiple of the mean star spacing. Loud passages and kicks reach further, so the web thickens.
const LINK_BASE = 1;
const LINK_ENERGY = 0.6;
const LINK_KICK = 0.35;
// An unlit link keeps this fraction of its light, so the whole map reads as one structure.
const LINK_FLOOR = 0.2;
// The brighter star of a link leads its light, so a lit star shines along every link it has.
const LINK_LEAD = 0.65;
const LINK_FALLOFF = 0.8;
const LINK_BUCKETS = 6;
const GLOW_FROM = 0.5;
const GLOW_HOT = 0.8;
const GLOW_LEVELS = [{ width: 2.6, alpha: 0.6 }, { width: 4, alpha: 1 }];
const FACET_BUCKETS = 3;
const MAX_FACETS = 160;
const CORE_BUCKETS = 3;
const DUST_BUCKETS = 3;
// A bucketed paint below this light would round to nothing, so it is skipped.
const MIN_LIGHT = 0.04;

// Drift in pixels per second at unit scale. Heavy bass stars drift slowly and light treble stars quickly.
const DRIFT_SLOW = 5;
const DRIFT_FAST = 14;
const DRIFT_CALM = 0.6;
const DRIFT_ENERGY = 1.2;
const DRIFT_KICK = 1.5;
const WANDER_RATE = 0.7;
const TURN_RATE = 0.9;
// Stars closer than this fraction of the spacing steer apart, so the web never clumps.
const SEPARATION = 0.85;
const SEPARATION_PUSH = 2.5;
// The field swells this much with the bass and kicks. The star margin leaves room for it.
const BREATH_MAX = 0.04;
const BREATH_BASS = 0.5;
const BREATH_KICK = 0.6;
const DUST_DRIFT = 3;
const DUST_FLOOR = 0.25;
// Motes fade over this inverse fraction of the field near the side they wrap around, so none pops in or out.
const DUST_EDGE_FADE = 6;
const TREBLE_BANDS = 5;

// A band level maps to a star's activation over this range, so quiet bands sit dim and loud ones blaze.
const ACTIVE_FLOOR = 0.12;
const ACTIVE_SPAN = 0.72;
const ACTIVE_GAMMA = 1.4;
const TWINKLE_DEPTH = 0.35;
const TWINKLE_RATE = 5;
const FLASH_GLOW = 0.9;
const FLASH_DECAY_PER_SECOND = 5;
const KICK_DECAY_PER_SECOND = 6;

// A beat fires one star, and its signal crosses one link in this time, then branches onward.
const SIGNAL_HOP_S = 0.22;
const SIGNAL_FIRST = 0.85;
const SIGNAL_FADE = 0.7;
const SIGNAL_FANOUT = 5;
const SIGNAL_BRANCH = 2;
const SIGNAL_HOPS = 3;
const MAX_SIGNALS = 48;
// Each signal trails a long dim segment and a short bright one, which reads as a fading comet.
const SIGNAL_TAILS = [{ length: 0.45, alpha: 0.35 }, { length: 0.18, alpha: 0.85 }];
const SIGNAL_WIDTH = 1.4;
const SIGNAL_HEAD = 1.5;
const SIGNAL_GLOW = 5;
const SEED_JITTER = 0.6;

const PRESENCE_GAIN = 4;
// The fraction of the map's brightness left one second after the music stops.
const RETAIN_PER_SECOND = 0.08;
const MIN_VISIBLE = 0.01;

// Saturation and lightness per element. Additive light blooms on the dark card but washes out on white,
// so the light theme draws deeper ink over the card instead.
const THEMES = {
  dark: {
    composite: 'lighter',
    link: [95, 68], linkAlpha: 0.85,
    glow: [100, 60], glowAlpha: 0.16,
    facet: [90, 62], facetAlpha: 0.14,
    halo: [100, 66], haloAlpha: 0.6,
    star: [100, 92], starAlpha: 1,
    spike: [100, 86], spikeAlpha: 0.7,
    dust: [40, 88], dustAlpha: 0.55,
    signal: [100, 90],
  },
  light: {
    composite: 'source-over',
    link: [85, 40], linkAlpha: 0.8,
    glow: [90, 55], glowAlpha: 0.12,
    facet: [80, 52], facetAlpha: 0.1,
    halo: [95, 55], haloAlpha: 0.35,
    star: [90, 30], starAlpha: 1,
    spike: [90, 38], spikeAlpha: 0.6,
    dust: [45, 45], dustAlpha: 0.45,
    signal: [95, 42],
  },
};

/**
 * A plexus star map. Drifting stars, each tuned to one band, link up when they come close, and the links and
 * the faces between them light with their stars. A beat fires a star whose signal races outward along the links.
 */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  const layout = layoutOf(frame);
  state.visibility = Math.max((state.visibility ?? 0) * RETAIN_PER_SECOND ** frame.dtSeconds, presence);
  if (state.visibility < MIN_VISIBLE || layout === null) {
    state.signals = [];
    return;
  }

  const style = THEMES[frame.theme] ?? THEMES.dark;
  const hues = groupHues(frame.palette.accent);
  const sprites = haloSprites(state, frame, style, hues);
  const stars = ensureStars(state, layout.starCount, frame.values.length);
  const dust = ensureDust(state, Math.round(layout.starCount * DUST_PER_STAR));
  const motion = advanceClock(state, frame, beat);

  driftStars(stars, frame, layout, motion);
  driftDust(dust, layout, motion);
  placeStars(stars, layout, motion.breath);
  separateStars(stars, layout, motion.dt);
  const web = linkStars(stars, layout.spacing * (LINK_BASE + LINK_ENERGY * frame.energy + LINK_KICK * motion.kick));
  if (beat) fireCascade(state, stars, web.neighbors, motion.reduced);
  advanceSignals(state, stars, web.neighbors, motion);
  lightStars(stars, frame, motion);

  const paint = { ctx, style, hues, unit: layout.unit, visibility: state.visibility };
  ctx.globalAlpha = state.visibility;
  ctx.globalCompositeOperation = style.composite;
  ctx.lineCap = 'round';
  drawDust(paint, dust, layout, motion);
  drawFacets(paint, stars, web);
  drawLinks(paint, stars, web);
  drawHalos(paint, stars, sprites);
  drawSpikes(paint, stars);
  drawCores(paint, stars);
  drawSignals(paint, state.signals, stars, sprites[0]);
  // The map fades after the music stops, so the host keeps drawing until it is gone.
  return true;
}

function layoutOf(frame) {
  const { width, height, pad } = frame;
  const unit = Math.min(MAX_UNIT, Math.max(MIN_UNIT, Math.min(width, height) / REFERENCE_SIDE));
  // A star's halo and spikes reach past its center, so centers stay this far inside the pad.
  const margin = HALO_MAX * unit + 1;
  const spanX = (width / 2 - pad - margin) / (1 + BREATH_MAX);
  const spanY = (height / 2 - pad - margin) / (1 + BREATH_MAX);
  if (spanX < 4 || spanY < 4) return null;
  const field = 4 * spanX * spanY;
  const starCount = Math.min(MAX_STARS, Math.max(MIN_STARS, Math.round(field / AREA_PER_STAR)));
  const dustReach = DUST_RADIUS * unit + 1;
  return {
    unit,
    spanX,
    spanY,
    starCount,
    centerX: width / 2,
    centerY: height / 2,
    spacing: Math.sqrt(field / starCount),
    dustSpanX: width / 2 - pad - dustReach,
    dustSpanY: height / 2 - pad - dustReach,
  };
}

function groupHues(accent) {
  const base = hslOf(accent).hue;
  return GROUP_HUE_OFFSETS.map((offset) => (base + offset + 360) % 360);
}

// One soft glow per color family, painted once and stamped under every lit star, so no star builds a gradient.
function haloSprites(state, frame, style, hues) {
  const { r, g, b } = frame.palette.accent;
  const key = `${frame.theme} ${r} ${g} ${b}`;
  if (state.sprites?.key === key) return state.sprites.layers;
  const layers = hues.map((hue) => paintSprite(frame.createLayer(SPRITE_SIZE, SPRITE_SIZE), hue, style.halo));
  state.sprites = { key, layers };
  return layers;
}

function paintSprite(layer, hue, tint) {
  const middle = SPRITE_SIZE / 2;
  const gradient = layer.ctx.createRadialGradient(middle, middle, 0, middle, middle, middle);
  for (const [offset, alpha] of HALO_PROFILE) gradient.addColorStop(offset, tone(hue, tint, alpha));
  layer.ctx.fillStyle = gradient;
  layer.ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return layer;
}

// Positions are fractions of the field from -1 to 1, so a resize keeps the map's shape.
function ensureStars(state, count, bandCount) {
  const stars = (state.stars ??= []);
  while (stars.length < count) stars.push(makeStar(stars.length, bandCount));
  if (stars.length > count) {
    stars.length = count;
    state.signals = (state.signals ?? []).filter((signal) => signal.from < count && signal.to < count);
  }
  return stars;
}

// Stars cycle through the bands, so every band has stars scattered across the whole map.
function makeStar(index, bandCount) {
  const band = index % bandCount;
  const heading = index * GOLDEN_ANGLE;
  return {
    u: 2 * fraction(0.5 + index * R2_X) - 1,
    v: 2 * fraction(0.5 + index * R2_Y) - 1,
    dirX: Math.cos(heading),
    dirY: Math.sin(heading),
    band,
    group: Math.floor((band * GROUPS) / bandCount),
    mass: 1 - band / (bandCount - 1),
    phase: fraction(index * 0.618034) * Math.PI * 2,
    flash: 0,
    active: 0,
    glow: 0,
    radius: 0,
    x: 0,
    y: 0,
  };
}

function ensureDust(state, count) {
  const dust = (state.dust ??= []);
  while (dust.length < count) dust.push(makeMote(dust.length));
  dust.length = count;
  return dust;
}

function makeMote(index) {
  return {
    u: 2 * fraction(0.2 + index * 0.6180339887) - 1,
    v: 2 * fraction(0.7 + index * 0.4142135624) - 1,
    phase: index * GOLDEN_ANGLE,
    rate: 1.5 + 3 * fraction(index * 0.3819660113),
  };
}

function advanceClock(state, frame, beat) {
  const reduced = frame.reducedMotion;
  const dt = reduced ? 0 : frame.dtSeconds;
  const bandCount = frame.values.length;
  state.time = (state.time ?? 0) + dt;
  state.kick = (beat ? 1 : (state.kick ?? 0)) * Math.exp(-KICK_DECAY_PER_SECOND * frame.dtSeconds);
  const kick = reduced ? 0 : state.kick;
  return {
    dt,
    reduced,
    kick,
    time: state.time,
    breath: reduced ? 0 : BREATH_MAX * Math.min(1, BREATH_BASS * frame.bass + BREATH_KICK * kick),
    treble: average(frame.values, bandCount - TREBLE_BANDS, bandCount),
  };
}

function driftStars(stars, frame, layout, motion) {
  if (motion.dt === 0) return;
  const pace = layout.unit * (DRIFT_CALM + DRIFT_ENERGY * frame.energy) * (1 + DRIFT_KICK * motion.kick);
  for (const star of stars) {
    const speed = (DRIFT_SLOW + (DRIFT_FAST - DRIFT_SLOW) * (1 - star.mass)) * pace;
    turn(star, Math.sin(motion.time * WANDER_RATE + star.phase) * TURN_RATE * motion.dt);
    const u = star.u + (star.dirX * speed * motion.dt) / layout.spanX;
    const v = star.v + (star.dirY * speed * motion.dt) / layout.spanY;
    if (Math.abs(u) > 1) star.dirX = -Math.sign(u) * Math.abs(star.dirX);
    if (Math.abs(v) > 1) star.dirY = -Math.sign(v) * Math.abs(star.dirY);
    star.u = reflect(u);
    star.v = reflect(v);
  }
}

function turn(star, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dirX = star.dirX * cos - star.dirY * sin;
  star.dirY = star.dirX * sin + star.dirY * cos;
  star.dirX = dirX;
}

// A star that crosses the field's edge comes back by the distance it overshot.
function reflect(position) {
  let bounced = position;
  if (position > 1) bounced = 2 - position;
  if (position < -1) bounced = -2 - position;
  return Math.min(1, Math.max(-1, bounced));
}

// The dust drifts one way at a steady pace, so the sky reads as a deeper layer behind the stars.
function driftDust(dust, layout, motion) {
  if (motion.dt === 0) return;
  const step = (DUST_DRIFT * layout.unit * motion.dt) / layout.dustSpanX;
  for (const mote of dust) {
    mote.u -= step;
    if (mote.u < -1) mote.u += 2;
  }
}

function placeStars(stars, layout, breath) {
  const reachX = layout.spanX * (1 + breath);
  const reachY = layout.spanY * (1 + breath);
  for (const star of stars) {
    star.x = layout.centerX + star.u * reachX;
    star.y = layout.centerY + star.v * reachY;
  }
}

// Close stars turn away from each other rather than jump, so the drift stays smooth.
function separateStars(stars, layout, dt) {
  if (dt === 0) return;
  const reach = layout.spacing * SEPARATION;
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const dx = stars[j].x - stars[i].x;
      const dy = stars[j].y - stars[i].y;
      const distance = Math.hypot(dx, dy);
      if (distance >= reach || distance < 1e-3) continue;
      const push = ((1 - distance / reach) * SEPARATION_PUSH * dt) / distance;
      stars[i].dirX -= dx * push;
      stars[i].dirY -= dy * push;
      stars[j].dirX += dx * push;
      stars[j].dirY += dy * push;
    }
  }
  for (const star of stars) {
    const length = Math.hypot(star.dirX, star.dirY);
    star.dirX = length > 1e-6 ? star.dirX / length : 1;
    star.dirY = length > 1e-6 ? star.dirY / length : 0;
  }
}

function linkStars(stars, reach) {
  const count = stars.length;
  const edges = [];
  const nearness = new Float32Array(count * count);
  const neighbors = stars.map(() => []);
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const distance = Math.hypot(stars[j].x - stars[i].x, stars[j].y - stars[i].y);
      if (distance >= reach) continue;
      const near = 1 - distance / reach;
      nearness[i * count + j] = near;
      nearness[j * count + i] = near;
      neighbors[i].push(j);
      neighbors[j].push(i);
      edges.push({ i, j, near });
    }
  }
  return { count, edges, nearness, neighbors };
}

// Every face of three mutually linked stars, found once each through its lowest pair.
function findFacets(web) {
  const facets = [];
  for (const edge of web.edges) {
    for (let k = edge.j + 1; k < web.count; k++) {
      const nearI = web.nearness[edge.i * web.count + k];
      const nearJ = web.nearness[edge.j * web.count + k];
      if (nearI === 0 || nearJ === 0) continue;
      facets.push({ a: edge.i, b: edge.j, c: k, near: Math.min(edge.near, nearI, nearJ) });
      if (facets.length >= MAX_FACETS) return facets;
    }
  }
  return facets;
}

function fireCascade(state, stars, neighbors, reduced) {
  state.serial = (state.serial ?? 0) + 1;
  const seed = pickSeed(stars, neighbors, state.serial);
  if (seed === -1) return;
  const signals = (state.signals ??= []);
  stars[seed].flash = 1;
  for (const next of neighbors[seed].slice(0, SIGNAL_FANOUT)) {
    // A travelling signal is motion the levels do not make, so reduced motion lights the neighbors at once.
    if (reduced) stars[next].flash = Math.max(stars[next].flash, SIGNAL_FIRST);
    else if (signals.length < MAX_SIGNALS) signals.push({ from: seed, to: next, progress: 0, strength: SIGNAL_FIRST, hops: 1 });
  }
}

// A linked bass star fires first, with jitter so successive cascades start in different places.
function pickSeed(stars, neighbors, serial) {
  let seed = -1;
  let best = -Infinity;
  for (let k = 0; k < stars.length; k++) {
    if (neighbors[k].length === 0) continue;
    const bassBias = stars[k].group <= 1 ? 1 : 0;
    const score = bassBias + stars[k].active + SEED_JITTER * fraction(Math.sin(serial * 12.9898 + k * 78.233) * 43758.5453);
    if (score > best) {
      best = score;
      seed = k;
    }
  }
  return seed;
}

function advanceSignals(state, stars, neighbors, motion) {
  const moving = [];
  if (motion.reduced) {
    state.signals = moving;
    return;
  }
  for (const signal of state.signals ?? []) {
    signal.progress += motion.dt / SIGNAL_HOP_S;
    if (signal.progress < 1) {
      moving.push(signal);
      continue;
    }
    const target = stars[signal.to];
    const rested = target.flash < signal.strength;
    target.flash = Math.max(target.flash, signal.strength);
    if (rested && signal.hops < SIGNAL_HOPS) branch(signal, neighbors[signal.to], stars, moving);
  }
  state.signals = moving;
}

// A star that fired a moment ago stays quiet, the way a neuron rests after firing, so the wave runs outward.
function branch(signal, around, stars, moving) {
  const strength = signal.strength * SIGNAL_FADE;
  let sent = 0;
  for (const next of around) {
    if (sent >= SIGNAL_BRANCH || moving.length >= MAX_SIGNALS) return;
    if (next === signal.from || stars[next].flash >= strength) continue;
    moving.push({ from: signal.to, to: next, progress: Math.min(0.9, signal.progress - 1), strength, hops: signal.hops + 1 });
    sent += 1;
  }
}

function lightStars(stars, frame, motion) {
  const decay = Math.exp(-FLASH_DECAY_PER_SECOND * frame.dtSeconds);
  for (const star of stars) {
    const level = frame.values[star.band];
    // Small treble stars twinkle hardest, the way small stars scintillate in the sky.
    const twinkle = 1 - TWINKLE_DEPTH * (1 - star.mass) * (0.5 + 0.5 * Math.sin(motion.time * TWINKLE_RATE + star.phase * 3));
    star.flash *= decay;
    star.active = Math.min(1, Math.max(0, (level - ACTIVE_FLOOR) / ACTIVE_SPAN)) ** ACTIVE_GAMMA;
    star.glow = Math.min(1, star.active * twinkle + FLASH_GLOW * star.flash);
    star.radius = CORE_BASE + CORE_MASS * star.mass + CORE_GROW * star.glow;
  }
}

function drawDust(paint, dust, layout, motion) {
  const { ctx, style, hues, unit } = paint;
  const shimmer = DUST_FLOOR + (1 - DUST_FLOOR) * motion.treble;
  const radius = DUST_RADIUS * unit;
  const bins = emptyBins(DUST_BUCKETS);
  for (const mote of dust) {
    const twinkle = 0.5 + 0.5 * Math.sin(motion.time * mote.rate + mote.phase);
    const edge = Math.min(1, (1 - Math.abs(mote.u)) * DUST_EDGE_FADE);
    const bucket = bucketOf(shimmer * twinkle * edge, DUST_BUCKETS);
    if (bucket >= 0) bins[bucket].push(mote);
  }
  eachBin(bins, DUST_BUCKETS, (motes, group, bucket) => {
    ctx.fillStyle = tone(hues[2], style.dust, style.dustAlpha * bucketLevel(bucket, DUST_BUCKETS));
    ctx.beginPath();
    for (const mote of motes) {
      const x = layout.centerX + mote.u * layout.dustSpanX;
      const y = layout.centerY + mote.v * layout.dustSpanY;
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  });
}

function drawFacets(paint, stars, web) {
  const { ctx, style, hues } = paint;
  const bins = emptyBins(GROUPS * FACET_BUCKETS);
  for (const facet of findFacets(web)) {
    const corners = [stars[facet.a], stars[facet.b], stars[facet.c]];
    const light = (Math.sqrt(facet.near) * (corners[0].glow + corners[1].glow + corners[2].glow)) / 3;
    const bucket = bucketOf(light, FACET_BUCKETS);
    if (bucket >= 0) bins[brightest(corners).group * FACET_BUCKETS + bucket].push(corners);
  }
  eachBin(bins, FACET_BUCKETS, (faces, group, bucket) => {
    ctx.fillStyle = tone(hues[group], style.facet, style.facetAlpha * bucketLevel(bucket, FACET_BUCKETS));
    ctx.beginPath();
    for (const corners of faces) traceFace(ctx, corners);
    ctx.fill();
  });
}

// Every face winds the same way, so overlapping faces in one nonzero fill never cancel into holes.
function traceFace(ctx, [a, b, c]) {
  const winding = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const [second, third] = winding >= 0 ? [b, c] : [c, b];
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(second.x, second.y);
  ctx.lineTo(third.x, third.y);
  ctx.closePath();
}

function drawLinks(paint, stars, web) {
  const { ctx, style, hues, unit } = paint;
  const lines = emptyBins(GROUPS * LINK_BUCKETS);
  const glows = emptyBins(GROUPS * GLOW_LEVELS.length);
  for (const edge of web.edges) {
    const a = stars[edge.i];
    const b = stars[edge.j];
    const lead = a.glow >= b.glow ? a : b;
    const charge = LINK_LEAD * lead.glow + (1 - LINK_LEAD) * Math.min(a.glow, b.glow);
    const light = edge.near ** LINK_FALLOFF * (LINK_FLOOR + (1 - LINK_FLOOR) * charge);
    const bucket = bucketOf(light, LINK_BUCKETS);
    if (bucket < 0) continue;
    lines[lead.group * LINK_BUCKETS + bucket].push(edge);
    if (light >= GLOW_FROM) glows[lead.group * GLOW_LEVELS.length + (light >= GLOW_HOT ? 1 : 0)].push(edge);
  }
  eachBin(glows, GLOW_LEVELS.length, (edges, group, level) => {
    ctx.lineWidth = GLOW_LEVELS[level].width * unit;
    ctx.strokeStyle = tone(hues[group], style.glow, style.glowAlpha * GLOW_LEVELS[level].alpha);
    strokeEdges(ctx, edges, stars);
  });
  eachBin(lines, LINK_BUCKETS, (edges, group, bucket) => {
    const level = bucketLevel(bucket, LINK_BUCKETS);
    ctx.lineWidth = Math.max(0.5, (0.45 + level) * unit);
    ctx.strokeStyle = tone(hues[group], style.link, style.linkAlpha * (0.15 + 0.85 * level));
    strokeEdges(ctx, edges, stars);
  });
}

function strokeEdges(ctx, edges, stars) {
  ctx.beginPath();
  for (const edge of edges) {
    ctx.moveTo(stars[edge.i].x, stars[edge.i].y);
    ctx.lineTo(stars[edge.j].x, stars[edge.j].y);
  }
  ctx.stroke();
}

function drawHalos(paint, stars, sprites) {
  const { ctx, style, unit, visibility } = paint;
  for (const star of stars) {
    if (star.glow < HALO_FROM) continue;
    const radius = (HALO_MIN + (HALO_MAX - HALO_MIN) * star.glow) * unit;
    ctx.globalAlpha = visibility * style.haloAlpha * star.glow;
    ctx.drawImage(sprites[star.group].canvas, star.x - radius, star.y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = visibility;
}

// The brightest stars carry four tapered diffraction spikes, the look of a star through a telescope.
function drawSpikes(paint, stars) {
  const { ctx, style, hues, unit } = paint;
  const bins = emptyBins(GROUPS);
  for (const star of stars) {
    if (star.glow > SPIKE_FROM) bins[star.group].push(star);
  }
  eachBin(bins, 1, (lit, group) => {
    ctx.fillStyle = tone(hues[group], style.spike, style.spikeAlpha);
    ctx.beginPath();
    for (const star of lit) {
      // The longest spike stays inside the halo, which the star margin already covers.
      const length = ((star.glow - SPIKE_FROM) / (1 - SPIKE_FROM)) * (HALO_MAX - 1) * unit;
      if (length >= SPIKE_SHORTEST * unit) traceSpikes(ctx, star.x, star.y, length, length * SPIKE_WAIST);
    }
    ctx.fill();
  });
}

function traceSpikes(ctx, x, y, length, waist) {
  ctx.moveTo(x + length, y);
  ctx.lineTo(x + waist, y + waist);
  ctx.lineTo(x, y + length);
  ctx.lineTo(x - waist, y + waist);
  ctx.lineTo(x - length, y);
  ctx.lineTo(x - waist, y - waist);
  ctx.lineTo(x, y - length);
  ctx.lineTo(x + waist, y - waist);
  ctx.closePath();
}

function drawCores(paint, stars) {
  const { ctx, style, hues, unit } = paint;
  const bins = emptyBins(GROUPS * CORE_BUCKETS);
  for (const star of stars) {
    const bucket = Math.min(CORE_BUCKETS - 1, Math.floor(star.glow * CORE_BUCKETS));
    bins[star.group * CORE_BUCKETS + bucket].push(star);
  }
  eachBin(bins, CORE_BUCKETS, (lit, group, bucket) => {
    ctx.fillStyle = tone(hues[group], style.star, style.starAlpha * (CORE_DIM + ((1 - CORE_DIM) * bucket) / (CORE_BUCKETS - 1)));
    ctx.beginPath();
    for (const star of lit) {
      const radius = star.radius * unit;
      ctx.moveTo(star.x + radius, star.y);
      ctx.arc(star.x, star.y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  });
}

// Signals take the bass family's color, since every cascade starts from a beat.
function drawSignals(paint, signals, stars, sprite) {
  const { ctx, style, hues, unit, visibility } = paint;
  if (signals.length === 0) return;
  const byHop = emptyBins(SIGNAL_HOPS);
  for (const signal of signals) byHop[signal.hops - 1].push(signal);
  ctx.lineWidth = SIGNAL_WIDTH * unit;
  eachBin(byHop, 1, (hop, group) => {
    const strength = SIGNAL_FADE ** group;
    for (const tail of SIGNAL_TAILS) {
      ctx.strokeStyle = tone(hues[0], style.signal, tail.alpha * strength);
      ctx.beginPath();
      for (const signal of hop) {
        const head = signalPoint(stars, signal, signal.progress);
        const end = signalPoint(stars, signal, Math.max(0, signal.progress - tail.length));
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(head.x, head.y);
      }
      ctx.stroke();
    }
  });
  const glowRadius = SIGNAL_GLOW * unit;
  for (const signal of signals) {
    const head = signalPoint(stars, signal, signal.progress);
    ctx.globalAlpha = visibility * style.haloAlpha * signal.strength;
    ctx.drawImage(sprite.canvas, head.x - glowRadius, head.y - glowRadius, glowRadius * 2, glowRadius * 2);
  }
  ctx.globalAlpha = visibility;
  ctx.fillStyle = tone(hues[0], style.signal, 1);
  ctx.beginPath();
  for (const signal of signals) {
    const head = signalPoint(stars, signal, signal.progress);
    const radius = SIGNAL_HEAD * unit * (0.6 + 0.4 * signal.strength);
    ctx.moveTo(head.x + radius, head.y);
    ctx.arc(head.x, head.y, radius, 0, Math.PI * 2);
  }
  ctx.fill();
}

function signalPoint(stars, signal, progress) {
  const from = stars[signal.from];
  const to = stars[signal.to];
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

function brightest(stars) {
  return stars.reduce((best, star) => (star.glow > best.glow ? star : best));
}

function emptyBins(count) {
  return Array.from({ length: count }, () => []);
}

// Shapes that share one color family and one brightness bucket go out in a single paint.
function eachBin(bins, buckets, paintBin) {
  bins.forEach((items, bin) => {
    if (items.length > 0) paintBin(items, Math.floor(bin / buckets), bin % buckets);
  });
}

function bucketOf(light, buckets) {
  if (light < MIN_LIGHT) return -1;
  return Math.min(buckets - 1, Math.floor(light * buckets));
}

function bucketLevel(bucket, buckets) {
  return (bucket + 1) / buckets;
}

function tone(hue, [saturation, lightness], alpha) {
  return `hsla(${hue.toFixed(1)}, ${saturation}%, ${lightness}%, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

function fraction(value) {
  return value - Math.floor(value);
}

export default { label: 'Plexus constellation', draw };
