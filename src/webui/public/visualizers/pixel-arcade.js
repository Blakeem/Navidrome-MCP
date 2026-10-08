import { average, detectBeat, resample } from '../visualizer-kit.js';

// The shorter side spans about this many art pixels, so the sprites stay chunky at every size.
const ART_PIXELS_ACROSS = 64;
const MIN_PIXEL = 2;
// Keeps the rounded origin of the art clear of the pad.
const EDGE_MARGIN = 1;
const MAX_COLUMNS = 16;
const MAX_ROWS = 3;
// Each invader sits in a box as wide as the widest sprite, the way the arcade grid spaces them.
const SPRITE_BOX = 12;
const SPRITE_HEIGHT = 8;
// Every sprite covers this pixel of its box, so a shot aimed there always lands.
const BOX_CENTER = 5;
const COLUMN_PITCH = 15;
const ROW_GAP = 2;
const MARCH_MIN = 2;
const MARCH_MAX = 12;
const LANE_MIN = 3;
const LANE_MAX = 12;
const UFO_GAP = 2;
// The scene height that keeps shards at full speed, so the phone strip gets bursts that fit it.
const FULL_SCENE_ROWS = 52;
// Without a detected beat the formation still steps this often, so a quiet passage keeps marching.
const IDLE_STEP_S = 0.7;
// The fraction of the field the cannon crosses per second.
const CANNON_SPEED = 0.5;
const CANNON_TURRET = 5;
const CANNON_HIT_S = 0.5;
// Speeds are in art pixels per second. A fast bolt keeps each firework close to its beat.
const BOLT_SPEED = 200;
const BOLT_LENGTH = 4;
const MAX_BOLTS = 4;
// An invader counts as standing for shots and bombs once this much of it has dithered in.
const HIT_MIN = 0.45;
const EXPLODE_S = 0.28;
const BOMB_SPEED = 42;
const BOMB_FLIP_S = 0.09;
const MAX_BOMBS = 4;
const HAT_FIRST_BAND = 11;
const HAT_WINDOW_S = 0.05;
const HAT_RISE = 0.1;
const HAT_GAP_S = 0.2;
// Sixteen beats are four bars of common time, so the UFO marks each phrase.
const UFO_EVERY_BEATS = 16;
const UFO_CROSS_S = 4;
const UFO_FADE_S = 0.35;
const UFO_BLINK_S = 0.15;
// The cannon lets the UFO show itself before it takes aim.
const UFO_AIM_DELAY_S = 0.8;
const BLINK_S = 0.06;
const RECOIL_BASS = 0.7;
const RECOIL_S = 0.08;
const SHARD_SPEED = 34;
const SHARD_LIFT = 10;
const SHARD_GRAVITY = 60;
const SHARD_DRAG = 1.6;
const SHARD_LIFE_S = 0.8;
// A shard flashes white, burns in its invader's color, then cools to an ember at these fractions of its life.
const SHARD_FLASH = 0.12;
const SHARD_EMBER = 0.62;
const SHARD_TRAIL_S = 0.035;
const BURST_BASE = 10;
const BURST_BASS = 14;
const SPLASH_SHARDS = 5;
const MAX_SHARDS = 180;
// The fraction of presence left one second after the music stops.
const PRESENCE_RETAIN = 0.02;
const PRESENCE_GAIN = 5;
const MIN_PRESENCE = 0.02;
// About one bloom texel per two art pixels, so the upscaled copy spreads each pixel's glow onto its neighbors.
const BLOOM_TEXELS_PER_PIXEL = 0.5;
const BLOOM_ALPHA = 0.5;
// A one pixel scanline would cover too much of a smaller art pixel.
const SCANLINE_MIN_PIXEL = 3;
const SCANLINE_ALPHA = 0.28;
const SHADOW_ALPHA = 0.22;
const SHADOW_COLOR = '#1d2b53';

// An ordered dither, so a partly lit invader materializes pixel by pixel the way 8-bit fades did.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((rank) => (rank + 0.5) / 16);
const BAYER_MIN = BAYER[0];

