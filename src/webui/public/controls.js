// The play state changes only when a snapshot confirms it, so no button disagrees with mpv.

import { FAILED_TEXT, postJson } from './api.js';
import { byId, setHidden } from './dom.js';
import { isOutputMissing, revealOutputBanner } from './output-banner.js';
import { isPaused, positionSeconds, setPosition } from './playback-clock.js';
import { playingIndex } from './snapshot.js';

const controlStatus = byId('control-status');
const CONTROL_STATUS_CLEAR_MS = 4000;
// The refusal messages are written for the MCP agent and name tools the page cannot call.
const REFUSED_TEXT = 'That is not possible right now.';

let controlStatusTimer = null;

// A refusal is an answer with HTTP 200 and `success: false`, such as a pause with nothing playing.
function isRefusal(data) {
  return data?.success === false;
}

// Every control reports a failed or refused request on the page, so a failed click is never silent.
export async function postControl(path, body = {}) {
  const { ok, data } = await postJson(path, body);
  showControlResult(ok, data);
  return ok && !isRefusal(data);
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

// The clock moves before the request so the bar updates at once. A failed seek restores it.
export async function seekTo(seconds) {
  const previousSeconds = positionSeconds();
  setPosition(seconds);
  const ok = await postControl('/api/controls/seek', { seconds, mode: 'absolute' });
  if (!ok) setPosition(previousSeconds);
}

export function controlAvailability(np) {
  return { hasTrack: playingIndex(np) !== null };
}

// The main transport and the lyrics overlay share this rule, so their play states always match.
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

function failureText(data) {
  return typeof data?.error === 'string' && data.error !== '' ? data.error : FAILED_TEXT;
}

export function showControlResult(ok, data) {
  if (controlStatusTimer !== null) {
    clearTimeout(controlStatusTimer);
    controlStatusTimer = null;
  }
  // A resume refusal and a play that stayed paused both carry `code: 'output-missing'`, so either shows the banner.
  if (ok && isOutputMissing(data)) {
    controlStatus.textContent = '';
    revealOutputBanner();
    return;
  }
  if (ok && !isRefusal(data)) {
    controlStatus.textContent = '';
    return;
  }
  controlStatus.textContent = ok ? REFUSED_TEXT : failureText(data);
  controlStatusTimer = setTimeout(() => {
    controlStatusTimer = null;
    controlStatus.textContent = '';
  }, CONTROL_STATUS_CLEAR_MS);
}
