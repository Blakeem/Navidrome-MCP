// The lyrics body. Four content states share one entry point: instrumental, timed, plain and none found.
// Only the timed state follows the player.

import { byId } from './dom.js';
import { snapLyricsClock } from './lyrics-clock.js';
import { lyricsFor } from './lyrics-data.js';
import { followLines, resetFollow } from './lyrics-follow.js';
import { setOffsetControlVisible } from './lyrics-prefs.js';

const lines = byId('lyrics-lines');
const status = byId('lyrics-status');

// Only shapes the empty-state message. Assumed on until /api/player-state answers.
let lrclibEnabled = true;
// Bumped on every track change, so a response for an older track is discarded.
let generation = 0;
// The song whose lookup failed, so reopening the overlay can ask again.
let failedSongId = null;

export function setLrclibEnabled(enabled) {
  lrclibEnabled = enabled;
}

// A null songId also covers the window before the queue snapshot lands,
// since /api/lyrics/:songId answers 404 for an id not in the queue.
export function showLyricsFor(songId) {
  generation += 1;
  failedSongId = null;
  if (songId === null) {
    setLyricsStatus('Nothing is playing.');
    return;
  }
  setLyricsStatus('Loading lyrics…');
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
  failedSongId = null;
  renderLyricsLines(dto);
}

export function retryFailedLyrics() {
  if (failedSongId !== null) showLyricsFor(failedSongId);
}

function clearLyricsBody() {
  resetFollow();
  lines.classList.remove('is-synced');
  lines.replaceChildren();
  status.replaceChildren();
  setOffsetControlVisible(false);
}

function setLyricsStatus(text) {
  clearLyricsBody();
  status.textContent = text;
}

// A placard is more than one run of text, so it is built as nodes. `link` is { text, href } or null.
function renderPlacard(headline, note, link) {
  // INPUT
  const head = document.createElement('span');
  const detail = document.createElement('span');
  const anchor = link === null ? null : document.createElement('a');

  // PROCESS
  head.className = 'lyrics-placard-head';
  head.textContent = headline;
  detail.className = 'lyrics-placard-note';
  detail.textContent = note;
  if (anchor !== null) {
    anchor.className = 'lyrics-placard-link';
    anchor.href = link.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = link.text;
  }

  // OUTPUT
  clearLyricsBody();
  status.append(head, detail);
  if (anchor !== null) status.appendChild(anchor);
}

// The attribution url is server-supplied text, so only an http(s) origin may reach an href.
function lrclibPublishUrl(dto) {
  const base = typeof dto.attribution?.url === 'string' ? dto.attribution.url.trim() : '';
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base.replace(/\/+$/, '')}/publish`;
}

// Without the second sentence, a disabled LRCLIB looks like a library that has no lyrics.
function renderNoLyrics(dto) {
  // A provider other than lrclib means LRCLIB was never asked about this track.
  const publishUrl = lrclibEnabled && dto.provider === 'lrclib' ? lrclibPublishUrl(dto) : null;
  const note = lrclibEnabled
    ? 'The file carries none, and LRCLIB has no match for this track.'
    : 'The file carries none, and LRCLIB lookup is disabled.';
  renderPlacard('No lyrics found', note, publishUrl === null ? null : { text: 'Add them on LRCLIB', href: publishUrl });
}

function lyricsLineEl(text, index) {
  const li = document.createElement('li');
  li.className = 'lyric-line';
  // Lyrics are untrusted third-party text, so they go through textContent only.
  li.textContent = text;
  // Only a timed row can be tapped to seek, so only a timed row is indexed.
  if (index !== null) li.dataset.index = String(index);
  return li;
}

function renderLyricsLines(dto) {
  // INPUT
  const timed = dto.hasSynced === true && Array.isArray(dto.synced) ? dto.synced : [];
  const plain = typeof dto.unsynced === 'string' ? dto.unsynced : '';
  let rows = [];

  if (dto.isInstrumental === true) {
    renderPlacard('Instrumental', 'This track has no words.', null);
    return;
  }

  // PROCESS
  clearLyricsBody();
  if (timed.length > 0) rows = timed.map((line, index) => lyricsLineEl(line.text, index));
  else if (plain.trim() !== '') rows = plain.split(/\r?\n/).map((text) => lyricsLineEl(text, null));

  // OUTPUT
  if (rows.length === 0) {
    renderNoLyrics(dto);
    return;
  }
  followLines(timed, timed.length > 0 ? rows : []);
  lines.classList.toggle('is-synced', timed.length > 0);
  lines.replaceChildren(...rows);
  setOffsetControlVisible(timed.length > 0);
  // A snapshot may have landed during the lookup, leaving a correction that belongs to no row on screen.
  snapLyricsClock();
}
