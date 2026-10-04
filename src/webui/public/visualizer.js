// The visualizer beside the track info. It reads the level stream only while it is shown, the page is
// visible and a track is loaded. Its canvas is transparent and fades out toward every edge, so the
// card's own surface shows through and no box outline appears.

import { byId } from './dom.js';
import { isPaused, positionSeconds } from './playback-clock.js';
import { prefRead, prefWrite } from './prefs.js';
import { playingIndex } from './snapshot.js';
import { levelSummary, MODES, PAD_RATIO } from './visualizer-modes.js';
import { BAND_COUNT, createSmoother, createTimeline } from './visualizer-timeline.js';

const MODE_KEY = 'navidrome-mcp.visualizer-mode';
const MODE_FADE_MS = 300;
// Reduced motion draws about 15 frames a second.
const REDUCED_FRAME_MS = 66;
const MAX_STEP_S = 0.1;
// The accent of the dark theme, used when a theme token cannot be parsed.
const FALLBACK_COLOR = { r: 124, g: 156, b: 255 };

const card = document.querySelector('.now-playing-card');
const button = byId('visualizer');
const canvas = byId('visualizer-canvas');
const ctx = canvas.getContext('2d');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const timeline = createTimeline();
const smoother = createSmoother(BAND_COUNT);
const modeStates = MODES.map(() => ({}));

let enabled = false;
let hasTrack = false;
let stream = null;
let frameRequest = null;
let lastStepMs = null;
let lastDrawMs = null;
let modeIndex = storedModeIndex();
let fadingFrom = null;
let palette = null;
let width = 0;
let height = 0;

export function bindVisualizer() {
  button.addEventListener('click', cycleMode);
  document.addEventListener('visibilitychange', refresh);
  new ResizeObserver(resizeCanvas).observe(button);
  updateLabel();
}

// Called with every snapshot, after the theme applies, so the palette follows a theme change.
export function renderVisualizer(player, np) {
  enabled = player?.visualizer === true;
  hasTrack = playingIndex(np) !== null;
  card.classList.toggle('has-visualizer', enabled);
  button.hidden = !enabled;
  if (enabled) palette = readPalette();
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
  const targets = isPaused() ? null : timeline.heightsAt(positionSeconds(), Date.now());
  const atRest = smoother.step(targets, stepSeconds);

  if (!reducedMotion.matches || lastDrawMs === null || nowMs - lastDrawMs >= REDUCED_FRAME_MS) {
    const drawSeconds = lastDrawMs === null ? 0 : Math.min(MAX_STEP_S, (nowMs - lastDrawMs) / 1000);
    lastDrawMs = nowMs;
    draw(nowMs, drawSeconds);
  }
  // At rest with no levels there is nothing to animate, so the loop sleeps until levels or a snapshot arrive.
  if (atRest && targets === null && fadingFrom === null) {
    lastStepMs = null;
    lastDrawMs = null;
    return;
  }
  requestFrame();
}

function draw(nowMs, dtSeconds) {
  if (palette === null || width === 0 || height === 0) return;
  const scale = window.devicePixelRatio || 1;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const frame = {
    width,
    height,
    values: smoother.values,
    peaks: smoother.peaks,
    ...levelSummary(smoother.values),
    palette,
    dtSeconds,
    reducedMotion: reducedMotion.matches,
  };
  const progress = fadingFrom === null ? 1 : Math.min(1, (nowMs - fadingFrom.startedMs) / MODE_FADE_MS);
  if (fadingFrom !== null) {
    ctx.globalAlpha = 1 - progress;
    MODES[fadingFrom.index].draw(ctx, { ...frame, state: modeStates[fadingFrom.index] });
    if (progress >= 1) fadingFrom = null;
  }
  ctx.globalAlpha = progress;
  MODES[modeIndex].draw(ctx, { ...frame, state: modeStates[modeIndex] });
  ctx.globalAlpha = 1;
  featherEdges();
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

function resizeCanvas() {
  const rect = button.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  width = rect.width;
  height = rect.height;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  // Resizing clears the canvas, so the current levels draw again at the new size.
  if (enabled) {
    draw(performance.now(), 0);
    requestFrame();
  }
}

function cycleMode() {
  fadingFrom = { index: modeIndex, startedMs: performance.now() };
  modeIndex = (modeIndex + 1) % MODES.length;
  prefWrite(MODE_KEY, MODES[modeIndex].id);
  updateLabel();
  requestFrame();
}

function updateLabel() {
  button.setAttribute('aria-label', `Visualizer: ${MODES[modeIndex].label}. Activate to change the style.`);
}

function storedModeIndex() {
  const index = MODES.findIndex((mode) => mode.id === prefRead(MODE_KEY));
  return index === -1 ? 0 : index;
}

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: parseColor(styles.getPropertyValue('--accent')),
    strong: parseColor(styles.getPropertyValue('--accent-strong')),
  };
}

// The canvas normalizes an opaque CSS color to #rrggbb, so a token in any notation parses.
function parseColor(value) {
  ctx.fillStyle = '#000000';
  ctx.fillStyle = value.trim();
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(ctx.fillStyle));
  if (match === null) return FALLBACK_COLOR;
  return { r: Number.parseInt(match[1], 16), g: Number.parseInt(match[2], 16), b: Number.parseInt(match[3], 16) };
}
