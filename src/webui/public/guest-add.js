// A guest, or the host on this page, adds songs to the end of the queue within the song limit. A tapped
// song shows as selected at once, and the song count changes only when the server confirms.

import { getJsonResult, postJson } from './api.js';
import { buildIcon, byId, setHidden, SYMBOL_VIEWBOX } from './dom.js';
import { answerSettled, ANSWER_GRACE_MS, buttonState, queuedSongs, sendAdds } from './guest-add-state.js';
import { removeConfirmText } from './queue-list.js';
import { formatTime } from './time-format.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const NO_ANSWER = 'The player did not answer. Check the connection and try again.';
const TOAST_MS = 4000;
const TOAST_FADE_MS = 200;
const ICON_ADD = 'M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z';
const ICON_CHECK = 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z';
const BUTTON_TEXT = { add: 'Add', pending: 'Adding…', added: 'Added', removing: 'Removing…', queued: 'In queue' };
const SELECTED_STATES = new Set(['pending', 'added', 'removing']);

const section = byId('guest-add');
const jump = byId('guest-add-jump');
const form = byId('guest-search-form');
const input = byId('guest-search-input');
const slots = byId('guest-slots');
const searchStatus = byId('guest-search-status');
const results = byId('guest-results');
const toast = byId('guest-toast');

// The last song count the server confirmed, from the stream or a request's answer.
let remaining = 0;
let limit = 0;
// Bumped on every search, so a slow answer never paints over a newer one.
let searchGeneration = 0;
// Bumped when a join card ends the session, so a request it started never lands in a later one.
let sessionGeneration = 0;
let drainingGeneration = null;
// Song id to song. sendAdds reads the Map's insertion order as the tap order.
const pending = new Map();
const removing = new Set();
// Song id to the server's answer, `{ added, entryId, at }`, held until a snapshot shows the same state.
const answers = new Map();
let queued = { mine: new Map(), others: new Set() };
let toastTimer = null;
let graceTimer = null;
let lastTapInAdd = false;

export function bindGuestAdd() {
  document.addEventListener('pointerdown', (event) => { lastTapInAdd = section.contains(event.target); }, { capture: true });
  jump.addEventListener('click', () => {
    section.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    input.focus({ preventScroll: true });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void search(input.value);
  });
}

// Every join card hides the section and ends the session, so nothing the session started may show in a later one.
export function showGuestAdd(visible) {
  setHidden(section, !visible);
  setHidden(jump, !visible);
  if (visible) return;
  sessionGeneration += 1;
  searchGeneration += 1;
  pending.clear();
  removing.clear();
  answers.clear();
  searchStatus.textContent = '';
  results.replaceChildren();
  clearTimeout(toastTimer);
  toast.classList.remove('is-shown');
  toast.textContent = '';
}

/**
 * Sections above Add songs change height with a snapshot, and Safari has no scroll anchoring. So Add songs
 * stays in place by hand while it is on screen and the reader last tapped inside it or has it in the top half.
 */
export function keepAddSongsInPlace(render) {
  const before = section.getBoundingClientRect().top;
  const reading = before < window.innerHeight && (before < window.innerHeight / 2 || lastTapInAdd);
  render();
  if (!reading) return;
  const shift = section.getBoundingClientRect().top - before;
  if (shift !== 0) window.scrollBy(0, shift);
}

export function renderSlots(jukebox) {
  if (typeof jukebox.limit !== 'number' || typeof jukebox.remaining !== 'number') return;
  remaining = jukebox.remaining;
  limit = jukebox.limit;
  paintSlots();
  paintButtons();
}

export function renderAddState(items) {
  queued = queuedSongs(items);
  paintButtons();
}

/** The queue's remove button confirms first, so this only sends the removal. */
export async function removeSong(item) {
  const generation = sessionGeneration;
  removing.add(item.songId);
  paintButtons();
  const { ok, status, data } = await postJson('/api/guest/queue/remove', { entryId: item.entryId });
  if (generation !== sessionGeneration) return;
  removing.delete(item.songId);
  if (ok) {
    answers.set(item.songId, { added: false, entryId: null, at: Date.now() });
    applyRemaining(data.remaining);
  }
  if (status !== 401) showToast(ok ? `Removed ${songTitle(item)}.` : (data?.error ?? NO_ANSWER));
  paintButtons();
}

function songTitle(song) {
  return song.title || 'the song';
}

function paintSlots() {
  slots.textContent = `${remaining} of ${limit} songs left`;
}

function applyRemaining(value) {
  if (typeof value !== 'number') return;
  remaining = value;
  paintSlots();
}

