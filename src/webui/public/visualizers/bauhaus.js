import { average, detectBeat, rgba } from '../visualizer-kit.js';

// The three Bauhaus primaries and an ink. Black vanishes on the dark card, so its ink is a warm paper white,
// and the light card takes deeper primaries that hold their weight on white.
const PRIMARIES = {
  dark: [{ r: 238, g: 66, b: 46 }, { r: 250, g: 198, b: 32 }, { r: 64, g: 120, b: 236 }, { r: 242, g: 234, b: 218 }],
  light: [{ r: 210, g: 36, b: 28 }, { r: 236, g: 168, b: 0 }, { r: 22, g: 64, b: 164 }, { r: 22, g: 22, b: 26 }],
};
const INK = 3;
// Red and blue carry the poster and ink stays an accent.
const COLOR_WEIGHTS = [0.32, 0.24, 0.3, 0.14];

// About this many cells at every size, so the wide window draws no more shapes than the phone strip.
const TARGET_CELLS = 20;
// The gap between modules as a fraction of a cell, which keeps the grid legible between the shapes.
const GUTTER = 0.14;
const WIDE_CHANCE = 0.14;
const TALL_CHANCE = 0.1;

const SQUARE_SHAPES = ['quarter', 'half', 'disc', 'triangle', 'stack'];
const SQUARE_WEIGHTS = [0.26, 0.2, 0.2, 0.2, 0.14];
const LONG_SHAPES = ['half', 'bar'];
const LONG_WEIGHTS = [0.55, 0.45];
const LEAD_SHAPES = ['rings', 'split'];
const LEAD_WEIGHTS = [0.6, 0.4];
// The lead module takes the bass, so the small modules share the bands above it.
const FIRST_SMALL_BAND = 2;
// The lead's rings stack three deep, so pieces fill in three passes from the back.
const LAYERS = 3;

// A cubic Bezier with handles this long per radius traces a quarter circle, and its handles stay inside the
// quarter's own box, so a curve is bounded by its true extent.
const KAPPA = 0.5523;
// The angles 0, a quarter, a half and three quarters of a turn, as cos and sin.
const QUADRANTS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const BAR_THICKNESS = 0.5;
const STACK_THICKNESS = 0.2;
const STACK_SPACING = 0.72;
const STACK_LENGTHS = [1, 0.7, 0.42];
// The gap between the halves of a split circle, as a fraction of its radius.
const SPLIT_GAP = 0.08;
// Below this size in CSS pixels a shape is skipped, so levels at rest draw nothing.
const MIN_SIZE_PX = 0.75;
// Levels under this floor are rest noise, and the curve lifts mid levels so a typical mix fills the poster.
const LEVEL_FLOOR = 0.01;
const LEVEL_CURVE = 0.7;
// Overall levels from about 0.2 up give full presence, so only a quiet passage or a fade shrinks the poster.
const PRESENCE_GAIN = 5;
// The share of full size a shape keeps at a silent band. The lead keeps more, so it always dominates.
const TILE_BASE = 0.35;
const LEAD_BASE = 0.5;
// A flipping tile this close to edge-on is skipped, since its transform is nearly flat.
const EDGE_ON = 0.02;

const TURN_SECONDS = 0.3;
// The share of tiles that turn on each beat.
const TURN_SHARE = 0.12;
// Quiet passages fire few beats, so a tile still turns after this long without one.
const IDLE_TURN_SECONDS = 1.6;
const LEAD_ACCENT_BEATS = 4;
const RECOMPOSE_BEATS = 32;
const RECOMPOSE_SECONDS = 18;
// Below this overall level the layout holds still, so a fade never sets off a turn or a recomposition.
const PRESENT_ENERGY = 0.05;
// A recomposition sweeps left to right in WIPE_SECONDS, and each module shrinks out and grows back in SWAP_SECONDS.
const WIPE_SECONDS = 0.5;
const SWAP_SECONDS = 0.4;
const KICK_DECAY_PER_SECOND = 7;
// The standard ease-out-back overshoot, which gives a turn its mechanical snap.
const OVERSHOOT = 1.70158;
// The year of the first Bauhaus exhibition. A fixed seed shows the same first poster on every load.
const SEED = 1923;

