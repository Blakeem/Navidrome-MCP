import { postJson } from './api.js';
import { FAVORITE_SOURCES } from './favorite-sources.js';
import { playMode, shuffleOptions } from './play-toolbar.js';

// Each play fetches for a varying time before it enqueues, so one POST at a time keeps click order.
let playChain = Promise.resolve();

export async function playLibraryItem(button, kind, id, name, status) {
  const mode = playMode();
  const favorite = FAVORITE_SOURCES[kind];
  const body = { type: kind, id, mode, ...shuffleOptions() };
  const hadFocus = document.activeElement === button;

  button.disabled = true;
  const request = playChain.then(() => postJson('/api/library/play', body));
  playChain = request;
  const { ok, data } = await request;
  button.disabled = false;
  // Disabling the focused button dropped focus to body.
  // A user who moved focus elsewhere during the request keeps it there.
  if (hadFocus && document.activeElement === document.body) button.focus({ preventScroll: true });
  const emptySource = !ok && data?.code === 'empty-source';

  if (emptySource) {
    status.textContent = favorite !== undefined ? favorite.emptyNotice : `Nothing to play in “${name}”.`;
    return;
  }
  if (!ok) {
    status.textContent = mode === 'replace' ? `Could not play “${name}”.` : `Could not add “${name}”.`;
    return;
  }
  if (mode === 'replace') {
    button.closest('dialog')?.close();
    return;
  }
  status.textContent = `Added “${name}” to the queue.`;
}