// The text leaves once the toast fades, so a screen reader never finds a stale message in the status region.
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-shown');
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-shown');
    toastTimer = setTimeout(() => { toast.textContent = ''; }, TOAST_FADE_MS);
  }, TOAST_MS);
}

// An answer that outlives its grace with no snapshot to clear it still needs a repaint.
function pruneAnswers() {
  const now = Date.now();
  for (const [songId, answer] of answers) {
    if (answerSettled(songId, answer, queued.mine, now)) answers.delete(songId);
  }
  clearTimeout(graceTimer);
  if (answers.size > 0) graceTimer = setTimeout(paintButtons, ANSWER_GRACE_MS);
}

function paintButtons() {
  pruneAnswers();
  const view = { pending, removing, answers, mine: queued.mine, others: queued.others };
  const openSlots = remaining - pending.size;
  for (const button of results.querySelectorAll('button.guest-add-btn')) {
    paintButton(button, buttonState(button.dataset.songId, view), openSlots);
  }
}

// A snapshot arrives about once a second, so an unchanged button keeps its children and the row under a finger survives.
function paintButton(button, state, openSlots) {
  const disabled = state === 'pending' || state === 'removing' || state === 'queued' || (state === 'add' && openSlots <= 0);
  if (button.dataset.state === state) {
    button.disabled = disabled;
    return;
  }
  button.dataset.state = state;
  button.replaceChildren(buildIcon('', SELECTED_STATES.has(state) ? ICON_CHECK : ICON_ADD, SYMBOL_VIEWBOX), BUTTON_TEXT[state]);
  button.setAttribute('aria-label', `${BUTTON_TEXT[state]}: ${button.dataset.title}`);
  button.disabled = disabled;
}

async function search(query) {
  const trimmed = query.trim();
  if (trimmed === '') return;
  const mine = ++searchGeneration;
  searchStatus.textContent = 'Searching…';
  const { ok, data } = await getJsonResult(`/api/guest/search?q=${encodeURIComponent(trimmed)}`);
  if (mine !== searchGeneration) return;
  if (!ok) {
    searchStatus.textContent = data?.error ?? NO_ANSWER;
    return;
  }
  const songs = Array.isArray(data?.songs) ? data.songs : [];
  searchStatus.textContent = songs.length === 0 ? 'No songs match that search.' : '';
  results.replaceChildren(...songs.map(buildResultRow));
  paintButtons();
}

function buildResultRow(song) {
  const li = document.createElement('li');
  const row = document.createElement('div');
  const main = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const dur = document.createElement('span');
  const button = document.createElement('button');

  row.className = 'qrow guest-qrow';
  main.className = 'qmain';
  title.className = 'qtitle';
  artist.className = 'qartist';
  dur.className = 'qdur';
  title.textContent = song.title || 'Unknown title';
  artist.textContent = [song.artist, song.album].filter(Boolean).join(' · ');
  dur.textContent = song.duration ? formatTime(song.duration) : '';
  button.type = 'button';
  button.className = 'btn-secondary guest-add-btn';
  button.dataset.songId = song.id;
  button.dataset.title = title.textContent;
  button.addEventListener('click', () => onButton(song, button));
  main.append(title, artist);
  row.append(main, dur, button);
  li.appendChild(row);
  return li;
}

function onButton(song, button) {
  if (button.dataset.state === 'added') {
    void removeFromResults(song);
    return;
  }
  pending.set(song.id, song);
  paintButtons();
  void drainAdds();
}

async function removeFromResults(song) {
  const entryId = queued.mine.get(song.id) ?? answers.get(song.id)?.entryId;
  if (typeof entryId !== 'number' || !window.confirm(removeConfirmText(song, 'guest'))) return;
  await removeSong({ songId: song.id, entryId, title: song.title });
}

// Each session runs its own loop, so a loop still waiting out the add rate after a join card never blocks the next.
async function drainAdds() {
  const generation = sessionGeneration;
  if (drainingGeneration === generation) return;
  drainingGeneration = generation;
  await sendAdds(pending, {
    post: (songId) => postJson('/api/guest/queue', { songId }),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isLive: () => generation === sessionGeneration,
    onAnswer: applyAddAnswer,
  });
  if (drainingGeneration === generation) drainingGeneration = null;
}

function applyAddAnswer(song, { ok, data }) {
  if (ok) {
    answers.set(song.id, { added: true, entryId: data.entryId, at: Date.now() });
    applyRemaining(data.remaining);
  }
  showToast(ok ? `Added ${songTitle(song)}.` : (data?.error ?? NO_ANSWER));
  paintButtons();
}