// Registration crosses mark where gutters meet and grow with the treble.
const CROSS_REACH = 0.1;
const CROSS_WIDTH = 0.03;
const CROSS_BANDS = 6;
const CROSS_ALPHA = 0.85;

/** A Bauhaus poster whose flat primary shapes scale with their bands on a strict grid, snap turns on beats and recompose. */
function draw(ctx, frame) {
  const { state } = frame;
  const beat = detectBeat(state, frame);
  const grid = gridFor(frame);
  if (grid === null) return false;
  ensurePoster(state, grid);
  advance(state, frame, beat, grid);
  const colors = frame.theme === 'light' ? PRIMARIES.light : PRIMARIES.dark;
  const { poster, wipe } = state;
  // Presence follows the overall level, so silence shrinks every shape to nothing.
  const drive = { presence: Math.min(1, Math.max(0, frame.energy - LEVEL_FLOOR) * PRESENCE_GAIN), kick: state.kick };
  const crossesShown = drawCrosses(ctx, frame, grid, poster, colors[INK]);
  const outgoingShown = wipe !== null && drawPoster(ctx, frame, wipe.previous, colors, (module) => outgoingScale(module, wipe), drive);
  const incomingShown = drawPoster(ctx, frame, poster, colors, (module) => incomingScale(module, wipe), drive);
  // Shapes shrink with the levels once the music stops, so the host keeps drawing until the last one is gone.
  return crossesShown || outgoingShown || incomingShown;
}

// Rows come from the height and columns fill the width, so cells stay square and the grid sits centered.
function gridFor(frame) {
  const { width, height, pad } = frame;
  const innerWidth = width - 2 * pad;
  const innerHeight = height - 2 * pad;
  if (innerWidth < 4 || innerHeight < 4) return null;
  const target = Math.sqrt((innerWidth * innerHeight) / TARGET_CELLS);
  const rows = Math.max(1, Math.round(innerHeight / target));
  const cols = Math.max(1, Math.floor(innerWidth / (innerHeight / rows)));
  const cell = Math.min(innerHeight / rows, innerWidth / cols);
  return {
    key: `${width}x${height}`,
    cols,
    rows,
    cell,
    gutter: cell * GUTTER,
    left: pad + (innerWidth - cols * cell) / 2,
    top: pad + (innerHeight - rows * cell) / 2,
  };
}

// A new size lays the same poster seed onto the new grid, so a resize keeps the composition where it can.
function ensurePoster(state, grid) {
  if (state.poster !== undefined && state.poster.key === grid.key) return;
  state.rng ??= { seed: SEED };
  state.posterSeed ??= SEED;
  state.poster = compose(grid, state.posterSeed);
  state.wipe = null;
  state.kick ??= 0;
  state.beats = 0;
  state.musicSeconds = 0;
  state.sinceTurn = 0;
}

function advance(state, frame, beat, grid) {
  const dt = frame.dtSeconds;
  state.kick = frame.reducedMotion ? 0 : (beat ? 1 : state.kick) * Math.exp(-KICK_DECAY_PER_SECOND * dt);
  settleMotion(state, frame);
  if (frame.reducedMotion || frame.energy < PRESENT_ENERGY) return;
  state.musicSeconds += dt;
  state.sinceTurn += dt;
  if (beat) state.beats += 1;
  if (state.wipe !== null) return;
  if (state.beats >= RECOMPOSE_BEATS || state.musicSeconds >= RECOMPOSE_SECONDS) recompose(state, grid);
  else if (beat) turnTiles(state, Math.max(1, Math.round(state.poster.modules.length * TURN_SHARE)), true);
  else if (state.sinceTurn >= IDLE_TURN_SECONDS) turnTiles(state, 1, false);
}

// Reduced motion lands every turn and wipe at once, so only the levels move the shapes.
function settleMotion(state, frame) {
  const posters = state.wipe === null ? [state.poster] : [state.poster, state.wipe.previous];
  for (const poster of posters) {
    for (const module of poster.modules) {
      module.turnAge = frame.reducedMotion ? TURN_SECONDS : Math.min(TURN_SECONDS, module.turnAge + frame.dtSeconds);
    }
  }
  if (state.wipe === null) return;
  state.wipe.age += frame.dtSeconds;
  if (frame.reducedMotion || state.wipe.age >= WIPE_SECONDS + SWAP_SECONDS) state.wipe = null;
}