// The PICO-8 palette. The light theme takes its deeper entries, since the bright yellows vanish on white.
const PALETTES = {
  dark: {
    squid: '#ff77a8', crab: '#29adff', octopus: '#ffec27', cannon: '#00e436',
    shot: '#fff1e8', bomb: '#ffa300', ufo: '#ff004d', flash: '#fff1e8', ember: '#7e2553',
  },
  light: {
    squid: '#be1250', crab: '#065ab5', octopus: '#008751', cannon: '#1d2b53',
    shot: '#1d2b53', bomb: '#ff6c24', ufo: '#ff004d', flash: '#1d2b53', ember: '#c2c3c7',
  },
};
const UFO_BURST = ['squid', 'crab', 'octopus', 'cannon', 'bomb', 'ufo'];

const SQUID = sprite(
  ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'],
  ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', 'X......X', '.X....X.'],
);
const CRAB = sprite(
  ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
  ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.'],
);
const OCTOPUS = sprite(
  ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'],
  ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '..XXX..XXX..', '.XX..XX..XX.', '..XX....XX..'],
);
const EXPLOSION = sprite(
  ['.....XX.....', '.X...XX...X.', '..X......X..', '...X....X...', 'XXX......XXX', '...X....X...', '..X..XX..X..', '.X...XX...X.'],
);
const CANNON = sprite(['.....X.....', '....XXX....', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', 'XXXXXXXXXXX']);
const UFO = sprite(
  ['.....XXXXXX.....', '...XXXXXXXXXX...', '..XXXXXXXXXXXX..', '.XX.XX.XX.XX.XX.', 'XXXXXXXXXXXXXXXX', '..XXX..XX..XXX..', '...X........X...'],
  ['.....XXXXXX.....', '...XXXXXXXXXX...', '..XXXXXXXXXXXX..', '.X.XX.XX.XX.XX..', 'XXXXXXXXXXXXXXXX', '..XXX..XX..XXX..', '...X........X...'],
);
const BOMB = sprite(['.X.', 'X..', '.X.', '..X', '.X.', 'X..'], ['.X.', '..X', '.X.', 'X..', '.X.', '..X']);
const INVADERS = { squid: SQUID, crab: CRAB, octopus: OCTOPUS };
// Rows from the top, by how many fit. The arcade puts squids on top and octopuses at the base.
const ROW_KINDS = [[], ['crab'], ['crab', 'octopus'], ['squid', 'crab', 'octopus']];

/** An invader formation whose columns fill with the spectrum, march on the beat and burst into pixel fireworks. */
function draw(ctx, frame) {
  const { state } = frame;
  const layout = layoutFor(state, frame);
  const beat = detectBeat(state, frame);
  const hat = detectHiHat(state, frame);
  const presence = updatePresence(state, frame);
  if (layout === null || presence < MIN_PRESENCE) {
    state.game = null;
    return false;
  }
  const levels = resample(frame.values, layout.columns);
  const game = (state.game ??= newGame());
  advance(game, layout, frame, levels, beat, hat);
  const batch = paintScene(game, layout, levels, PALETTES[frame.theme] ?? PALETTES.dark, presence);
  if (batch.lists.size === 0) return false;
  present(ctx, frame, layout, sceneLayers(state, frame, layout), batch);
  // Shards and dissolving invaders outlast the music, so the host keeps drawing until they clear.
  return true;
}

// Parses rows of X and dots into horizontal runs for solid sprites and single pixels for dithered ones.
function sprite(...frames) {
  const parsed = frames.map((rows) => {
    const runs = [];
    const pixels = [];
    rows.forEach((row, y) => {
      let start = -1;
      for (let x = 0; x <= row.length; x++) {
        const on = row[x] === 'X';
        if (on) pixels.push(x, y);
        if (on && start === -1) start = x;
        if (!on && start !== -1) {
          runs.push(start, y, x - start);
          start = -1;
        }
      }
    });
    return { runs, pixels };
  });
  return { width: frames[0][0].length, height: frames[0].length, frames: parsed };
}

// detectBeat listens to every band, so the hi-hats that drop bombs get their own rise test on the top bands.
function detectHiHat(state, frame) {
  const hat = (state.hiHat ??= { sinceSample: HAT_WINDOW_S, sinceHit: HAT_GAP_S, previous: null });
  hat.sinceSample += frame.dtSeconds;
  hat.sinceHit += frame.dtSeconds;
  if (hat.sinceSample < HAT_WINDOW_S) return false;
  const treble = average(frame.values, HAT_FIRST_BAND, frame.values.length);
  const rise = treble - (hat.previous ?? treble);
  hat.previous = treble;
  hat.sinceSample = 0;
  if (rise <= HAT_RISE || hat.sinceHit < HAT_GAP_S) return false;
  hat.sinceHit = 0;
  return true;
}

// Presence follows the music up at once and lingers after it, so actors dissolve instead of vanishing.
function updatePresence(state, frame) {
  const target = Math.min(1, frame.energy * PRESENCE_GAIN);
  state.presence = Math.max(target, (state.presence ?? 0) * PRESENCE_RETAIN ** frame.dtSeconds);
  return state.presence;
}

function layoutFor(state, frame) {
  const cached = state.layout;
  if (cached !== undefined && cached.width === frame.width && cached.height === frame.height) return cached.scene;
  state.layout = { width: frame.width, height: frame.height, scene: buildLayout(frame) };
  state.layers = null;
  state.game = null;
  return state.layout.scene;
}

// Tries the chunkiest art pixel first and shrinks it until the scene fits.
function buildLayout(frame) {
  const { width, height, pad } = frame;
  const innerWidth = width - 2 * (pad + EDGE_MARGIN);
  const innerHeight = height - 2 * (pad + EDGE_MARGIN);
  for (let px = Math.max(MIN_PIXEL, Math.round(Math.min(width, height) / ART_PIXELS_ACROSS)); px >= 1; px--) {
    const scene = fitScene(Math.floor(innerWidth / px), Math.floor(innerHeight / px));
    if (scene === null) continue;
    return { ...scene, px, originX: Math.round((width - scene.artW * px) / 2), originY: Math.round((height - scene.artH * px) / 2) };
  }
  return null;
}

// The top row stays free for the recoil, and the last row and column for the light theme's shadow.
function fitScene(artW, artH) {
  const limitX = artW - 1;
  const limitY = artH - 1;
  const usable = limitY - 1;
  const columns = Math.min(MAX_COLUMNS, Math.floor((limitX - 2 * MARCH_MIN - SPRITE_BOX) / COLUMN_PITCH) + 1);
  const rows = Math.min(MAX_ROWS, Math.floor((usable - CANNON.height - LANE_MIN + ROW_GAP) / (SPRITE_HEIGHT + ROW_GAP)));
  if (columns < 1 || rows < 1) return null;
  const formationWidth = (columns - 1) * COLUMN_PITCH + SPRITE_BOX;
  const formationHeight = rows * SPRITE_HEIGHT + (rows - 1) * ROW_GAP;
  const ufoRows = usable - formationHeight - LANE_MIN - CANNON.height >= UFO.height + UFO_GAP ? UFO.height + UFO_GAP : 0;
  const lane = Math.min(LANE_MAX, usable - formationHeight - CANNON.height - ufoRows);
  const top = 1 + Math.floor((usable - ufoRows - formationHeight - lane - CANNON.height) / 2);
  const formationTop = top + ufoRows;
  const formationLeft = Math.floor((limitX - formationWidth) / 2);
  return {
    artW,
    artH,
    limitX,
    limitY,
    columns,
    rows,
    rowKinds: ROW_KINDS[rows],
    rowTops: Array.from({ length: rows }, (_, row) => formationTop + row * (SPRITE_HEIGHT + ROW_GAP)),
    formationLeft,
    marchRange: Math.min(MARCH_MAX, formationLeft, limitX - formationWidth - formationLeft),
    ufoY: ufoRows > 0 ? top : null,
    cannonY: formationTop + formationHeight + lane,
    motionScale: Math.min(1, usable / FULL_SCENE_ROWS),
  };
}

function newGame() {
  return {
    march: 0,
    direction: 1,
    legs: 0,
    dip: 0,
    sinceStep: 0,
    beats: 0,
    cannonX: null,
    cannonHit: 0,
    recoil: 0,
    ufo: null,
    ufoFromLeft: false,
    bolts: [],
    bombs: [],
    shards: [],
    explosions: [],
  };
}

function advance(game, layout, frame, levels, beat, hat) {
  aimCannon(game, layout, frame, levels);
  // Reduced motion keeps only what the levels move, the formation's fill and the cannon's column.
  if (frame.reducedMotion) {
    clearActors(game);
    return;
  }
  const dt = frame.dtSeconds;
  game.recoil = Math.max(0, game.recoil - dt);
  game.cannonHit = Math.max(0, game.cannonHit - dt);
  stepFormation(game, layout, dt, beat);
  if (beat) onBeat(game, layout, frame);
  if (hat) dropBomb(game, layout, levels);
  moveBolts(game, layout, levels, frame.bass, dt);
  moveBombs(game, layout, dt);
  moveShards(game, layout, dt);
  ageExplosions(game, dt);
  moveUfo(game, dt);
}

function clearActors(game) {
  game.bolts = [];
  game.bombs = [];
  game.shards = [];
  game.explosions = [];
  game.ufo = null;
  game.recoil = 0;
  game.cannonHit = 0;
  game.dip = 0;
}

// The formation steps and flips its legs on each beat, the way the arcade march kept time with its bass notes.
function stepFormation(game, layout, dt, beat) {
  game.sinceStep += dt;
  if (!beat && game.sinceStep < IDLE_STEP_S) return;
  game.sinceStep = 0;
  game.legs = 1 - game.legs;
  const next = game.march + game.direction;
  if (Math.abs(next) <= layout.marchRange) {
    game.march = next;
    game.dip = 0;
    return;
  }
  // At each end the arcade formation steps down instead of across. Lacking room, it rises back on the next step.
  if (game.dip === 0) game.direction = -game.direction;
  game.dip = 1 - game.dip;
}

function onBeat(game, layout, frame) {
  game.beats += 1;
  if (game.bolts.length < MAX_BOLTS) {
    game.bolts.push({ x: Math.round(game.cannonX), y: layout.cannonY - BOLT_LENGTH, atUfo: ufoInSights(game) });
  }
  if (frame.bass > RECOIL_BASS) game.recoil = RECOIL_S;
  if (layout.ufoY !== null && game.ufo === null && game.beats % UFO_EVERY_BEATS === 0) launchUfo(game, layout);
}

function aimCannon(game, layout, frame, levels) {
  const target = cannonTarget(game, layout, levels);
  if (game.cannonX === null || frame.reducedMotion) {
    game.cannonX = target;
    return;
  }
  const reach = CANNON_SPEED * layout.limitX * frame.dtSeconds;
  game.cannonX += Math.max(-reach, Math.min(reach, target - game.cannonX));
}

// The cannon guards the loudest column, and leads a UFO by the bolt's flight time.
function cannonTarget(game, layout, levels) {
  if (!ufoInSights(game)) return boxLeft(layout, game, loudestColumn(levels, 0)) + BOX_CENTER;
  const flight = (layout.cannonY - layout.ufoY) / BOLT_SPEED;
  const lead = game.ufo.x + UFO.width / 2 + game.ufo.direction * game.ufo.speed * flight;
  return Math.max(CANNON_TURRET, Math.min(layout.limitX - CANNON.width + CANNON_TURRET, lead));
}

function moveBolts(game, layout, levels, bass, dt) {
  const flying = [];
  for (const bolt of game.bolts) {
    bolt.y -= BOLT_SPEED * dt;
    const struck = (!bolt.atUfo && strikeInvader(game, layout, levels, bolt, bass)) || strikeUfo(game, layout, bolt, bass);
    if (!struck && bolt.y + BOLT_LENGTH > 0) flying.push(bolt);
  }
  game.bolts = flying;
}

// A bolt strikes the crown of its column, so each beat's firework bursts at the top of the spectrum.
function strikeInvader(game, layout, levels, bolt, bass) {
  const column = columnUnder(layout, game, bolt.x);
  const row = column === -1 ? -1 : crownRow(game, layout, levels, column);
  if (row === -1) return false;
  const top = layout.rowTops[row] + game.dip;
  if (bolt.y > top + SPRITE_HEIGHT / 2) return false;
  const left = boxLeft(layout, game, column);
  game.explosions.push({ x: left, y: top, age: 0, column, row });
  burst(game, layout, left + SPRITE_BOX / 2, top + SPRITE_HEIGHT / 2, [layout.rowKinds[row]], BURST_BASE + BURST_BASS * bass, 1);
  return true;
}

function strikeUfo(game, layout, bolt, bass) {
  const { ufo } = game;
  if (ufo === null || layout.ufoY === null || ufoFade(ufo) < HIT_MIN) return false;
  const left = Math.round(ufo.x);
  if (bolt.x < left || bolt.x >= left + UFO.width || bolt.y > layout.ufoY + UFO.height / 2) return false;
  game.explosions.push({ x: left + (UFO.width - SPRITE_BOX) / 2, y: layout.ufoY, age: 0, column: -1, row: -1 });
  burst(game, layout, left + UFO.width / 2, layout.ufoY + UFO.height / 2, UFO_BURST, 2 * (BURST_BASE + BURST_BASS * bass), 1.3);
  game.recoil = RECOIL_S;
  game.ufo = null;
  return true;
}

// Bombs fall from the base of the loudest treble column, the bands where the hi-hats live.
function dropBomb(game, layout, levels) {
  if (game.bombs.length >= MAX_BOMBS) return;
  const column = loudestColumn(levels, Math.floor(layout.columns / 2));
  const row = layout.rows - 1;
  if (litFraction(levels[column], layout.rows, row) < HIT_MIN || isExploding(game, column, row)) return;
  game.bombs.push({ x: boxLeft(layout, game, column) + BOX_CENTER - 1, y: layout.rowTops[row] + game.dip + SPRITE_HEIGHT, age: 0 });
}

function moveBombs(game, layout, dt) {
  const falling = [];
  for (const bomb of game.bombs) {
    bomb.age += dt;
    bomb.y += BOMB_SPEED * dt;
    const center = bomb.x + 1;
    const onCannon = Math.abs(center - game.cannonX) <= CANNON_TURRET;
    const floor = onCannon ? layout.cannonY : layout.cannonY + CANNON.height;
    if (bomb.y + BOMB.height < floor) {
      falling.push(bomb);
      continue;
    }
    if (onCannon) game.cannonHit = CANNON_HIT_S;
    burst(game, layout, center, floor - 1, ['bomb'], onCannon ? 2 * SPLASH_SHARDS : SPLASH_SHARDS, 0.5);
  }
  game.bombs = falling;
}

function burst(game, layout, x, y, colors, count, speedScale) {
  const total = Math.round(count);
  const speed = SHARD_SPEED * speedScale * layout.motionScale;
  for (let i = 0; i < total; i++) {
    // Alternate shards take an inner ring, so the burst opens as a filled flower instead of a hollow ring.
    const ring = i % 2 === 0 ? 1 : 0.55;
    const angle = (i / total) * Math.PI * 2 + Math.random() * 0.3;
    const velocity = speed * ring * (0.85 + 0.3 * Math.random());
    game.shards.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - SHARD_LIFT * layout.motionScale,
      age: 0,
      life: SHARD_LIFE_S * (0.75 + 0.5 * Math.random()),
      color: colors[i % colors.length],
    });
  }
  if (game.shards.length > MAX_SHARDS) game.shards.splice(0, game.shards.length - MAX_SHARDS);
}

