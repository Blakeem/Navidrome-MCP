// The visualizer beside the track info. It reads the level stream only while it is shown, the page is
// visible and a track is loaded. Its canvas is transparent and fades out toward every edge, so the
// card's own surface shows through and no box outline appears.

import { getJson } from './api.js';
import { byId } from './dom.js';
import { isPaused, positionSeconds } from './playback-clock.js';
import { prefRead, prefWrite } from './prefs.js';
import { playingIndex } from './snapshot.js';
import { levelSummary, PAD_RATIO } from './visualizer-kit.js';
import { BAND_COUNT, createLevelGain, createSmoother, createTimeline } from './visualizer-timeline.js';
import bars from './visualizers/bars.js';

const MODE_KEY = 'navidrome-mcp.visualizer-mode';
const MODES_URL = '/api/visualizer/modes';
const DEFAULT_MODE_ID = 'bars';
const MODE_FADE_MS = 300;
const MODE_NAME_MS = 1500;
// Reduced motion draws about 15 frames a second.
const REDUCED_FRAME_MS = 66;
const MAX_STEP_S = 0.1;
// The dark theme's tokens, used when a theme token cannot be parsed.
const FALLBACK_PALETTE = {
  accent: { r: 124, g: 156, b: 255 },
  strong: { r: 165, g: 190, b: 255 },
  surface: { r: 19, g: 25, b: 39 },
  text: { r: 230, g: 236, b: 246 },
};

const card = document.querySelector('.now-playing-card');
const button = byId('visualizer');
const canvas = byId('visualizer-canvas');
const ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const timeline = createTimeline();
const gain = createLevelGain();
const smoother = createSmoother(BAND_COUNT);

let enabled = false;
let hasTrack = false;
let stream = null;
let frameRequest = null;
let lastStepMs = null;
let lastDrawMs = null;
// The default draws until the list of modes arrives.
let modes = [toMode(DEFAULT_MODE_ID, bars)];
let modeIndex = 0;
let fadingFrom = null;
let modeBusy = false;
let hostLayers = [];
let nameTimer = null;
let palette = null;
let theme = 'dark';
let width = 0;
let height = 0;

export function bindVisualizer() {
  button.addEventListener('click', cycleMode);
  document.addEventListener('visibilitychange', refresh);
  new ResizeObserver(resizeCanvas).observe(button);
  updateLabel();
  loadModes();
}

// Called with every snapshot, after the theme applies, so the palette follows a theme change.
export function renderVisualizer(player, np) {
  enabled = player?.visualizer === true;
  hasTrack = playingIndex(np) !== null;
  card.classList.toggle('has-visualizer', enabled);
  button.hidden = !enabled;
  if (enabled) {
    palette = readPalette();
    theme = themeOf(palette.surface);
  }
  refresh();
}

function refresh() {
  const visible = document.visibilityState === 'visible';
  const wantStream = enabled && visible && hasTrack;
  if (wantStream && stream === null) openStream();
  if (!wantStream && stream !== null) closeStream();
  if (enabled && visible) requestFrame();
}

function openStream() {
  stream = new EventSource('/api/visualizer');
  stream.addEventListener('levels', (event) => {
    let data = null;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!Array.isArray(data?.frames)) return;
    timeline.ingest(data.frames, Date.now());
    requestFrame();
  });
}

function closeStream() {
  stream.close();
  stream = null;
  timeline.clear();
  gain.reset();
}

function requestFrame() {
  frameRequest ??= window.requestAnimationFrame(animate);
}

function animate(nowMs) {
  frameRequest = null;
  if (!enabled || document.visibilityState !== 'visible') {
    lastStepMs = null;
    return;
  }
  const stepSeconds = lastStepMs === null ? 0 : Math.min(MAX_STEP_S, (nowMs - lastStepMs) / 1000);
  lastStepMs = nowMs;
  const sample = isPaused() ? null : timeline.levelsAt(positionSeconds(), Date.now());
  const targets = sample === null ? null : gain.heights(sample, stepSeconds);
  const atRest = smoother.step(targets, stepSeconds);

  if (!reducedMotion.matches || lastDrawMs === null || nowMs - lastDrawMs >= REDUCED_FRAME_MS) {
    const drawSeconds = lastDrawMs === null ? 0 : Math.min(MAX_STEP_S, (nowMs - lastDrawMs) / 1000);
    lastDrawMs = nowMs;
    modeBusy = draw(nowMs, drawSeconds);
  }
  // At rest with no levels and no mode still fading out, the loop sleeps until levels or a snapshot arrive.
  if (atRest && targets === null && fadingFrom === null && !modeBusy) {
    lastStepMs = null;
    lastDrawMs = null;
    return;
  }
  requestFrame();
}

// Returns true while a mode still shows something that needs more frames to fade.
function draw(nowMs, dtSeconds) {
  if (palette === null || width === 0 || height === 0) return false;
  const scale = window.devicePixelRatio || 1;
  const frame = {
    width,
    height,
    pad: Math.min(width, height) * PAD_RATIO,
    values: smoother.values,
    peaks: smoother.peaks,
    ...levelSummary(smoother.values),
    palette,
    theme,
    dtSeconds,
    reducedMotion: reducedMotion.matches,
    createLayer,
  };
  const progress = fadingFrom === null ? 1 : Math.min(1, (nowMs - fadingFrom.startedMs) / MODE_FADE_MS);
  let busy = false;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (fadingFrom !== null) {
    busy = paintMode(fadingFrom.mode, frame, 1 - progress, 0);
    if (progress >= 1) fadingFrom = null;
  }
  const current = modes[modeIndex];
  if (current !== undefined) busy = paintMode(current, frame, progress, 1) || busy;
  featherEdges();
  return busy;
}