function recompose(state, grid) {
  state.posterSeed = Math.floor(random(state.rng) * 2 ** 31);
  state.wipe = { previous: state.poster, age: 0 };
  state.poster = compose(grid, state.posterSeed);
  state.beats = 0;
  state.musicSeconds = 0;
  state.sinceTurn = 0;
}

// A few tiles turn on each beat and the lead answers every few beats, so the poster shifts but keeps its layout.
function turnTiles(state, count, onBeat) {
  const { modules } = state.poster;
  const candidates = modules.filter((module, index) => index > 0 && module.turnAge >= TURN_SECONDS);
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const [module] = candidates.splice(Math.floor(random(state.rng) * candidates.length), 1);
    // A circle looks the same at every angle, so it changes color instead.
    if (module.kind === 'disc') module.colors = [pickColor(state.rng, [...neighborColors(state.poster, module.place), module.colors[0]])];
    else startTurn(module, random(state.rng) < 0.5 ? -1 : 1);
  }
  state.sinceTurn = 0;
  if (onBeat && state.beats % LEAD_ACCENT_BEATS === 0) accentLead(modules[0]);
}

function accentLead(lead) {
  if (lead.kind === 'rings') lead.colors = [lead.colors[2], lead.colors[0], lead.colors[1]];
  else if (lead.turnAge >= TURN_SECONDS) startTurn(lead, 1);
}

function startTurn(module, direction) {
  module.turnFrom = module.turns;
  module.turns += direction;
  module.turnAge = 0;
}

// The lead module lands first at a random spot, then the rest of the grid fills in reading order with
// single cells and an occasional double, so every poster keeps the same strict modules.
function compose(grid, seed) {
  const rng = { seed };
  const poster = { key: grid.key, cols: grid.cols, rows: grid.rows, owners: new Int16Array(grid.cols * grid.rows).fill(-1), modules: [] };
  const span = leadSpan(grid);
  const lead = {
    col: Math.floor(random(rng) * (grid.cols - span + 1)),
    row: Math.floor(random(rng) * (grid.rows - span + 1)),
    spanX: span,
    spanY: span,
  };
  placeModule(poster, grid, rng, lead, LEAD_SHAPES[pickWeighted(rng, LEAD_WEIGHTS, [])], 3);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (poster.owners[row * grid.cols + col] !== -1) continue;
      const place = { col, row, ...spanAt(poster.owners, grid, rng, col, row) };
      const square = place.spanX === place.spanY;
      const kind = square ? SQUARE_SHAPES[pickWeighted(rng, SQUARE_WEIGHTS, [])] : LONG_SHAPES[pickWeighted(rng, LONG_WEIGHTS, [])];
      placeModule(poster, grid, rng, place, kind, 1);
    }
  }
  orderBands(poster.modules);
  return poster;
}

// The lead spans two cells, or three once the grid is five cells deep, so one shape always dominates.
function leadSpan(grid) {
  const shorter = Math.min(grid.cols, grid.rows);
  return shorter >= 5 ? 3 : Math.min(2, shorter);
}

function spanAt(owners, grid, rng, col, row) {
  const roll = random(rng);
  const rightFree = col + 1 < grid.cols && owners[row * grid.cols + col + 1] === -1;
  const belowFree = row + 1 < grid.rows && owners[(row + 1) * grid.cols + col] === -1;
  if (roll < WIDE_CHANCE && rightFree) return { spanX: 2, spanY: 1 };
  if (roll < WIDE_CHANCE + TALL_CHANCE && belowFree) return { spanX: 1, spanY: 2 };
  return { spanX: 1, spanY: 1 };
}

