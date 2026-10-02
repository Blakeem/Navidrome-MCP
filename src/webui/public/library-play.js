// The play or add request behind every row action in the Play Music dialog.

import { postJson } from './api.js';
import { FAVORITE_SOURCES } from './favorite-sources.js';
import { playMode, shuffleOptions } from './play-toolbar.js';

// The server enqueues after an uneven fetch, so one POST at a time keeps the queue in click order.
let playChain = Promise.resolve();

export async function playLibraryItem(button, kind, id, name, status) {
  // INPUT
  const mode = playMode();
  const favorite = FAVORITE_SOURCES[kind];
  const body = { type: kind, id, mode, ...shuffleOptions() };

  // PROCESS
  button.disabled = true;
  const request = playChain.then(() => postJson('/api/library/play', body));
  playChain = request;
  const { ok, data } = await request;
  button.disabled = false;
  const emptySource = !ok && data?.code === 'empty-source';

  // OUTPUT
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