function moveShards(game, layout, dt) {
  const drag = Math.exp(-SHARD_DRAG * dt);
  const gravity = SHARD_GRAVITY * layout.motionScale * dt;
  const alive = [];
  for (const shard of game.shards) {
    shard.age += dt;
    shard.vx *= drag;
    shard.vy = shard.vy * drag + gravity;
    shard.x += shard.vx * dt;
    shard.y += shard.vy * dt;
    if (shard.age < shard.life && shard.x >= 0 && shard.x < layout.limitX && shard.y < layout.limitY) alive.push(shard);
  }
  game.shards = alive;
}

function ageExplosions(game, dt) {
  for (const explosion of game.explosions) explosion.age += dt;
  game.explosions = game.explosions.filter((explosion) => explosion.age < EXPLODE_S);
}

// The UFO alternates sides and dithers in and out, so it never slides through a hard edge.
function launchUfo(game, layout) {
  const travel = layout.limitX - UFO.width;
  if (travel <= 0) return;
  game.ufoFromLeft = !game.ufoFromLeft;
  game.ufo = { x: game.ufoFromLeft ? 0 : travel, direction: game.ufoFromLeft ? 1 : -1, speed: travel / UFO_CROSS_S, age: 0 };
}

function moveUfo(game, dt) {
  const { ufo } = game;
  if (ufo === null) return;
  ufo.age += dt;
  ufo.x += ufo.direction * ufo.speed * dt;
  if (ufo.age >= UFO_CROSS_S) game.ufo = null;
}