// Long modules lay out along their own x axis, so a tall one keeps its half sizes swapped.
function placeModule(poster, grid, rng, place, kind, colorCount) {
  const { col, row, spanX, spanY } = place;
  const index = poster.modules.length;
  const vertical = spanY > spanX;
  const halfWidth = (spanX * grid.cell - grid.gutter) / 2;
  const halfHeight = (spanY * grid.cell - grid.gutter) / 2;
  const x = grid.left + (col + spanX / 2) * grid.cell;
  const colors = [pickColor(rng, neighborColors(poster, place))];
  while (colors.length < colorCount) colors.push(pickWeighted(rng, COLOR_WEIGHTS, colors));
  const turns = Math.floor(random(rng) * (spanX === spanY ? 4 : 2));
  poster.modules.push({
    kind,
    place,
    colors,
    square: spanX === spanY,
    vertical,
    x,
    y: grid.top + (row + spanY / 2) * grid.cell,
    hw: vertical ? halfHeight : halfWidth,
    hh: vertical ? halfWidth : halfHeight,
    across: (x - grid.left) / (grid.cols * grid.cell),
    order: 0,
    turns,
    turnFrom: turns,
    turnAge: TURN_SECONDS,
  });
  for (let r = row; r < row + spanY; r++) {
    for (let c = col; c < col + spanX; c++) poster.owners[r * grid.cols + c] = index;
  }
}

// Every placed module that shares an edge keeps a different color, so no two neighbors merge into one block.
function neighborColors(poster, place) {
  const { col, row, spanX, spanY } = place;
  const colors = [];
  const visit = (c, r) => {
    if (c < 0 || r < 0 || c >= poster.cols || r >= poster.rows) return;
    const owner = poster.owners[r * poster.cols + c];
    if (owner !== -1) colors.push(poster.modules[owner].colors[0]);
  };
  for (let c = col; c < col + spanX; c++) {
    visit(c, row - 1);
    visit(c, row + spanY);
  }
  for (let r = row; r < row + spanY; r++) {
    visit(col - 1, r);
    visit(col + spanX, r);
  }
  return colors;
}

// A crowded corner can take every color, so the pick then ignores the neighbors.
function pickColor(rng, avoid) {
  const color = pickWeighted(rng, COLOR_WEIGHTS, avoid);
  return color === -1 ? pickWeighted(rng, COLOR_WEIGHTS, []) : color;
}

// Bands rise left to right across the small modules, so a melody reads as a wave crossing the poster.
function orderBands(modules) {
  const small = modules.slice(1).sort((a, b) => a.x - b.x || a.y - b.y);
  small.forEach((module, rank) => { module.order = rank / small.length; });
}

// Crosses sit only where gutters meet, so none lands inside a module that spans several cells.
function drawCrosses(ctx, frame, grid, poster, ink) {
  const { values } = frame;
  const { cols, rows, cell, left, top } = grid;
  const armPerLevel = grid.gutter / 2 + cell * CROSS_REACH;
  let shown = false;
  ctx.beginPath();
  for (let j = 1; j < rows; j++) {
    for (let i = 1; i < cols; i++) {
      if (insideModule(poster.owners, cols, i, j)) continue;
      const arm = armPerLevel * values[values.length - CROSS_BANDS + ((i + 2 * j) % CROSS_BANDS)];
      if (arm < MIN_SIZE_PX) continue;
      const x = left + i * cell;
      const y = top + j * cell;
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      shown = true;
    }
  }
  if (!shown) return false;
  ctx.lineWidth = Math.max(1, cell * CROSS_WIDTH);
  ctx.strokeStyle = rgba(ink, CROSS_ALPHA);
  ctx.stroke();
  return true;
}

function insideModule(owners, cols, i, j) {
  const owner = owners[(j - 1) * cols + i - 1];
  return owners[(j - 1) * cols + i] === owner && owners[j * cols + i - 1] === owner && owners[j * cols + i] === owner;
}

// Pieces that share a layer and a color fill as one path, so a frame makes only a handful of paint calls.
function drawPoster(ctx, frame, poster, colors, scaleOf, drive) {
  const pieces = collectPieces(frame, poster, scaleOf, drive);
  for (let layer = 0; layer < LAYERS; layer++) {
    for (let color = 0; color < colors.length; color++) fillPieces(ctx, pieces, layer, color, colors[color]);
  }
  return pieces.length > 0;
}

function collectPieces(frame, poster, scaleOf, drive) {
  const pieces = [];
  for (const module of poster.modules) {
    const scale = scaleOf(module);
    if (scale <= 0) continue;
    const reach = 2 * Math.max(module.hw, module.hh);
    for (const piece of piecesOf(module, frame, drive)) {
      const level = Math.min(1, piece.level * scale);
      if (level * reach >= MIN_SIZE_PX) pieces.push({ ...piece, level, module });
    }
  }
  return pieces;
}

