// Reading preferences for the lyrics: the text size stepper and the sync offset dialog.
// Both are per device, since a speaker's latency and a reader's eyesight belong to the device.

import { byId, setHidden } from './dom.js';
import { prefWrite, readStoredInt } from './prefs.js';

/** Five fixed sizes. A stepper rather than a slider: the reader picks a legible size instead of hunting for a value. */
const SIZE_STEPS = ['1.05rem', '1.25rem', '1.5rem', '1.85rem', '2.2rem'];
const SIZE_KEY = 'navidrome-mcp.lyric-size';
const OFFSET_KEY = 'navidrome-mcp.lyric-offset';
const OFFSET_STEP_MS = 100;
/** Past a few seconds the nudge stops correcting latency and starts guessing. */
const OFFSET_LIMIT_MS = 5000;

const view = byId('lyrics-view');
const sizeDown = byId('lyrics-size-down');
const sizeUp = byId('lyrics-size-up');
const settingsBtn = byId('lyrics-settings');
const settingsDialog = byId('lyrics-settings-dialog');
const offsetDown = byId('lyrics-offset-down');
const offsetUp = byId('lyrics-offset-up');
const offsetValue = byId('lyrics-offset-value');

// Index into SIZE_STEPS. Step 1 is the size the overlay ships at.
let sizeStep = 1;
let offsetMs = 0;

export function lyricsOffsetMs() {
  return offsetMs;
}

export function lyricsSettingsOpen() {
  return settingsDialog.open;
}

// Only timed lines carry a sync worth nudging, so other content removes the control entirely.
export function setOffsetControlVisible(visible) {
  setHidden(settingsBtn, !visible);
  if (!visible && settingsDialog.open) settingsDialog.close();
}

export function bindLyricsPrefs(onSizeChange) {
  sizeDown.addEventListener('click', () => stepSize(-1, onSizeChange));
  sizeUp.addEventListener('click', () => stepSize(1, onSizeChange));
  settingsBtn.addEventListener('click', () => settingsDialog.showModal());
  offsetDown.addEventListener('click', () => nudgeOffset(-OFFSET_STEP_MS));
  offsetUp.addEventListener('click', () => nudgeOffset(OFFSET_STEP_MS));
  loadLyricsPrefs();
}

function loadLyricsPrefs() {
  // INPUT
  const size = readStoredInt(SIZE_KEY, 0, SIZE_STEPS.length - 1);
  const offset = readStoredInt(OFFSET_KEY, -OFFSET_LIMIT_MS, OFFSET_LIMIT_MS);

  // PROCESS
  if (size !== null) sizeStep = size;
  // A stored value off the 100 ms grid would hold every later nudge off it too.
  if (offset !== null) offsetMs = Math.round(offset / OFFSET_STEP_MS) * OFFSET_STEP_MS;

  // OUTPUT
  applySize();
  renderOffset();
}

function applySize() {
  view.style.setProperty('--lyric-size', SIZE_STEPS[sizeStep]);
  sizeDown.disabled = sizeStep === 0;
  sizeUp.disabled = sizeStep === SIZE_STEPS.length - 1;
}

function stepSize(delta, onSizeChange) {
  const next = Math.max(0, Math.min(SIZE_STEPS.length - 1, sizeStep + delta));
  if (next === sizeStep) return;
  sizeStep = next;
  prefWrite(SIZE_KEY, String(next));
  applySize();
  onSizeChange();
}

function formatOffset(ms) {
  const sign = ms > 0 ? '+' : (ms < 0 ? '-' : '');
  return `${sign}${(Math.abs(ms) / 1000).toFixed(1)} s`;
}

function renderOffset() {
  offsetValue.textContent = formatOffset(offsetMs);
  offsetDown.disabled = offsetMs <= -OFFSET_LIMIT_MS;
  offsetUp.disabled = offsetMs >= OFFSET_LIMIT_MS;
}

function nudgeOffset(deltaMs) {
  const next = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, offsetMs + deltaMs));
  if (next === offsetMs) return;
  offsetMs = next;
  prefWrite(OFFSET_KEY, String(next));
  renderOffset();
}
