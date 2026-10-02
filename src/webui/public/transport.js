// The main transport: play/pause, previous, next and the seek slider with its time labels.

import { controlAvailability, nextTrack, previousTrack, seekTo, togglePlayPause } from './controls.js';
import { byId, setHidden, setProgressVar } from './dom.js';
import { durationSeconds, isPaused, positionSeconds } from './playback-clock.js';
import { formatTime } from './time-format.js';

const btnPlay = byId('btn-play-pause');
const btnPrev = byId('btn-prev');
const btnNext = byId('btn-next');
const iconPlay = byId('icon-play');
const iconPause = byId('icon-pause');
const seek = byId('seek-slider');
const positionLabel = byId('position-label');
const durationLabel = byId('duration-label');

let seekDragging = false;

export function renderTransport(np) {
  const paused = isPaused();
  const { running, hasTrack } = controlAvailability(np);
  setHidden(iconPlay, !paused);
  setHidden(iconPause, paused);
  btnPlay.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  btnPlay.disabled = !running;
  btnPrev.disabled = !hasTrack;
  btnNext.disabled = !hasTrack;
  seek.disabled = !hasTrack || np?.isRadio === true;
  durationLabel.textContent = formatTime(durationSeconds());
}

export function bindTransport() {
  btnPlay.addEventListener('click', togglePlayPause);
  btnPrev.addEventListener('click', previousTrack);
  btnNext.addEventListener('click', nextTrack);

  // Seek on release only, since `input` fires on every drag step and would flood mpv with seeks.
  seek.addEventListener('pointerdown', () => { seekDragging = true; });
  // A cancelled drag or a release outside the slider may never fire `change`.
  seek.addEventListener('pointercancel', () => { seekDragging = false; });
  seek.addEventListener('pointerup', () => { seekDragging = false; });
  seek.addEventListener('input', () => {
    const duration = durationSeconds();
    if (duration <= 0) return;
    const pct = Number(seek.value);
    positionLabel.textContent = formatTime((pct / 100) * duration);
    setProgressVar(seek, pct);
  });
  seek.addEventListener('change', () => {
    const duration = durationSeconds();
    seekDragging = false;
    if (duration <= 0) return;
    seekTo((Number(seek.value) / 100) * duration);
  });

  requestAnimationFrame(tickProgress);
}

function tickProgress() {
  if (!seekDragging) {
    const shown = positionSeconds();
    const duration = durationSeconds();
    const pct = duration > 0 ? (shown / duration) * 100 : 0;
    positionLabel.textContent = formatTime(shown);
    seek.value = String(Math.round(pct));
    setProgressVar(seek, pct);
  }
  requestAnimationFrame(tickProgress);
}