function ufoFade(ufo) {
  return Math.max(0, Math.min(1, ufo.age / UFO_FADE_S, (UFO_CROSS_S - ufo.age) / UFO_FADE_S));
}

function ufoInSights(game) {
  return game.ufo !== null && game.ufo.age > UFO_AIM_DELAY_S;
}

function boxLeft(layout, game, column) {
  return layout.formationLeft + game.march + column * COLUMN_PITCH;
}

function columnUnder(layout, game, x) {
  const offset = x - layout.formationLeft - game.march;
  const column = Math.floor(offset / COLUMN_PITCH);
  if (column < 0 || column >= layout.columns || offset - column * COLUMN_PITCH >= SPRITE_BOX) return -1;
  return column;
}

function loudestColumn(levels, from) {
  let loudest = from;
  for (let column = from + 1; column < levels.length; column++) if (levels[column] > levels[loudest]) loudest = column;
  return loudest;
}

// The top standing invader of a column, counted from the top row.
function crownRow(game, layout, levels, column) {
  for (let row = 0; row < layout.rows; row++) {
    if (litFraction(levels[column], layout.rows, row) >= HIT_MIN && !isExploding(game, column, row)) return row;
  }
  return -1;
}

// A column fills from its base, one invader per 1 / rows of its band's level.
function litFraction(level, rows, row) {
  return Math.max(0, Math.min(1, level * rows - (rows - 1 - row)));
}

