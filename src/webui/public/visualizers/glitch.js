import { average, detectBeat, resample, rgba } from '../visualizer-kit.js';

// Additive primaries sum to white on the dark card and multiplied process inks sum to black on the white one,
// so each theme keeps a solid core with colored misregistration along its edges.
const INKS = {
  dark: {
    blend: 'lighter',
    alpha: 0.75,
    channels: [{ r: 255, g: 40, b: 90 }, { r: 40, g: 240, b: 150 }, { r: 60, g: 100, b: 255 }],
    snow: { r: 236, g: 242, b: 255 },
    scanline: 0.42,
  },
  light: {
    blend: 'multiply',
    alpha: 0.8,
    channels: [{ r: 230, g: 0, b: 125 }, { r: 250, g: 195, b: 0 }, { r: 0, g: 165, b: 225 }],
    snow: { r: 16, g: 20, b: 36 },
    scanline: 0.3,
  },
};

// Rows follow the height, so the phone strip still shows distinct steps and scanlines.
const ROW_DIVISOR = 64;
const MIN_ROW_PX = 2;
const MAX_ROW_PX = 4;
const TARGET_COLUMNS = 56;
const MIN_COLUMN_PX = 5;
const MAX_COLUMN_PX = 12;
// The ends of the spectrum shrink, so the shape floats instead of stopping at a wall.
const TAPER_POWER = 0.4;
// A soft margin inside the pad, where torn rows and smears fade instead of meeting a hard edge.
const FADE_X_RATIO = 0.08;
const FADE_X_MAX_PADS = 2.5;
const FADE_Y_PADS = 0.8;
const MAX_FADE_SHARE = 0.45;
// The shape reaches this far into the side margin, so its tapered ends dissolve.
const SHAPE_INSET_IN_FADE = 0.3;
// Counts grow with the span but stop here, so the wide desktop costs about the same as the default.
const BASE_SPAN = 365;
const MIN_SPAN_SCALE = 0.6;
const MAX_SPAN_SCALE = 1.5;

const PRESENCE_GAIN = 4;
// The share of the picture left after one second of silence, so it clears well inside the 3 second limit.
const GLOW_RETAIN_PER_SECOND = 0.02;
const MIN_GLOW = 0.01;

const KICK_DECAY_PER_SECOND = 5;
const TREBLE_BANDS = 5;
const GLITCH_FLOOR = 0.08;
const GLITCH_TREBLE = 0.25;
// The stutter clock re-rolls every corruption pattern, faster as the glitch grows, and a beat re-rolls it at once.
const TICK_HZ_CALM = 5;
const TICK_HZ_LOUD = 15;
const SNOW_HZ = 30;

// The second and third channels chase the levels at these rates, so a rising column leads in the first
// channel and a falling one trails in the third.
const CHROMA_LAG_PER_SECOND = [18, 8];
const SPLIT_BASE_PX = 1.5;
const SPLIT_TREBLE_PX = 3;
const SPLIT_KICK_RATIO = 0.03;
const SPLIT_KICK_MAX_COLUMNS = 4;
const LIFT_KICK = 0.5;
// A beat drops the resolution, so neighboring columns merge and the steps grow coarser for a moment.
const MAX_CRUSH = 3;

const MOSH_DECAY_PER_SECOND = 2.2;
// Half-lives of the last frame, from a clean keyframe to a full melt.
const MOSH_HALF_LIFE_CLEAN_S = 0.03;
const MOSH_HALF_LIFE_MELT_S = 0.35;
const MOSH_MIN = 0.02;
const MOSH_STRIP_PX = 14;
const MIN_MOSH_STRIPS = 3;
// Motion vectors per second at full melt, as shares of the area. Most point down, so the melt drips.
const MOSH_PUSH_X = 0.22;
const MOSH_PUSH_Y = 0.15;
const MOSH_RISE_SHARE = 0.25;

const MAX_TEARS = 4;
const TEAR_REACH = 0.09;
const TEAR_MIN_ROWS = 2;
const TEAR_EXTRA_ROWS = 6;
// A strong beat drops the vertical hold by up to this many rows.
const SLIP_ROWS = 3;

const TRACK_BAND_SHARE = 0.16;
// Where the tracking band starts, and where it stays under reduced motion.
const TRACK_START = 0.35;
const TRACK_ROLL_PER_SECOND = 0.16;
const TRACK_ROLL_BASS = 0.25;
const TRACK_SHIFT_BASE = 0.015;
const TRACK_SHIFT_BASS = 0.02;
const TRACK_SHIFT_KICK = 0.06;
const TRACK_JITTER = 0.3;

