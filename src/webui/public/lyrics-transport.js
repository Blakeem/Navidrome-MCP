// The lyrics overlay's compact copy of the transport: seek line, times and the three buttons.

import { nextTrack, previousTrack, renderPlayButtons, togglePlayPause } from './controls.js';
import { byId, setProgressVar } from './dom.js';
import { durationSeconds, positionSeconds } from './playback-clock.js';
import { formatTime } from './time-format.js';

const seekLine = byId('lyrics-seek-line');
const positionLabel = byId('lyrics-position');
const durationLabel = byId('lyrics-duration');
const prevBtn = byId('lyrics-prev');
const playBtn = byId('lyrics-play-pause');
const nextBtn = byId('lyrics-next');
const iconPlay = byId('lyrics-icon-play');
const iconPause = byId('lyrics-icon-pause');
const playButtons = { iconPlay, iconPause, playBtn, prevBtn, nextBtn };

export function bindLyricsTransport() {
  prevBtn.addEventListener('click', previousTrack);
  playBtn.addEventListener('click', togglePlayPause);
  nextBtn.addEventListener('click', nextTrack);
}

export function renderLyricsPlayState(np) {
  renderPlayButtons(playButtons, np);
}

// Reads the shared playback clock and never writes it, so the main progress bar keeps its behavior.
export function renderLyricsProgress() {
  const duration = durationSeconds();
  const shown = positionSeconds();
  positionLabel.textContent = formatTime(shown);
  durationLabel.textContent = formatTime(duration);
  setProgressVar(seekLine, duration > 0 ? (shown / duration) * 100 : 0);
}