function isExploding(game, column, row) {
  return game.explosions.some((explosion) => explosion.column === column && explosion.row === row);
}

function paintScene(game, layout, levels, colors, presence) {
  const batch = { limitX: layout.limitX, limitY: layout.limitY, shiftY: game.recoil > 0 ? -1 : 0, lists: new Map() };
  paintUfo(batch, game, layout, colors, presence);
  paintFormation(batch, game, layout, levels, colors);
  paintCannon(batch, game, layout, colors, presence);
  for (const bomb of game.bombs) {
    drawSprite(batch, BOMB, Math.floor(bomb.age / BOMB_FLIP_S), bomb.x, Math.round(bomb.y), colors.bomb, presence);
  }
  for (const bolt of game.bolts) {
    for (let k = 0; k < BOLT_LENGTH; k++) plotDithered(batch, colors.shot, bolt.x, Math.round(bolt.y) + k, presence);
  }
  for (const explosion of game.explosions) {
    const fade = Math.min(1, 2 * (1 - explosion.age / EXPLODE_S));
    drawSprite(batch, EXPLOSION, 0, explosion.x, explosion.y, colors.flash, presence * fade);
  }
  paintShards(batch, game, colors, presence);
  return batch;
}

function paintUfo(batch, game, layout, colors, presence) {
  const { ufo } = game;
  if (ufo === null || layout.ufoY === null) return;
  drawSprite(batch, UFO, Math.floor(ufo.age / UFO_BLINK_S), Math.round(ufo.x), layout.ufoY, colors.ufo, presence * ufoFade(ufo));
}

