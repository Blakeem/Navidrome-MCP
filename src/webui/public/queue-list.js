// One row builder for the admin and guest queues. The admin plays a row on tap and removes any row but
// the one playing. A guest cannot play or reorder the queue, and removes only its own unplayed songs.

import { buildIcon, ICON_PLAY } from './dom.js';
import { formatTime } from './time-format.js';

const ICON_TRASH = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';

function queueTitle(item) {
  return item.title ?? 'Unknown title';
}

// A guest removes only its own songs, so an untitled one reads as "your song".
function removeSubject(item, role) {
  return item.title ?? (role === 'guest' ? 'your song' : 'Unknown title');
}

/** Null means the removal runs at once. On the admin page only a song added from the guest page asks first. */
export function removeConfirmText(item, role) {
  if (role === 'guest') return `${removeLabel(item, role)}?`;
  return item.fromGuestPage === true ? `Remove ${queueTitle(item)}? ${item.addedBy} added it.` : null;
}

/** Null means Clear runs at once, since no song added from the guest page waits to be lost. */
export function clearConfirmText(items) {
  const waiting = items.filter((item) => item.guestWaiting === true).length;
  if (waiting === 0) return null;
  return waiting === 1
    ? 'Clear the queue? 1 song added from the guest page is removed.'
    : `Clear the queue? ${waiting} songs added from the guest page are removed.`;
}

export function removeLabel(item, role) {
  return `Remove ${removeSubject(item, role)} from the queue`;
}

/** A guest stream marks `mine` only on its own unplayed songs, so a guest never removes another guest's song. */
export function canRemove(item, role) {
  return typeof item.entryId === 'number' && (role === 'admin' || item.mine === true);
}

/**
 * The rows a collapsed queue shows: the playing row and the `limit` songs after it. With nothing
 * playing it starts at the top.
 */
export function queueWindow(items, currentIndex, limit) {
  const playing = items.findIndex((item) => item.index === currentIndex);
  if (playing === -1) return items.slice(0, limit);
  return items.slice(playing, playing + 1 + limit);
}

/**
 * True when more than `limit` songs wait after the playing row, or after the top when nothing plays.
 * Played rows stay in the queue, so a longer list alone does not mean more songs wait.
 */
export function hasMoreWaiting(items, currentIndex, limit) {
  const playing = items.findIndex((item) => item.index === currentIndex);
  return items.length - (playing === -1 ? 0 : playing + 1) > limit;
}

/** The server refuses the current entry unless mpv is paused, since removing it skips it. Unknown pause counts as playing. */
export function removeRefused(isCurrent, paused) {
  return isCurrent && paused !== true;
}

/**
 * `onPlay(item)` runs for a tap on an admin row that is not playing. `onRemove(item)` runs after any
 * confirm and returns a promise, so the button stays disabled until the request ends.
 */
export function createQueueList(list, { role, onPlay, onRemove }) {
  // A rebuild on every 1 Hz snapshot would recreate the row under the pointer between press and
  // release, and reset the reader's scroll inside the list.
  let renderedSignature = null;
  // A kept row outlives the item it was built from, so a tap reads the item the last snapshot gave it.
  const rowItems = new WeakMap();

  function render(items, currentIndex, paused) {
    if (items.length === 0) {
      if (renderedSignature === '') return;
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Queue is empty';
      list.replaceChildren(empty);
      renderedSignature = '';
      return;
    }

    const signature = items
      .map((it) => `${it.index}:${it.entryId ?? ''}:${it.songId ?? ''}:${canRemove(it, role) ? 'r' : ''}`)
      .join('|');
    if (signature !== renderedSignature) {
      list.replaceChildren(...items.map((item) => buildRow(item)));
      renderedSignature = signature;
    }
    refreshRows(items, currentIndex, paused);
  }

  function buildRow(item) {
    const li = document.createElement('li');
    const row = role === 'admin' ? buildPlayButton(li) : document.createElement('div');
    const num = document.createElement('span');
    const main = document.createElement('span');
    const title = document.createElement('span');
    const artist = document.createElement('span');
    const guest = document.createElement('span');
    const dur = document.createElement('span');

    li.className = 'qitem';
    rowItems.set(li, item);
    if (role !== 'admin') row.className = 'qrow guest-qrow';
    num.className = 'qnum';
    main.className = 'qmain';
    title.className = 'qtitle';
    artist.className = 'qartist';
    guest.className = 'qguest';
    dur.className = 'qdur';
    main.append(title, artist, guest);
    row.append(num, main, dur);
    li.appendChild(row);
    if (canRemove(item, role)) li.appendChild(buildRemoveButton(li));
    return li;
  }

  function buildPlayButton(li) {
    const row = document.createElement('button');
    const icon = document.createElement('span');
    row.type = 'button';
    row.className = 'qrow';
    icon.className = 'qicon';
    icon.appendChild(buildIcon('qicon-glyph', ICON_PLAY));
    row.appendChild(icon);
    // The live class is read at click time, since a kept row only flips it.
    row.addEventListener('click', () => {
      if (!li.classList.contains('current')) void onPlay(rowItems.get(li));
    });
    return row;
  }

  function buildRemoveButton(li) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost-btn qremove';
    button.appendChild(buildIcon('qremove-icon', ICON_TRASH));
    button.addEventListener('click', () => {
      const item = rowItems.get(li);
      const confirmText = removeConfirmText(item, role);
      if (confirmText !== null && !window.confirm(confirmText)) return;
      button.disabled = true;
      void onRemove(item).finally(() => { button.disabled = false; });
    });
    return button;
  }

  // Server enrichment can fill a row's metadata after first paint while its signature stays the same.
  function refreshRows(items, currentIndex, paused) {
    const rows = list.children;
    for (let i = 0; i < rows.length && i < items.length; i++) {
      const li = rows[i];
      const item = items[i];
      const isCurrent = item.index === currentIndex;
      rowItems.set(li, item);
      li.classList.toggle('current', isCurrent);
      li.classList.toggle('mine', item.mine === true);
      if (role === 'admin') li.querySelector('.qrow').setAttribute('aria-label', rowAriaLabel(item, isCurrent));
      fillRowText(li, item);
      const remove = li.querySelector('.qremove');
      if (remove !== null) {
        remove.hidden = removeRefused(isCurrent, paused);
        remove.setAttribute('aria-label', removeLabel(item, role));
      }
    }
  }

  return { render };
}

// The badge text sits inside the admin button, whose aria-label replaces it, so the label names the adder too.
function rowAriaLabel(item, isCurrent) {
  const titleLabel = item.addedBy ? `${queueTitle(item)}, added by ${item.addedBy}` : queueTitle(item);
  return isCurrent ? `Currently playing: ${titleLabel}` : `Play track ${item.index + 1}: ${titleLabel}`;
}

function fillRowText(li, item) {
  const parts = [item.artist, item.album].filter(Boolean);
  li.querySelector('.qnum').textContent = String(item.index + 1);
  li.querySelector('.qtitle').textContent = queueTitle(item);
  li.querySelector('.qartist').textContent = parts.join(' · ');
  li.querySelector('.qguest').textContent = item.addedBy ? `Added by ${item.addedBy}` : '';
  li.querySelector('.qdur').textContent = item.duration ? formatTime(item.duration) : '';
}
