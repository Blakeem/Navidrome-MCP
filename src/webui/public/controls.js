// Transport actions shared by the main controls and the lyrics overlay. The play state
// changes only when the next snapshot confirms it, so a button never disagrees with mpv.

import { postJson } from './api.js';
import { byId, setHidden } from './dom.js';
import { isPaused, positionSeconds, setPosition } from './playback-clock.js';
import { playingIndex } from './snapshot.js';

const controlStatus = byId('control-status');
const CONTROL_STATUS_CLEAR_MS = 4000;

let controlStatusTimer = null;

// Every control reports a failed request in one live line, so a dead click never passes silently.
export async function postControl(path, body = {}) {
  const { ok, data } = await postJson(path, body);
  showControlResult(ok, data);
  return ok;
}

export function togglePlayPause() {
  void postControl(isPaused() ? '/api/controls/resume' : '/api/controls/pause');
}

export function previousTrack() {
  void postControl('/api/controls/previous');
}

export function nextTrack() {
  void postControl('/api/controls/next');
}

// The clock moves before the request so the bar answers at once, and a failed seek snaps it back.
export async function seekTo(seconds) {
  const previousSeconds = positionSeconds();
  setPosition(seconds);
  const ok = await postControl('/api/controls/seek', { seconds, mode: 'absolute' });
  if (!ok) setPosition(previousSeconds);
}

export function controlAvailability(np) {
  return { hasTrack: playingIndex(np) !== null };
}

// The main transport and the lyrics overlay draw their play state through this one rule, so neither drifts.
export function renderPlayButtons({ iconPlay, iconPause, playBtn, prevBtn, nextBtn }, np) {
  const paused = isPaused();
  const { hasTrack } = controlAvailability(np);
  setHidden(iconPlay, !paused);
  setHidden(iconPause, paused);
  playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  playBtn.disabled = !hasTrack;
  prevBtn.disabled = !hasTrack;
  nextBtn.disabled = !hasTrack;
}

function showControlResult(ok, data) {
  if (controlStatusTimer !== null) {
    clearTimeout(controlStatusTimer);
    controlStatusTimer = null;
  }
  if (ok) {
    controlStatus.textContent = '';
    return;
  }
  const message = typeof data?.error === 'string' && data.error !== '' ? data.error : 'That action failed. Try again.';
  controlStatus.textContent = message;
  controlStatusTimer = setTimeout(() => {
    controlStatusTimer = null;
    controlStatus.textContent = '';
  }, CONTROL_STATUS_CLEAR_MS);
}
