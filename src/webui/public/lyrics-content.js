import { byId } from './dom.js';
import { snapLyricsClock } from './lyrics-clock.js';
import { lyricsFor } from './lyrics-data.js';
import { followLines, resetFollow } from './lyrics-follow.js';
import { setOffsetControlVisible } from './lyrics-prefs.js';

const lines = byId('lyrics-lines');
const status = byId('lyrics-status');
const scrollBox = byId('lyrics-scroll');

// Only shapes the empty-state message. Assumed on until /api/player-state answers.
let lrclibEnabled = true;
// Bumped on every track change, so a response for an older track is discarded.
let generation = 0;
// The song whose lookup failed, so reopening the overlay can ask again.
let failedSongId = null;

export function setLrclibEnabled(enabled) {
  lrclibEnabled = enabled;
}

// A null songId also covers a track with no row in the queue snapshot,
// since /api/lyrics/:songId answers 404 for an id not in the queue.
export function showLyricsFor(songId) {
  generation += 1;
  failedSongId = null;
  if (songId === null) {
    setLyricsStatus('Nothing is playing.');
    return;
  }
  // The offset applies to every song, so the loading state leaves the offset control
  // and its open dialog alone.
  clearLyricsBody();
  status.textContent = 'Loading lyrics…';
  void loadLyrics(songId, generation);
}

async function loadLyrics(songId, mine) {
  const dto = await lyricsFor(songId);
  if (mine !== generation) return;
  if (dto === null) {
    failedSongId = songId;
    setLyricsStatus('The lyrics lookup failed. Reopen the lyrics view to try again.');
    return;
  }
  renderLyricsLines(dto);
}

export function retryFailedLyrics() {
  if (failedSongId !== null) showLyricsFor(failedSongId);
}

function clearLyricsBody() {
  // Removing a focused seek button would drop focus to document.body.
  if (lines.contains(document.activeElement)) scrollBox.focus({ preventScroll: true });
  resetFollow();
  lines.classList.remove('is-synced');
  lines.replaceChildren();
  status.replaceChildren();
}

function setLyricsStatus(text) {
  clearLyricsBody();
  setOffsetControlVisible(false);
  status.textContent = text;
}

function renderPlacard(headline, note) {
  const head = document.createElement('span');
  const detail = document.createElement('span');

  head.className = 'lyrics-placard-head';
  head.textContent = headline;
  detail.className = 'lyrics-placard-note';
  detail.textContent = note;

  clearLyricsBody();
  setOffsetControlVisible(false);
  status.append(head, detail);
}

// Without the second sentence, a disabled LRCLIB looks like a library that has no lyrics.
function renderNoLyrics(dto) {
  // A provider other than lrclib means LRCLIB was never asked about this track.
  const lrclibAsked = lrclibEnabled && dto.provider === 'lrclib';
  let note = 'The file carries none, and LRCLIB lookup is disabled.';
  if (lrclibAsked) note = 'The file carries none, and LRCLIB has no match for this track.';
  else if (lrclibEnabled) note = 'The file carries none, and LRCLIB was not searched because the track has no title or artist tag.';
  renderPlacard('No lyrics found', note);
}

function lyricsLineEl(text, index) {
  const li = document.createElement('li');
  // A native button gives a keyboard and screen-reader path to the seek.
  // A blank row has no name to announce.
  const seekBtn = index !== null && text.trim() !== '' ? document.createElement('button') : null;

  li.className = 'lyric-line';
  // Only a timed row can be tapped to seek, so only a timed row is indexed.
  if (index !== null) li.dataset.index = String(index);

  // Lyrics are untrusted third-party text, so they go through textContent only.
  if (seekBtn === null) {
    li.textContent = text;
    return li;
  }
  seekBtn.type = 'button';
  seekBtn.className = 'lyric-seek';
  seekBtn.textContent = text;
  li.appendChild(seekBtn);
  return li;
}

function renderLyricsLines(dto) {
  const timed = dto.hasSynced === true && Array.isArray(dto.synced) ? dto.synced : [];
  const plain = typeof dto.unsynced === 'string' ? dto.unsynced : '';
  let rows = [];

  if (dto.isInstrumental === true) {
    renderPlacard('Instrumental', 'This track has no words.');
    return;
  }

  clearLyricsBody();
  if (timed.length > 0) rows = timed.map((line, index) => lyricsLineEl(line.text, index));
  else if (plain.trim() !== '') rows = plain.split(/\r?\n/).map((text) => lyricsLineEl(text, null));

  if (rows.length === 0) {
    renderNoLyrics(dto);
    return;
  }
  followLines(timed, timed.length > 0 ? rows : []);
  lines.classList.toggle('is-synced', timed.length > 0);
  lines.replaceChildren(...rows);
  setOffsetControlVisible(timed.length > 0);
  // A snapshot during the lookup may have left a correction that belongs to no row on screen.
  snapLyricsClock();
}