const MAX_BLOCKS = 10;
// Blocks span whole rows and columns, so corruption lands on the staircase's own grid.
const BLOCK_ROWS = 3;
const MAX_BLOCK_COLUMNS = 4;
// A stale block from the wrong place, a stretched streak, a blown-up corner and an inverted tint, with their shares.
const BLOCK_KINDS = [['stale', 0.4], ['streak', 0.25], ['pixelate', 0.15], ['tint', 0.2]];
const STALE_REACH_COLUMNS = 3;
const STREAK_STRETCH = 3;
const PIXELATE = 4;
const TINT_ALPHA = 0.7;

const SNOW_CALM = 10;
const SNOW_LOUD = 45;
const SNOW_LENGTH_ROWS = 6;
const SNOW_ALPHA = 0.55;
const DROPOUTS = 8;
const DROPOUT_COLUMNS = 6;
const SCANLINE_SHARE = 0.34;

// Each random stream mixes its own salt into the seed, so tears, blocks, melt and snow re-roll independently.
const SALT = { tear: 0x51ed27, block: 0x2c1b3c, mosh: 0x6d2b79, snow: 0x3c6ef3, track: 0x7f4a7c };
const SEED_MIX = 0x9e3779b1;

/**
 * A blocky spectrum decoded from a damaged tape. Its color channels slip out of register, rows tear sideways,
 * stale macroblocks land in the wrong place and a tracking band rolls through, and every beat makes it worse.
 */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  // Silence fades the picture out with the music, so a paused player shows nothing.
  const presence = Math.min(1, frame.energy * PRESENCE_GAIN);
  state.glow = Math.max((state.glow ?? 0) * GLOW_RETAIN_PER_SECOND ** frame.dtSeconds, presence);
  if (state.glow < MIN_GLOW) {
    state.awake = false;
    return;
  }

  const ink = frame.theme === 'light' ? INKS.light : INKS.dark;
  const grid = gridOf(frame);
  const layers = moshLayers(state, frame);
  // The last frame before a sleep is stale, so waking starts from a clean keyframe.
  if (state.awake !== true) layers.front.ctx.clearRect(0, 0, frame.width, frame.height);
  state.awake = true;
  const pulse = advance(state, frame, beat);
  const channels = channelHeights(state, frame, grid, pulse);

  moshPrevious(state, layers, frame, pulse);
  paintChannels(layers.back.ctx, channels, grid, pulse, ink);
  corruptBlocks(layers, grid, pulse, ink);
  state.layers = { ...layers, front: layers.back, back: layers.front };

  const band = trackingBand(grid, pulse);
  tearOnto(ctx, layers, grid, pulse, band, state.glow);
  scatterSnow(ctx, grid, pulse, band, ink, state.glow);
  cutScanlines(ctx, grid, ink);
  fadeEdges(ctx, grid);
  // The melt and the fade outlast the music, so the host keeps drawing until they clear.
  return true;
}

function gridOf(frame) {
  const { width, height, pad } = frame;
  const rowPx = clamp(Math.round(height / ROW_DIVISOR), MIN_ROW_PX, MAX_ROW_PX);
  const fadeX = Math.min(width * FADE_X_RATIO, pad * FADE_X_MAX_PADS);
  const fadeY = pad * FADE_Y_PADS;
  const left = pad + fadeX * SHAPE_INSET_IN_FADE;
  const span = width - 2 * left;
  const columns = Math.max(1, Math.round(span / clamp(span / TARGET_COLUMNS, MIN_COLUMN_PX, MAX_COLUMN_PX)));
  const middle = height / 2;
  // Rows run out from the middle line, so every step, block, tear and scanline shares one grid.
  const rowsPerSide = Math.ceil((middle - pad) / rowPx);
  return {
    width,
    height,
    pad,
    rowPx,
    fadeX,
    fadeY,
    left,
    span,
    columns,
    columnWidth: span / columns,
    middle,
    rows: 2 * rowsPerSide,
    top: middle - rowsPerSide * rowPx,
    shapeRows: Math.max(1, Math.floor((middle - pad - fadeY / 2) / rowPx)),
    spanScale: clamp(span / BASE_SPAN, MIN_SPAN_SCALE, MAX_SPAN_SCALE),
  };
}

