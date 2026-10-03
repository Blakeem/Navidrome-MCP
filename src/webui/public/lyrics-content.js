// The lyrics body. Four content states share one entry point: instrumental, timed, plain and none found.
// Only the timed state follows the player.

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

// A null songId also covers the window before the queue snapshot lands,
// since /api/lyrics/:songId answers 404 for an id not in the queue.
export function showLyricsFor(songId) {
  generation += 1;
  failedSongId = null;
  if (songId === null) {
    setLyricsStatus('Nothing is playing.');
    return;
  }
  // The offset applies to every song, so the loading state leaves the offset control and its open dialog alone.
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
  // Removing a focused seek button or placard link would drop focus to document.body.
  const focusInLyricsBody = lines.contains(document.activeElement) || status.contains(document.activeElement);
  if (focusInLyricsBody) scrollBox.focus({ preventScroll: true });
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
  setOffsetControlVisible(false);
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
  const lrclibAsked = lrclibEnabled && dto.provider === 'lrclib';
  const publishUrl = lrclibAsked ? lrclibPublishUrl(dto) : null;
  let note = 'The file carries none, and LRCLIB lookup is disabled.';
  if (lrclibAsked) note = 'The file carries none, and LRCLIB has no match for this track.';
  else if (lrclibEnabled) note = 'The file carries none, and LRCLIB was not searched because the track has no title or artist tag.';
  renderPlacard('No lyrics found', note, publishUrl === null ? null : { text: 'Add them on LRCLIB', href: publishUrl });
}

function lyricsLineEl(text, index) {
  // INPUT
  const li = document.createElement('li');
  // A native button gives a keyboard and screen-reader path to the seek. A blank row has no name to announce.
  const seekBtn = index !== null && text.trim() !== '' ? document.createElement('button') : null;

  // PROCESS
  li.className = 'lyric-line';
  // Only a timed row can be tapped to seek, so only a timed row is indexed.
  if (index !== null) li.dataset.index = String(index);

  // OUTPUT
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
