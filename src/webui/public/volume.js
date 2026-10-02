// The volume slider and mute button.

import { postJson } from './api.js';
import { byId, setHidden, setProgressVar } from './dom.js';

const volume = byId('volume-slider');
const volumeLabel = byId('volume-label');
const btnMute = byId('btn-mute');
const iconHigh = byId('icon-vol-high');
const iconMid = byId('icon-vol-mid');
const iconLow = byId('icon-vol-low');
const iconMute = byId('icon-vol-mute');

// A debounced `input` feels immediate on touch without sending a request per drag step.
const VOLUME_DEBOUNCE_MS = 120;
const UNMUTE_FALLBACK_VOLUME = 60;

let volumeDragging = false;
let preMuteVolume = 80;
let volumeTimer = null;

export function renderVolume(status) {
  const level = status !== null && typeof status.volume === 'number' ? status.volume : null;
  if (level === null) {
    volumeLabel.textContent = '--';
    return;
  }
  if (!volumeDragging) {
    volume.value = String(Math.round(level));
    setProgressVar(volume, level);
  }
  volumeLabel.textContent = String(Math.round(level));
  showVolumeIcon(level);
}

export function bindVolume() {
  volume.addEventListener('pointerdown', () => { volumeDragging = true; });
  volume.addEventListener('pointercancel', () => { volumeDragging = false; });
  volume.addEventListener('pointerup', () => { volumeDragging = false; });
  volume.addEventListener('input', () => {
    const level = Number(volume.value);
    showLocalLevel(level);
    if (volumeTimer !== null) clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => {
      volumeTimer = null;
      sendVolume(level);
    }, VOLUME_DEBOUNCE_MS);
  });
  volume.addEventListener('change', () => {
    volumeDragging = false;
    if (volumeTimer !== null) {
      clearTimeout(volumeTimer);
      volumeTimer = null;
    }
    sendVolume(Number(volume.value));
  });
  btnMute.addEventListener('click', toggleMute);
}

function toggleMute() {
  const level = Number(volume.value);
  if (level > 0) preMuteVolume = level;
  const next = level > 0 ? 0 : (preMuteVolume > 0 ? preMuteVolume : UNMUTE_FALLBACK_VOLUME);
  volume.value = String(next);
  showLocalLevel(next);
  sendVolume(next);
}

function showLocalLevel(level) {
  setProgressVar(volume, level);
  volumeLabel.textContent = String(level);
  showVolumeIcon(level);
}

function sendVolume(level) {
  void postJson('/api/controls/volume', { level });
}

// Thirds of the 1 to 100 range pace the icon evenly, and mute holds only 0.
function showVolumeIcon(level) {
  const v = Number(level);
  setHidden(iconMute, v !== 0);
  setHidden(iconLow, !(v > 0 && v <= 33));
  setHidden(iconMid, !(v >= 34 && v <= 66));
  setHidden(iconHigh, !(v >= 67));
}