function paintFormation(batch, game, layout, levels, colors) {
  layout.rowKinds.forEach((kind, row) => {
    const invader = INVADERS[kind];
    const inset = Math.floor((SPRITE_BOX - invader.width) / 2);
    const top = layout.rowTops[row] + game.dip;
    for (let column = 0; column < layout.columns; column++) {
      if (isExploding(game, column, row)) continue;
      const fraction = litFraction(levels[column], layout.rows, row);
      drawSprite(batch, invader, game.legs, boxLeft(layout, game, column) + inset, top, colors[kind], fraction);
    }
  });
}

function paintCannon(batch, game, layout, colors, presence) {
  // A bombed cannon blinks, as the arcade's did between lives.
  if (game.cannonHit > 0 && Math.floor(game.cannonHit / BLINK_S) % 2 === 1) return;
  drawSprite(batch, CANNON, 0, Math.round(game.cannonX) - CANNON_TURRET, layout.cannonY, colors.cannon, presence);
}

function paintShards(batch, game, colors, presence) {
  for (const shard of game.shards) {
    const progress = shard.age / shard.life;
    const x = Math.floor(shard.x);
    const y = Math.floor(shard.y);
    if (progress >= SHARD_EMBER) {
      // Cooling embers flicker the way arcade sprites did when too many shared a scanline.
      if (Math.floor(shard.age / BLINK_S) % 2 === 0) plotDithered(batch, colors.ember, x, y, presence);
      continue;
    }
    const tailX = Math.floor(shard.x - shard.vx * SHARD_TRAIL_S);
    const tailY = Math.floor(shard.y - shard.vy * SHARD_TRAIL_S);
    if (tailX !== x || tailY !== y) plotDithered(batch, colors.ember, tailX, tailY, presence);
    plotDithered(batch, progress < SHARD_FLASH ? colors.flash : colors[shard.color], x, y, presence);
  }
}