// Two layers take turns as the last frame and the next, since a canvas is not drawn onto itself.
function moshLayers(state, frame) {
  const current = state.layers;
  if (current !== undefined && current.width === frame.width && current.height === frame.height) return current;
  const front = frame.createLayer(frame.width, frame.height);
  const back = frame.createLayer(frame.width, frame.height);
  // Nearest-neighbor copies keep stretched and blown-up blocks hard-edged, the way a broken decoder shows them.
  front.ctx.imageSmoothingEnabled = false;
  back.ctx.imageSmoothingEnabled = false;
  return {
    width: frame.width,
    height: frame.height,
    front,
    back,
    density: { x: front.canvas.width / frame.width, y: front.canvas.height / frame.height },
  };
}

function advance(state, frame, beat) {
  const motionDt = frame.reducedMotion ? 0 : frame.dtSeconds;
  const kicked = beat && !frame.reducedMotion;
  const treble = average(frame.values, frame.values.length - TREBLE_BANDS, frame.values.length);
  state.kick = frame.reducedMotion ? 0 : kicked ? 1 : (state.kick ?? 0) * Math.exp(-KICK_DECAY_PER_SECOND * frame.dtSeconds);
  state.mosh = frame.reducedMotion ? 0 : kicked ? 1 : (state.mosh ?? 0) * Math.exp(-MOSH_DECAY_PER_SECOND * frame.dtSeconds);
  const intensity = Math.min(1, GLITCH_FLOOR + GLITCH_TREBLE * treble + state.kick);
  state.tickClock = (state.tickClock ?? 0) + motionDt * (TICK_HZ_CALM + TICK_HZ_LOUD * intensity);
  const ticks = Math.floor(state.tickClock);
  state.tickClock -= ticks;
  state.tick = (state.tick ?? 1) + ticks + (kicked ? 1 : 0);
  // A beat is a new predicted frame, so it brings a new field of motion vectors for the melt.
  if (kicked) state.moshSeed = state.tick;
  state.snowClock = (state.snowClock ?? 0) + motionDt * SNOW_HZ;
  state.trackPhase = ((state.trackPhase ?? TRACK_START) + motionDt * (TRACK_ROLL_PER_SECOND + TRACK_ROLL_BASS * frame.bass)) % 1;
  return {
    kick: state.kick,
    mosh: state.mosh,
    intensity,
    treble,
    bass: frame.bass,
    tick: state.tick,
    moshSeed: state.moshSeed ?? 0,
    snowSeed: Math.floor(state.snowClock),
    trackPhase: state.trackPhase,
    motionDt,
  };
}

// The three channels follow the levels at their own lags, each snapped to the row grid.
function channelHeights(state, frame, grid, pulse) {
  const lead = resample(frame.values, grid.columns);
  if (state.chroma?.[0].length !== grid.columns) state.chroma = CHROMA_LAG_PER_SECOND.map(() => Float32Array.from(lead));
  const lagged = state.chroma.map((levels, k) => {
    const keep = Math.exp(-CHROMA_LAG_PER_SECOND[k] * frame.dtSeconds);
    for (let i = 0; i < levels.length; i++) levels[i] = lead[i] + (levels[i] - lead[i]) * keep;
    return levels;
  });
  const crush = Math.min(MAX_CRUSH, 1 + Math.floor(pulse.kick * MAX_CRUSH));
  return [lead, ...lagged].map((levels) => snapHeights(levels, grid, crush));
}

function snapHeights(levels, grid, crush) {
  const heights = new Float32Array(grid.columns);
  const step = grid.rowPx * crush;
  const maxSteps = Math.floor(grid.shapeRows / crush);
  for (let start = 0; start < grid.columns; start += crush) {
    const end = Math.min(grid.columns, start + crush);
    let level = 0;
    for (let i = start; i < end; i++) level = Math.max(level, levels[i] * Math.sin((Math.PI * (i + 0.5)) / grid.columns) ** TAPER_POWER);
    const steps = Math.min(maxSteps, Math.round((level * grid.shapeRows) / crush));
    heights.fill(steps * step, start, end);
  }
  return heights;
}

