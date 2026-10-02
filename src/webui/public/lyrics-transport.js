// The lyrics overlay's compact copy of the transport: seek line, times and the three buttons.

import { controlAvailability, nextTrack, previousTrack, togglePlayPause } from './controls.js';
import { byId, setHidden, setProgressVar } from './dom.js';
import { durationSeconds, isPaused, positionSeconds } from './playback-clock.js';
import { formatTime } from './time-format.js';

const seekLine = byId('lyrics-seek-line');
const positionLabel = byId('lyrics-position');
const durationLabel = byId('lyrics-duration');
const prevBtn = byId('lyrics-prev');
const playBtn = byId('lyrics-play-pause');
const nextBtn = byId('lyrics-next');
const iconPlay = byId('lyrics-icon-play');
const iconPause = byId('lyrics-icon-pause');

export function bindLyricsTransport() {
  prevBtn.addEventListener('click', previousTrack);
  playBtn.addEventListener('click', togglePlayPause);
  nextBtn.addEventListener('click', nextTrack);
}

export function renderLyricsPlayState(np) {
  const paused = isPaused();
  const { running, hasTrack } = controlAvailability(np);
  setHidden(iconPlay, !paused);
  setHidden(iconPause, paused);
  playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  playBtn.disabled = !running;
  prevBtn.disabled = !hasTrack;
  nextBtn.disabled = !hasTrack;
}

// Reads the shared playback clock and never writes it, so the main progress bar keeps its behavior.
export function renderLyricsProgress() {
  const duration = durationSeconds();
  const shown = positionSeconds();
  positionLabel.textContent = formatTime(shown);
  durationLabel.textContent = formatTime(duration);
  setProgressVar(seekLine, duration > 0 ? (shown / duration) * 100 : 0);
}