function drawSprite(batch, shape, frameIndex, x, y, color, fraction) {
  if (fraction <= BAYER_MIN) return;
  const art = shape.frames[frameIndex % shape.frames.length];
  if (fraction >= 1) {
    for (let i = 0; i < art.runs.length; i += 3) plot(batch, color, x + art.runs[i], y + art.runs[i + 1], art.runs[i + 2]);
    return;
  }
  for (let i = 0; i < art.pixels.length; i += 2) plotDithered(batch, color, x + art.pixels[i], y + art.pixels[i + 1], fraction);
}

function plotDithered(batch, color, x, y, fraction) {
  if (fraction >= 1 || fraction > BAYER[((y & 3) << 2) | (x & 3)]) plot(batch, color, x, y, 1);
}

// Every pixel of one color joins one path, and the clip keeps the art inside its reserved rows and column.
function plot(batch, color, x, y, width) {
  const top = y + batch.shiftY;
  const left = Math.max(0, x);
  const right = Math.min(batch.limitX, x + width);
  if (right <= left || top < 0 || top >= batch.limitY) return;
  let list = batch.lists.get(color);
  if (list === undefined) {
    list = [];
    batch.lists.set(color, list);
  }
  list.push(left, top, right - left);
}

// The art layer holds one device pixel per art pixel, so every pixel stays square and sharp at any device scale.
function sceneLayers(state, frame, layout) {
  if (state.layers) return state.layers;
  const probe = frame.createLayer(layout.artW, 1);
  const unit = layout.artW / probe.canvas.width;
  const artWidth = layout.artW * unit;
  const artHeight = layout.artH * unit;
  const bloomWidth = Math.max(1, artWidth * BLOOM_TEXELS_PER_PIXEL);
  const bloomHeight = Math.max(1, artHeight * BLOOM_TEXELS_PER_PIXEL);
  const bloom = frame.createLayer(bloomWidth, bloomHeight);
  // A plain bilinear shrink skips lone pixels, which would leave single shards without a glow.
  bloom.ctx.imageSmoothingQuality = 'high';
  state.layers = {
    unit,
    art: frame.createLayer(artWidth, artHeight),
    shade: frame.createLayer(artWidth, artHeight),
    bloom: { ...bloom, width: bloomWidth, height: bloomHeight },
  };
  return state.layers;
}