// The lead answers the bass, the low mids and the kick, and every other module follows one band.
function piecesOf(module, frame, drive) {
  const { values } = frame;
  const [first, second, third] = module.colors;
  if (module.kind === 'rings') {
    const outer = sized(frame.bass, LEAD_BASE, drive.presence);
    const middle = outer * (0.4 + 0.3 * average(values, 4, 6));
    return [
      { layer: 0, color: first, shape: 'disc', level: outer },
      { layer: 1, color: second, shape: 'disc', level: middle },
      { layer: 2, color: third, shape: 'disc', level: middle * (0.3 + 0.4 * drive.kick) },
    ];
  }
  if (module.kind === 'split') {
    return [
      { layer: 0, color: first, shape: 'upper', level: sized(average(values, 0, 2), LEAD_BASE, drive.presence) },
      { layer: 0, color: second, shape: 'lower', level: sized(average(values, 2, 4), LEAD_BASE, drive.presence) },
    ];
  }
  const band = FIRST_SMALL_BAND + Math.floor(module.order * (values.length - FIRST_SMALL_BAND));
  return [{ layer: 0, color: first, shape: module.kind, level: sized(values[band], TILE_BASE, drive.presence) }];
}

// Every shape keeps a base size while music plays, so the poster holds its composition and the band pulses on top.
function sized(level, base, presence) {
  const lifted = (Math.max(0, level - LEVEL_FLOOR) / (1 - LEVEL_FLOOR)) ** LEVEL_CURVE;
  return presence * (base + (1 - base) * lifted);
}

function fillPieces(ctx, pieces, layer, color, rgb) {
  let added = 0;
  ctx.beginPath();
  for (const piece of pieces) {
    if (piece.layer === layer && piece.color === color && addPiece(ctx, piece)) added += 1;
  }
  if (added === 0) return;
  ctx.fillStyle = rgba(rgb, 1);
  ctx.fill();
}

// The transform applies as each point is added, so pieces in different poses still share one path.
function addPiece(ctx, piece) {
  const { module } = piece;
  const pose = poseOf(module);
  if (pose === null) return false;
  ctx.save();
  ctx.translate(module.x, module.y);
  if (module.vertical) ctx.transform(0, 1, -1, 0, 0, 0);
  ctx.transform(pose[0], pose[1], pose[2], pose[3], 0, 0);
  addShape(ctx, piece.shape, module.hw, module.hh, piece.level);
  ctx.restore();
  return true;
}

