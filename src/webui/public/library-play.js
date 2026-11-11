import { postJson } from './api.js';
import { byId } from './dom.js';
import { FAVORITE_SOURCES } from './favorite-sources.js';
import { clearMessage, showMessage } from './messages.js';
import { isOutputMissing, revealOutputBanner } from './output-banner.js';
import { playMode, shuffleOptions } from './play-toolbar.js';

// The Play Music dialog's status bar sits outside the scrolling panes, so a result shows whichever pane is open.
const statusLine = byId('play-status');

// Each play fetches for a varying time before it enqueues, so one POST at a time keeps click order.
let playChain = Promise.resolve();

export async function playLibraryItem(button, kind, id, name) {
  const mode = playMode();
  const favorite = FAVORITE_SOURCES[kind];
  const body = { type: kind, id, mode, ...shuffleOptions() };
  const hadFocus = document.activeElement === button;

  clearMessage(statusLine);
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
    showMessage(statusLine, favorite !== undefined ? favorite.emptyNotice : `Nothing to play in “${name}”.`, 'warning');
    return;
  }
  if (!ok) {
    showMessage(statusLine, mode === 'replace' ? `Could not play “${name}”.` : `Could not add “${name}”.`, 'error');
    return;
  }
  if (mode === 'replace') {
    button.closest('dialog')?.close();
  } else {
    showMessage(statusLine, `Added “${name}” to the queue.`, 'success');
  }
  if (isOutputMissing(data)) revealOutputBanner();
}
