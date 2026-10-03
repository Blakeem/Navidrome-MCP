// The Play Music dialog: its tabs, its placement below the top bar, and the toolbar's effect on the rows.

import { byId } from './dom.js';
import { loadFavoritesPane } from './favorites-pane.js';
import { relabelLibraryActions } from './library-tree.js';
import { placeBelowTopbar } from './modal-placement.js';
import { bindPlayToolbar } from './play-toolbar.js';
import { loadPlaylistsPane } from './playlists-pane.js';
import { bindSearchPane, resetSearchPane } from './search-pane.js';

const dialog = byId('play-dialog');
const openButton = byId('open-play-dialog');
const TABS = {
  search: { tab: byId('play-tab-search'), pane: byId('play-pane-search') },
  playlists: { tab: byId('play-tab-playlists'), pane: byId('play-pane-playlists') },
  favorites: { tab: byId('play-tab-favorites'), pane: byId('play-pane-favorites') },
};

export function bindPlayDialog() {
  for (const [name, { tab }] of Object.entries(TABS)) tab.addEventListener('click', () => switchTab(name));
  window.addEventListener('resize', () => {
    if (dialog.open) placeBelowTopbar(dialog);
  });
  openButton.addEventListener('click', openPlayDialog);
  bindPlayToolbar(applyPlayMode);
  bindSearchPane();
}

// Every open starts on the Search tab, showing the recent plays.
function openPlayDialog() {
  switchTab('search');
  resetSearchPane();
  void loadFavoritesPane();
  void loadPlaylistsPane();
  placeBelowTopbar(dialog);
  dialog.showModal();
}

function switchTab(name) {
  for (const [key, { tab, pane }] of Object.entries(TABS)) {
    const active = key === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    pane.hidden = !active;
  }
}

// The dialog's data-mode picks which icon CSS shows in every pane, and each button's label names the action.
function applyPlayMode(mode) {
  dialog.dataset.mode = mode;
  relabelLibraryActions(dialog, mode);
}
