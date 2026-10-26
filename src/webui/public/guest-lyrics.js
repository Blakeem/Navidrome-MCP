// The host lyrics view carries transport and seek controls a guest cannot use, so the guest page
// shows the lines in a read-only panel built from the same data and line-timing modules.

import { byId, setHidden } from './dom.js';
import { lyricsFor } from './lyrics-data.js';
import { findActiveLine } from './lyrics-sync.js';
import { positionSeconds } from './playback-clock.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const toggle = byId('guest-lyrics-toggle');
const body = byId('guest-lyrics-body');
const status = byId('guest-lyrics-status');
const list = byId('guest-lyrics-lines');

// A radio stream has no songId, so it takes its own marker to tell it apart from an empty queue.
const RADIO = Symbol('radio');

let shownTrack;
// Bumped on every track change, so a response for an older track is discarded.
let generation = 0;
let timedLines = [];
let rows = [];
let cursor = null;
let activeIndex = -1;

// The panel starts collapsed, since most guests watch the queue. Lines keep loading while it is closed.
export function bindGuestLyrics() {
  toggle.addEventListener('click', () => {
    const open = body.hidden;
    setHidden(body, !open);
    toggle.textContent = open ? 'Hide lyrics' : 'Show lyrics';
    toggle.setAttribute('aria-expanded', String(open));
    // A closed panel has no layout, so the active line moved without a scroll.
    if (open) scrollToActive('auto');
  });
}

export function showGuestLyrics(songId, isRadio) {
  const track = isRadio ? RADIO : songId;
  if (track === shownTrack) return;
  shownTrack = track;
  generation += 1;
  clearLines();
  if (isRadio) {
    status.textContent = 'A radio stream has no lyrics.';
    return;
  }
  if (songId === null) {
    status.textContent = 'Nothing is playing.';
    return;
  }
  status.textContent = 'Loading lyrics…';
  void loadLyrics(songId, generation);
}

export function tickGuestLyrics() {
  if (timedLines.length === 0) return;
  const found = findActiveLine(timedLines, positionSeconds() * 1000, cursor);
  cursor = found.cursor;
  if (found.index === activeIndex) return;
  rows[activeIndex]?.classList.remove('active');
  activeIndex = found.index;
  const row = rows[activeIndex];
  if (row === undefined) return;
  row.classList.add('active');
  scrollToActive(reducedMotion.matches ? 'auto' : 'smooth');
}

function scrollToActive(behavior) {
  const row = rows[activeIndex];
  if (row === undefined) return;
  // scrollIntoView would also scroll the page, which on a phone moves the card off screen. The list
  // is the rows' offset parent, so offsetTop measures from its top.
  list.scrollTo({ top: row.offsetTop - list.clientHeight / 3, behavior });
}

async function loadLyrics(songId, mine) {
  const dto = await lyricsFor(songId);
  if (mine !== generation) return;
  if (dto === null) {
    status.textContent = 'The lyrics lookup failed.';
    return;
  }
  if (dto.isInstrumental === true) {
    status.textContent = 'Instrumental. This track has no words.';
    return;
  }
  const timed = dto.hasSynced === true && Array.isArray(dto.synced) ? dto.synced : [];
  const plain = typeof dto.unsynced === 'string' ? dto.unsynced : '';
  const texts = timed.length > 0 ? timed.map((line) => line.text) : plain.split(/\r?\n/);
  if (texts.every((text) => text.trim() === '')) {
    status.textContent = 'No lyrics found for this track.';
    return;
  }
  status.textContent = '';
  // Lyrics are untrusted third-party text, so they go through textContent only.
  rows = texts.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  });
  timedLines = timed;
  list.classList.toggle('is-synced', timed.length > 0);
  list.replaceChildren(...rows);
}

function clearLines() {
  timedLines = [];
  rows = [];
  cursor = null;
  activeIndex = -1;
  list.classList.remove('is-synced');
  list.replaceChildren();
}