// The last frame carries forward along motion vectors, so a beat melts the picture until a clean keyframe returns.
function moshPrevious(state, layers, frame, pulse) {
  const { width, height } = frame;
  const c = layers.back.ctx;
  const halfLife = MOSH_HALF_LIFE_CLEAN_S + (MOSH_HALF_LIFE_MELT_S - MOSH_HALF_LIFE_CLEAN_S) * pulse.mosh ** 1.5;
  c.clearRect(0, 0, width, height);
  c.save();
  c.globalAlpha = 0.5 ** (frame.dtSeconds / halfLife);
  if (pulse.mosh < MOSH_MIN) {
    c.drawImage(layers.front.canvas, 0, 0, width, height);
    c.restore();
    return;
  }
  const strips = Math.max(MIN_MOSH_STRIPS, Math.round(height / MOSH_STRIP_PX));
  const shifts = moshShifts(state, strips, frame, pulse, layers.density);
  const stripHeight = height / strips;
  for (let s = 0; s < strips; s++) {
    const strip = { x: 0, y: s * stripHeight, width, height: stripHeight };
    copyRegion(c, layers.front, layers.density, strip, { ...strip, x: shifts[2 * s], y: strip.y + shifts[2 * s + 1] });
  }
  c.restore();
}

// Strips move by whole device pixels and carry the remainder, so the melt stays crisp at any speed.
function moshShifts(state, strips, frame, pulse, density) {
  if (state.moshCarry?.length !== strips * 2) state.moshCarry = new Float32Array(strips * 2);
  const carry = state.moshCarry;
  const shifts = new Float32Array(strips * 2);
  const random = generator(Math.imul(pulse.moshSeed, SEED_MIX) ^ SALT.mosh);
  const reach = pulse.mosh * pulse.motionDt;
  for (let s = 0; s < strips; s++) {
    carry[2 * s] += (random() * 2 - 1) * MOSH_PUSH_X * frame.width * reach * density.x;
    carry[2 * s + 1] += (random() - MOSH_RISE_SHARE) * MOSH_PUSH_Y * frame.height * reach * density.y;
    const stepX = Math.trunc(carry[2 * s]);
    const stepY = Math.trunc(carry[2 * s + 1]);
    carry[2 * s] -= stepX;
    carry[2 * s + 1] -= stepY;
    shifts[2 * s] = stepX / density.x;
    shifts[2 * s + 1] = stepY / density.y;
  }
  return shifts;
}

// Each channel lands off register by the split, and a hard beat lifts the outer two a row apart.
function paintChannels(c, channels, grid, pulse, ink) {
  const split = SPLIT_BASE_PX + SPLIT_TREBLE_PX * pulse.treble +
    pulse.kick * Math.min(grid.span * SPLIT_KICK_RATIO, grid.columnWidth * SPLIT_KICK_MAX_COLUMNS);
  const lift = pulse.kick > LIFT_KICK ? grid.rowPx : 0;
  c.save();
  c.globalCompositeOperation = ink.blend;
  channels.forEach((heights, k) => {
    if (!heights.some((height) => height > 0)) return;
    c.fillStyle = rgba(ink.channels[k], ink.alpha);
    c.beginPath();
    traceStaircase(c, heights, grid, (k - 1) * split, (1 - k) * lift);
    c.fill();
  });
  c.restore();
}

// One closed outline of square steps, the top edge left to right and its mirror back underneath.
function traceStaircase(c, heights, grid, offsetX, offsetY) {
  const { left, columnWidth, middle } = grid;
  c.moveTo(left + offsetX, middle + offsetY);
  for (let i = 0; i < heights.length; i++) {
    const x = left + i * columnWidth + offsetX;
    const y = middle - heights[i] + offsetY;
    c.lineTo(x, y);
    c.lineTo(x + columnWidth, y);
  }
  for (let i = heights.length - 1; i >= 0; i--) {
    const x = left + (i + 1) * columnWidth + offsetX;
    const y = middle + heights[i] + offsetY;
    c.lineTo(x, y);
    c.lineTo(x - columnWidth, y);
  }
  c.closePath();
}

// Macroblocks decode from the wrong place, smear or blow up, the way a damaged stream breaks.
function corruptBlocks(layers, grid, pulse, ink) {
  const count = Math.round(pulse.intensity ** 1.5 * MAX_BLOCKS * grid.spanScale);
  if (count === 0) return;
  const c = layers.back.ctx;
  const random = generator(Math.imul(pulse.tick, SEED_MIX) ^ SALT.block);
  const tints = ink.channels.map(() => []);
  for (let n = 0; n < count; n++) {
    const block = pickBlock(random, grid);
    const kind = pickKind(random());
    if (kind === 'tint') {
      tints[Math.floor(random() * tints.length)].push(block);
      continue;
    }
    const { from, to } = blockCopy(kind, block, random, grid, layers.density);
    // Clearing first replaces the block, so an empty source punches a hole the way a lost block does.
    c.clearRect(to.x, to.y, to.width, to.height);
    copyRegion(c, layers.front, layers.density, from, to);
  }
  c.save();
  // Difference inverts the core it lands on and shows its own color over empty space.
  c.globalCompositeOperation = 'difference';
  tints.forEach((blocks, k) => {
    if (blocks.length === 0) return;
    c.fillStyle = rgba(ink.channels[k], TINT_ALPHA);
    c.beginPath();
    for (const block of blocks) c.rect(block.x, block.y, block.width, block.height);
    c.fill();
  });
  c.restore();
}

