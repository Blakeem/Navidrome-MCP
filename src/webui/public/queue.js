import { postControl } from './controls.js';
import { byId } from './dom.js';
import { clearConfirmText, createQueueList } from './queue-list.js';
import { playingIndex } from './snapshot.js';

const queueList = byId('queue-list');
const queueCount = byId('queue-count');
const shuffleQueue = byId('shuffle-queue');
const clearQueue = byId('clear-queue');

const rows = createQueueList(queueList, {
  role: 'admin',
  onPlay: (item) => postControl('/api/controls/play-index', { index: item.index }),
  onRemove: (item) => postControl('/api/controls/queue/remove', { entryId: item.entryId }),
});

// Clear reads the items of the last snapshot, so its confirm counts the guest songs on screen.
let renderedItems = [];
// The index last revealed, so a routine snapshot never scrolls a list the reader moved.
let revealedIndex = null;

export function bindQueue() {
  shuffleQueue.addEventListener('click', () => void postControl('/api/controls/shuffle'));
  clearQueue.addEventListener('click', () => {
    const confirmText = clearConfirmText(renderedItems);
    if (confirmText !== null && !window.confirm(confirmText)) return;
    void postControl('/api/controls/clear');
  });
}

// currentIndex comes from playingIndex, the rule the card, the clock and the lyrics read.
export function renderQueue(queue, currentIndex, paused) {
  const items = queue.items ?? [];
  const queueLength = queue.length ?? items.length;
  queueCount.textContent = String(queueLength);
  shuffleQueue.disabled = queueLength === 0;
  clearQueue.disabled = queueLength === 0;
  renderedItems = items;
  rows.render(items, currentIndex, paused);
}

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