// A square tile shrinks while it is between quarter turns, so its corners never leave the cell.
// A long tile cannot turn inside its cell, so it flips across its axis instead.
function poseOf(module) {
  const progress = Math.min(1, module.turnAge / TURN_SECONDS);
  const position = module.turnFrom + (module.turns - module.turnFrom) * easeOutBack(progress);
  if (module.square) {
    const angle = (position * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const fit = 1 / (Math.abs(cos) + Math.abs(sin));
    return [cos * fit, sin * fit, -sin * fit, cos * fit];
  }
  const mirror = Math.cos(position * Math.PI);
  if (Math.abs(mirror) < EDGE_ON) return null;
  return module.kind === 'bar' ? [mirror, 0, 0, 1] : [1, 0, 0, mirror];
}

// Every shape fits the box from -hw to hw and -hh to hh at full level, so a module never crosses its gutter.
function addShape(ctx, shape, hw, hh, level) {
  switch (shape) {
    case 'disc': addDisc(ctx, Math.min(hw, hh) * level); break;
    case 'half': addHalf(ctx, hh, Math.min(hw, 2 * hh) * level); break;
    case 'quarter': addQuarter(ctx, hw, hh, 2 * Math.min(hw, hh) * level); break;
    case 'triangle': addTriangle(ctx, hw, hh, level); break;
    case 'stack': addStack(ctx, hw, hh, level); break;
    case 'bar': addBar(ctx, hw, hh, level); break;
    case 'upper': addSplitHalf(ctx, hw, hh, level, true); break;
    case 'lower': addSplitHalf(ctx, hw, hh, level, false); break;
    default: break;
  }
}

function addDisc(ctx, radius) {
  ctx.moveTo(radius, 0);
  addArc(ctx, 0, 0, radius, 0, 4);
  ctx.closePath();
}

// A half circle standing on the bottom edge, the arch of Bauhaus tile work.
function addHalf(ctx, hh, radius) {
  ctx.moveTo(-radius, hh);
  addArc(ctx, 0, hh, radius, 2, 2);
  ctx.closePath();
}

// A quarter circle pivoting on the bottom left corner, so it sweeps across the cell as it grows.
function addQuarter(ctx, hw, hh, radius) {
  ctx.moveTo(-hw, hh);
  ctx.lineTo(-hw, hh - radius);
  addArc(ctx, -hw, hh, radius, 3, 1);
  ctx.closePath();
}

function addTriangle(ctx, hw, hh, level) {
  ctx.moveTo(-hw * level, hh * level);
  ctx.lineTo(hw * level, hh * level);
  ctx.lineTo(0, -hh * level);
  ctx.closePath();
}

// Three rules of falling length, the stepped bars of a Swiss layout.
function addStack(ctx, hw, hh, level) {
  const thickness = 2 * hh * STACK_THICKNESS * barWeight(level);
  STACK_LENGTHS.forEach((length, k) => {
    ctx.rect(-hw, (k - 1) * hh * STACK_SPACING - thickness / 2, 2 * hw * level * length, thickness);
  });
}

function addBar(ctx, hw, hh, level) {
  const thickness = 2 * hh * BAR_THICKNESS * barWeight(level);
  ctx.rect(-hw, -thickness / 2, 2 * hw * level, thickness);
}

// A bar holds its weight while music plays and thins only below the base size, so a fade or a wipe leaves no sliver.
function barWeight(level) {
  return Math.min(1, level / TILE_BASE);
}

function addSplitHalf(ctx, hw, hh, level, upper) {
  const outer = Math.min(hw, hh);
  const gap = (outer * SPLIT_GAP) / 2;
  const radius = (outer - gap) * level;
  const centerY = upper ? -gap : gap;
  ctx.moveTo(upper ? -radius : radius, centerY);
  addArc(ctx, 0, centerY, radius, upper ? 2 : 0, 2);
  ctx.closePath();
}

// Each quadrant runs clockwise on screen from its start angle, continuing from the current point.
function addArc(ctx, centerX, centerY, radius, firstQuadrant, quadrants) {
  const handle = KAPPA * radius;
  for (let q = firstQuadrant; q < firstQuadrant + quadrants; q++) {
    const [startCos, startSin] = QUADRANTS[q % 4];
    const [endCos, endSin] = QUADRANTS[(q + 1) % 4];
    ctx.bezierCurveTo(
      centerX + radius * startCos - handle * startSin,
      centerY + radius * startSin + handle * startCos,
      centerX + radius * endCos + handle * endSin,
      centerY + radius * endSin - handle * endCos,
      centerX + radius * endCos,
      centerY + radius * endSin,
    );
  }
}

// Old modules shrink out ahead of the sweep and new ones grow in behind it, each at its own place across the grid.
function outgoingScale(module, wipe) {
  const progress = swapProgress(module, wipe);
  if (progress >= 0.5) return 0;
  const shrink = Math.max(0, progress) * 2;
  return 1 - shrink * shrink;
}

function incomingScale(module, wipe) {
  if (wipe === null) return 1;
  const progress = swapProgress(module, wipe);
  if (progress <= 0.5) return 0;
  return easeOutBack(Math.min(1, (progress - 0.5) * 2));
}

function swapProgress(module, wipe) {
  return (wipe.age - module.across * WIPE_SECONDS) / SWAP_SECONDS;
}

function easeOutBack(t) {
  const u = t - 1;
  return 1 + (OVERSHOOT + 1) * u * u * u + OVERSHOOT * u * u;
}

// Mulberry32, so a poster seed always lays out the same composition.
function random(rng) {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pickWeighted(rng, weights, excluded) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) if (!excluded.includes(i)) total += weights[i];
  let roll = random(rng) * total;
  let chosen = -1;
  for (let i = 0; i < weights.length && roll >= 0; i++) {
    if (excluded.includes(i)) continue;
    chosen = i;
    roll -= weights[i];
  }
  return chosen;
}

export default { label: 'Bauhaus grid', draw };