// Blocks crowd toward the middle line, where the spectrum is, through a signed square of the reach.
function pickBlock(random, grid) {
  const columnsWide = 1 + Math.floor(random() * MAX_BLOCK_COLUMNS);
  const rowsTall = BLOCK_ROWS * (1 + Math.floor(random() * 2));
  const column = Math.floor(random() * Math.max(1, grid.columns - columnsWide + 1));
  const reach = random() * 2 - 1;
  const row = Math.round(reach * Math.abs(reach) * grid.shapeRows) - Math.floor(rowsTall / 2);
  return {
    x: grid.left + column * grid.columnWidth,
    y: grid.middle + row * grid.rowPx,
    width: columnsWide * grid.columnWidth,
    height: rowsTall * grid.rowPx,
  };
}

function pickKind(roll) {
  let total = 0;
  for (const [kind, share] of BLOCK_KINDS) {
    total += share;
    if (roll < total) return kind;
  }
  return BLOCK_KINDS[BLOCK_KINDS.length - 1][0];
}

// Where each corrupt block reads the last frame from and where it lands.
function blockCopy(kind, block, random, grid, density) {
  if (kind === 'streak') {
    // One device pixel column stretched sideways, like a sort run across the block.
    return { from: { ...block, width: 1 / density.x }, to: { ...block, width: block.width * (1 + random() * STREAK_STRETCH) } };
  }
  if (kind === 'pixelate') return { from: { ...block, width: block.width / PIXELATE, height: block.height / PIXELATE }, to: block };
  const shiftX = Math.round((random() * 2 - 1) * STALE_REACH_COLUMNS) * grid.columnWidth;
  const shiftY = Math.round(random() * 2 - 1) * block.height;
  return { from: { ...block, x: block.x + shiftX, y: block.y + shiftY }, to: block };
}

// drawImage reads its source in device pixels, so a CSS rectangle scales by the layer density and stays on the canvas.
function copyRegion(c, layer, density, from, to) {
  const { canvas } = layer;
  const x = clamp(Math.round(from.x * density.x), 0, canvas.width - 1);
  const y = clamp(Math.round(from.y * density.y), 0, canvas.height - 1);
  const width = Math.min(canvas.width - x, Math.max(1, Math.round(from.width * density.x)));
  const height = Math.min(canvas.height - y, Math.max(1, Math.round(from.height * density.y)));
  c.drawImage(canvas, x, y, width, height, to.x, to.y, to.width, to.height);
}

// The band rolls down through the picture and wraps, like a head that cannot hold the track.
function trackingBand(grid, pulse) {
  const rows = Math.max(2, Math.round(grid.rows * TRACK_BAND_SHARE));
  return {
    start: Math.round(pulse.trackPhase * (grid.rows + rows)) - rows,
    rows,
    shift: grid.span * (TRACK_SHIFT_BASE + TRACK_SHIFT_BASS * pulse.bass + TRACK_SHIFT_KICK * pulse.kick),
  };
}

// The sideways shift of every row, from torn runs that re-roll on the stutter clock and the tracking band's skew.
function rowOffsets(grid, pulse, band) {
  const offsets = new Float32Array(grid.rows);
  const random = generator(Math.imul(pulse.tick, SEED_MIX) ^ SALT.tear);
  const tears = Math.floor(pulse.intensity * MAX_TEARS + random());
  const reach = grid.span * TEAR_REACH * pulse.intensity;
  for (let t = 0; t < tears; t++) {
    const start = Math.floor(random() * grid.rows);
    const end = Math.min(grid.rows, start + TEAR_MIN_ROWS + Math.floor(random() * TEAR_EXTRA_ROWS));
    const shift = Math.round((random() * 2 - 1) * reach);
    for (let k = start; k < end; k++) offsets[k] += shift;
  }
  const jitter = generator(Math.imul(pulse.snowSeed, SEED_MIX) ^ SALT.track);
  for (let k = Math.max(0, band.start); k < Math.min(grid.rows, band.start + band.rows); k++) {
    const along = (k - band.start + 0.5) / band.rows;
    offsets[k] += Math.round(band.shift * (Math.sin(Math.PI * along) ** 2 * (1 - TRACK_JITTER) + TRACK_JITTER * jitter()));
  }
  return offsets;
}

