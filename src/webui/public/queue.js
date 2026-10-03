// The live queue list with its count, shuffle and clear controls.

import { postJson } from './api.js';
import { buildIcon, byId, ICON_PLAY } from './dom.js';
import { currentQueue, playingIndex } from './snapshot.js';
import { formatTime } from './time-format.js';

const queueList = byId('queue-list');
const queueCount = byId('queue-count');
const shuffleQueue = byId('shuffle-queue');
const clearQueue = byId('clear-queue');

// The queue identity in the DOM. A rebuild at the 1 Hz snapshot rate would recreate
// the row under the pointer between press and release, and the click would be lost.
let renderedSignature = null;
// The index last revealed, so a routine snapshot never scrolls a list the reader moved.
let revealedIndex = null;

export function bindQueue() {
  shuffleQueue.addEventListener('click', () => void postJson('/api/controls/shuffle'));
  clearQueue.addEventListener('click', () => {
    const queue = currentQueue();
    const count = queue.length ?? (queue.items?.length ?? 0);
    if (count > 0 && !window.confirm('Clear the queue and stop playback?')) return;
    void postJson('/api/controls/clear');
  });
}

export function renderQueue(queue) {
  const items = queue.items ?? [];
  const queueLength = queue.length ?? items.length;
  queueCount.textContent = String(queueLength);
  shuffleQueue.disabled = queueLength === 0;
  if (items.length === 0) {
    if (renderedSignature !== '') {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Queue is empty';
      queueList.replaceChildren(empty);
      renderedSignature = '';
    }
    return;
  }

  const signature = items.map((it) => `${it.index}:${it.songId ?? ''}`).join('|');
  if (signature === renderedSignature) {
    refreshRows(items);
    return;
  }
  queueList.replaceChildren(...items.map(buildQueueRow));
  renderedSignature = signature;
}

// Scrolls only the list, never the page, so the card and controls stay where the reader left them.
export function revealCurrentRow(np) {
  const index = playingIndex(np);
  if (index === revealedIndex) return;
  revealedIndex = index;
  if (index === null) return;

  const current = queueList.querySelector('li.current');
  if (current === null) return;
  const rowRect = current.getBoundingClientRect();
  const listRect = queueList.getBoundingClientRect();
  if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) return;
  // scrollIntoView would also scroll the page, which on a phone moves the card off screen.
  queueList.scrollTo({ top: rowRect.top - listRect.top + queueList.scrollTop, behavior: 'smooth' });
}

// Server enrichment can fill a row's metadata after first paint while its signature
// stays the same, so the text refreshes on every snapshot to match the aria-label.
function refreshRows(items) {
  const rows = queueList.children;
  for (let i = 0; i < rows.length && i < items.length; i++) {
    const li = rows[i];
    const item = items[i];
    li.classList.toggle('current', item.isCurrent === true);
    li.querySelector('.qrow').setAttribute('aria-label', queueAriaLabel(item));
    fillQueueRowText(li, item);
  }
}

function buildQueueRow(item) {
  const li = document.createElement('li');
  const row = document.createElement('button');
  const icon = document.createElement('span');
  const num = document.createElement('span');
  const main = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const dur = document.createElement('span');

  if (item.isCurrent) li.classList.add('current');
  row.type = 'button';
  row.className = 'qrow';
  row.setAttribute('aria-label', queueAriaLabel(item));
  icon.className = 'qicon';
  icon.appendChild(buildIcon('qicon-glyph', ICON_PLAY));
  num.className = 'qnum';
  main.className = 'qmain';
  title.className = 'qtitle';
  artist.className = 'qartist';
  dur.className = 'qdur';
  main.append(title, artist);
  row.append(icon, num, main, dur);
  li.appendChild(row);
  fillQueueRowText(li, item);

  // The live class is read at click time, since a kept row only flips it and `item` can be stale.
  row.addEventListener('click', () => {
    if (li.classList.contains('current')) return;
    void postJson('/api/controls/play-index', { index: item.index });
  });
  return li;
}

function queueTitle(item) {
  return item.title ?? (item.songId ?? 'Track');
}

function queueAriaLabel(item) {
  const titleLabel = queueTitle(item);
  return item.isCurrent ? `Currently playing: ${titleLabel}` : `Play track ${item.index + 1}: ${titleLabel}`;
}

function fillQueueRowText(li, item) {
  const parts = [item.artist, item.album].filter(Boolean);
  li.querySelector('.qnum').textContent = String(item.index + 1);
  li.querySelector('.qtitle').textContent = queueTitle(item);
  li.querySelector('.qartist').textContent = parts.join(' · ');
  li.querySelector('.qdur').textContent = item.duration ? formatTime(item.duration) : '';
}
