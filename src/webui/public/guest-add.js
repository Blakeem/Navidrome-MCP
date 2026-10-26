// A guest adds songs to the end of the queue within the host's limit. The server enforces every
// rule, so this module only shows what the server answers.

import { getJsonResult, postJson } from './api.js';
import { byId, setHidden } from './dom.js';
import { formatTime } from './time-format.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const NO_ANSWER = 'The player did not answer. Check the connection and try again.';

const section = byId('guest-add');
const jump = byId('guest-add-jump');
const form = byId('guest-search-form');
const input = byId('guest-search-input');
const slots = byId('guest-slots');
const status = byId('guest-add-status');
const results = byId('guest-results');

// The last `jukebox.remaining` from the stream, so a result rendered between snapshots knows whether to enable Add.
let remaining = 0;
// Bumped on every search, so a slow answer never paints over a newer one.
let searchGeneration = 0;

export function bindGuestAdd() {
  jump.addEventListener('click', () => {
    section.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    input.focus({ preventScroll: true });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void search(input.value);
  });
}

// The host previews the guest page under its admin session, which cannot add guest songs, so the
// header button that jumps to the section hides with it.
export function showGuestAdd(canQueue) {
  setHidden(section, !canQueue);
  setHidden(jump, !canQueue);
}

export function renderSlots(jukebox) {
  if (typeof jukebox.limit !== 'number' || typeof jukebox.remaining !== 'number') return;
  remaining = jukebox.remaining;
  slots.textContent = `${jukebox.remaining} of ${jukebox.limit} songs left`;
  for (const button of results.querySelectorAll('button.guest-add-btn:not([data-added])')) button.disabled = remaining === 0;
}

function showGuestMessage(message) {
  status.textContent = message;
}

export async function removeSong(entryId) {
  showGuestMessage('');
  const { ok, data } = await postJson('/api/guest/queue/remove', { entryId });
  if (!ok) showGuestMessage(data?.error ?? NO_ANSWER);
}

async function search(query) {
  const trimmed = query.trim();
  if (trimmed === '') return;
  const mine = ++searchGeneration;
  showGuestMessage('Searching…');
  const { ok, data } = await getJsonResult(`/api/guest/search?q=${encodeURIComponent(trimmed)}`);
  if (mine !== searchGeneration) return;
  if (!ok) {
    showGuestMessage(data?.error ?? NO_ANSWER);
    return;
  }
  const songs = Array.isArray(data?.songs) ? data.songs : [];
  showGuestMessage(songs.length === 0 ? 'No songs match that search.' : '');
  results.replaceChildren(...songs.map(buildResultRow));
}

function buildResultRow(song) {
  const li = document.createElement('li');
  const row = document.createElement('div');
  const main = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const dur = document.createElement('span');
  const add = document.createElement('button');

  row.className = 'qrow guest-qrow';
  main.className = 'qmain';
  title.className = 'qtitle';
  artist.className = 'qartist';
  dur.className = 'qdur';
  title.textContent = song.title || 'Unknown title';
  artist.textContent = [song.artist, song.album].filter(Boolean).join(' · ');
  dur.textContent = song.duration ? formatTime(song.duration) : '';
  add.type = 'button';
  add.className = 'btn-secondary guest-add-btn';
  add.textContent = 'Add';
  add.setAttribute('aria-label', `Add ${title.textContent} to the queue`);
  add.disabled = remaining === 0;
  add.addEventListener('click', () => void addSong(song, add));
  main.append(title, artist);
  row.append(main, dur, add);
  li.appendChild(row);
  return li;
}

async function addSong(song, button) {
  button.disabled = true;
  showGuestMessage('');
  const { ok, data } = await postJson('/api/guest/queue', { songId: song.id });
  if (!ok) {
    button.disabled = remaining === 0;
    showGuestMessage(data?.error ?? NO_ANSWER);
    return;
  }
  button.dataset.added = 'true';
  button.textContent = 'Added';
  showGuestMessage(`Added ${song.title || 'the song'} to the end of the queue.`);
}
