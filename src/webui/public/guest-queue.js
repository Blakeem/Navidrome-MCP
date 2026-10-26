import { byId, setHidden } from './dom.js';
import { removeSong } from './guest-add.js';
import { createQueueList, hasMoreWaiting, queueWindow } from './queue-list.js';

const UPCOMING_LIMIT = 10;

const count = byId('guest-queue-count');
const more = byId('guest-queue-more');
const rows = createQueueList(byId('guest-queue-list'), {
  role: 'guest',
  onRemove: (item) => removeSong(item.entryId),
});

// A tap on the toggle redraws from the last snapshot, since the server sends the queue only when it changes.
let expanded = false;
let lastQueue = { items: [], currentIndex: null, paused: undefined };

export function bindGuestQueue() {
  more.addEventListener('click', () => {
    expanded = !expanded;
    draw();
  });
}

export function renderGuestQueue(queue, currentIndex, paused) {
  const items = queue?.items ?? [];
  count.textContent = String(queue?.length ?? items.length);
  lastQueue = { items, currentIndex, paused };
  draw();
}

function draw() {
  const { items, currentIndex, paused } = lastQueue;
  const hasMore = hasMoreWaiting(items, currentIndex, UPCOMING_LIMIT);
  const showAll = expanded && hasMore;
  rows.render(showAll ? items : queueWindow(items, currentIndex, UPCOMING_LIMIT), currentIndex, paused);
  more.setAttribute('aria-expanded', String(showAll));
  more.textContent = showAll ? 'Show fewer' : `Show all ${items.length}`;
  setHidden(more, !hasMore);
}