function present(ctx, frame, layout, layers, batch) {
  const box = { x: layout.originX, y: layout.originY, width: layout.artW * layout.px, height: layout.artH * layout.px };
  renderArt(layers, layout, batch);
  ctx.imageSmoothingEnabled = false;
  if (frame.theme === 'light') {
    castShadow(ctx, layers, layout, box);
    ctx.drawImage(layers.art.canvas, box.x, box.y, box.width, box.height);
    return;
  }
  ctx.drawImage(layers.art.canvas, box.x, box.y, box.width, box.height);
  addBloom(ctx, layers, box);
  addScanlines(ctx, layout, box);
}

function renderArt(layers, layout, batch) {
  const c = layers.art.ctx;
  c.save();
  c.scale(layers.unit, layers.unit);
  c.clearRect(0, 0, layout.artW, layout.artH);
  for (const [color, list] of batch.lists) {
    c.fillStyle = color;
    c.beginPath();
    for (let i = 0; i < list.length; i += 3) c.rect(list[i], list[i + 1], list[i + 2], 1);
    c.fill();
  }
  c.restore();
}

// On white, a navy silhouette half a pixel down and right lifts the sprites off the card like a printed label.
function castShadow(ctx, layers, layout, box) {
  const c = layers.shade.ctx;
  const offset = Math.max(1, Math.round(layout.px / 2));
  c.save();
  c.scale(layers.unit, layers.unit);
  c.clearRect(0, 0, layout.artW, layout.artH);
  c.drawImage(layers.art.canvas, 0, 0, layout.artW, layout.artH);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = SHADOW_COLOR;
  c.fillRect(0, 0, layout.artW, layout.artH);
  c.restore();
  ctx.globalAlpha = SHADOW_ALPHA;
  ctx.drawImage(layers.shade.canvas, box.x + offset, box.y + offset, box.width, box.height);
  ctx.globalAlpha = 1;
}

// On the dark card, a small copy scaled back up with smoothing glows like phosphor around each pixel.
function addBloom(ctx, layers, box) {
  const { bloom } = layers;
  bloom.ctx.clearRect(0, 0, bloom.width, bloom.height);
  bloom.ctx.drawImage(layers.art.canvas, 0, 0, bloom.width, bloom.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = BLOOM_ALPHA;
  ctx.drawImage(bloom.canvas, box.x, box.y, box.width, box.height);
  ctx.restore();
}

// Erasing a thin line under each art row reads as a CRT's scanlines on the dark card.
function addScanlines(ctx, layout, box) {
  if (layout.px < SCANLINE_MIN_PIXEL) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0, 0, 0, ${SCANLINE_ALPHA})`;
  ctx.beginPath();
  for (let row = 1; row <= layout.artH; row++) ctx.rect(box.x, box.y + row * layout.px - 1, box.width, 1);
  ctx.fill();
  ctx.restore();
}

export default { label: 'Arcade invaders', draw };