// Each mode draws on a cleared layer of its own, so its compositing never reaches the other mode in a crossfade.
function paintMode(mode, frame, alpha, slot) {
  const layer = (hostLayers[slot] ??= createLayer(width, height));
  const scale = window.devicePixelRatio || 1;
  let busy = false;
  layer.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  layer.ctx.clearRect(0, 0, width, height);
  layer.ctx.save();
  try {
    busy = mode.draw(layer.ctx, { ...frame, state: mode.state }) === true;
  } catch (err) {
    dropMode(mode, err);
    return false;
  } finally {
    layer.ctx.restore();
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer.canvas, 0, 0, width, height);
  ctx.globalAlpha = 1;
  return busy;
}

// Every mode leaves this inset empty, so the fade is a backstop that keeps any stray pixel off a hard edge.
function featherEdges() {
  const feather = Math.min(width, height) * PAD_RATIO;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = edgeFade(ctx.createLinearGradient(0, 0, width, 0), feather / width);
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = edgeFade(ctx.createLinearGradient(0, 0, 0, height), feather / height);
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

function edgeFade(gradient, fraction) {
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(fraction, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(1 - fraction, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  return gradient;
}

// Offscreen layers match the canvas's own pixel density, so a copied layer stays sharp.
function createLayer(layerWidth, layerHeight) {
  const scale = window.devicePixelRatio || 1;
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(layerWidth * scale));
  layer.height = Math.max(1, Math.round(layerHeight * scale));
  const layerCtx = layer.getContext('2d');
  layerCtx.setTransform(scale, 0, 0, scale, 0, 0);
  return { canvas: layer, ctx: layerCtx };
}

function resizeCanvas() {
  const rect = button.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  width = rect.width;
  height = rect.height;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  hostLayers = [];
  // Resizing clears the canvas, so the current levels draw again at the new size.
  if (enabled) {
    modeBusy = draw(performance.now(), 0);
    requestFrame();
  }
}

// Each file in visualizers/ is a mode, so a new style needs only its file, a build and a reload.
async function loadModes() {
  const listing = await getJson(MODES_URL);
  if (!Array.isArray(listing?.modes)) return;
  const found = (await Promise.all(listing.modes.map(loadMode))).filter((mode) => mode !== null);
  if (found.length === 0) return;
  modes = found;
  modeIndex = storedModeIndex();
  fadingFrom = null;
  updateLabel();
  requestFrame();
}

async function loadMode(id) {
  try {
    const { default: plugin } = await import(`./visualizers/${id}.js`);
    if (typeof plugin?.label !== 'string' || typeof plugin.draw !== 'function') {
      throw new Error('its default export needs a label and a draw function');
    }
    return toMode(id, plugin);
  } catch (err) {
    console.error(`visualizer: skipped the ${id} style`, err);
    return null;
  }
}

function toMode(id, plugin) {
  return { id, label: plugin.label, draw: plugin.draw, state: {} };
}

// A mode that throws leaves the cycle, so one broken file never stops the others.
function dropMode(mode, err) {
  console.error(`visualizer: the ${mode.id} style failed and left the cycle`, err);
  const index = modes.indexOf(mode);
  if (index === -1) return;
  modes.splice(index, 1);
  if (index < modeIndex) modeIndex -= 1;
  if (modeIndex >= modes.length) modeIndex = 0;
  if (fadingFrom?.mode === mode) fadingFrom = null;
  // The failed draw can leave its layer with unbalanced state, so both layers start over.
  hostLayers = [];
  updateLabel();
}

function cycleMode() {
  if (modes.length < 2) return;
  fadingFrom = { mode: modes[modeIndex], startedMs: performance.now() };
  modeIndex = (modeIndex + 1) % modes.length;
  prefWrite(MODE_KEY, modes[modeIndex].id);
  updateLabel();
  showModeName();
  requestFrame();
}

// The new style's name shows briefly, so each style can be told apart while cycling.
function showModeName() {
  button.classList.add('naming-mode');
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => { button.classList.remove('naming-mode'); }, MODE_NAME_MS);
}

function updateLabel() {
  const label = modes[modeIndex]?.label ?? 'none';
  button.dataset.tip = label;
  button.setAttribute('aria-label', `Visualizer: ${label}. Activate to change the style.`);
}

function storedModeIndex() {
  const stored = modes.findIndex((mode) => mode.id === prefRead(MODE_KEY));
  if (stored !== -1) return stored;
  return Math.max(0, modes.findIndex((mode) => mode.id === DEFAULT_MODE_ID));
}

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: parseColor(styles.getPropertyValue('--accent'), FALLBACK_PALETTE.accent),
    strong: parseColor(styles.getPropertyValue('--accent-strong'), FALLBACK_PALETTE.strong),
    surface: parseColor(styles.getPropertyValue('--surface'), FALLBACK_PALETTE.surface),
    text: parseColor(styles.getPropertyValue('--text'), FALLBACK_PALETTE.text),
  };
}

function themeOf({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5 ? 'dark' : 'light';
}

// The canvas normalizes an opaque CSS color to #rrggbb, so a token in any notation parses.
function parseColor(value, fallback) {
  ctx.fillStyle = '#000000';
  ctx.fillStyle = value.trim();
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(ctx.fillStyle));
  if (match === null) return fallback;
  return { r: Number.parseInt(match[1], 16), g: Number.parseInt(match[2], 16), b: Number.parseInt(match[3], 16) };
}