// Rows that share a shift copy in one run, so a calm frame costs a handful of draws.
function tearOnto(ctx, layers, grid, pulse, band, glow) {
  const offsets = rowOffsets(grid, pulse, band);
  const slip = Math.round(pulse.kick ** 2 * SLIP_ROWS) * grid.rowPx;
  ctx.save();
  ctx.globalAlpha = Math.min(1, glow);
  ctx.imageSmoothingEnabled = false;
  let runStart = 0;
  for (let k = 1; k <= grid.rows; k++) {
    if (k < grid.rows && offsets[k] === offsets[runStart]) continue;
    const run = { x: 0, y: grid.top + runStart * grid.rowPx, width: grid.width, height: (k - runStart) * grid.rowPx };
    copyRegion(ctx, layers.back, layers.density, run, { ...run, x: offsets[runStart], y: run.y + slip });
    runStart = k;
  }
  ctx.restore();
}

// Tape snow fills the tracking band over a bright head-switch seam, and a beat throws dropouts across the picture.
function scatterSnow(ctx, grid, pulse, band, ink, glow) {
  const random = generator(Math.imul(pulse.snowSeed, SEED_MIX) ^ SALT.snow);
  const flakes = Math.round((SNOW_CALM + SNOW_LOUD * pulse.intensity) * grid.spanScale);
  const dropouts = Math.round(pulse.kick * DROPOUTS * grid.spanScale);
  const bandFirst = Math.max(0, band.start);
  const bandEnd = Math.min(grid.rows, band.start + band.rows);
  const thickness = Math.max(1, grid.rowPx / 2);
  const rowY = (row) => grid.top + row * grid.rowPx;
  let marks = 0;
  ctx.beginPath();
  if (bandEnd > bandFirst) {
    for (let n = 0; n < flakes; n++) {
      const row = bandFirst + Math.floor(random() * (bandEnd - bandFirst));
      ctx.rect(grid.left + random() * grid.span, rowY(row), grid.rowPx * (1 + random() * SNOW_LENGTH_ROWS), thickness);
    }
    if (band.start + band.rows <= grid.rows) ctx.rect(grid.left, rowY(band.start + band.rows) - thickness / 2, grid.span, thickness / 2);
    marks += flakes + 1;
  }
  for (let n = 0; n < dropouts; n++) {
    const row = Math.floor(random() * grid.rows);
    ctx.rect(grid.left + random() * grid.span, rowY(row), grid.columnWidth * (2 + random() * DROPOUT_COLUMNS), thickness);
  }
  marks += dropouts;
  if (marks === 0) return;
  ctx.fillStyle = rgba(ink.snow, SNOW_ALPHA * Math.min(1, glow));
  ctx.fill();
}

// A thin cut through the middle of every row gives the picture a raster aligned with its own steps.
function cutScanlines(ctx, grid, ink) {
  const thickness = grid.rowPx * SCANLINE_SHARE;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0, 0, 0, ${ink.scanline})`;
  ctx.beginPath();
  for (let k = 0; k < grid.rows; k++) ctx.rect(grid.pad, grid.top + (k + 0.5) * grid.rowPx - thickness / 2, grid.width - 2 * grid.pad, thickness);
  ctx.fill();
  ctx.restore();
}

// Torn rows and smears slide past the shape, so the picture fades to nothing at the pad on every side.
function fadeEdges(ctx, grid) {
  const { width, height, pad } = grid;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = edgeRamp(ctx.createLinearGradient(pad, 0, width - pad, 0), grid.fadeX / (width - 2 * pad));
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = edgeRamp(ctx.createLinearGradient(0, pad, 0, height - pad), grid.fadeY / (height - 2 * pad));
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function edgeRamp(gradient, share) {
  const inner = Math.min(MAX_FADE_SHARE, share);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(inner, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(1 - inner, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  return gradient;
}

// A small seeded generator, so a glitch pattern holds still for its whole tick and re-rolls on the next.
function generator(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default { label: 'Datamosh', draw };
