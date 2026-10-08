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
const tabList = byId('play-tabs');
const TABS = {
  search: { tab: byId('play-tab-search'), pane: byId('play-pane-search') },
  playlists: { tab: byId('play-tab-playlists'), pane: byId('play-pane-playlists') },
  favorites: { tab: byId('play-tab-favorites'), pane: byId('play-pane-favorites') },
};

export function bindPlayDialog() {
  for (const [name, { tab }] of Object.entries(TABS)) tab.addEventListener('click', () => switchTab(name));
  tabList.addEventListener('keydown', onTabKeydown);
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
    tab.tabIndex = active ? 0 : -1;
    pane.hidden = !active;
  }
}

// The tab roles promise arrow-key movement to screen reader users, so the arrows, Home and End switch tabs.
function onTabKeydown(ev) {
  const names = Object.keys(TABS);
  const index = names.indexOf(ev.target.dataset.tab);
  let next = null;
  if (ev.key === 'ArrowRight') next = names[(index + 1) % names.length];
  else if (ev.key === 'ArrowLeft') next = names[(index - 1 + names.length) % names.length];
  else if (ev.key === 'Home') next = names[0];
  else if (ev.key === 'End') next = names[names.length - 1];
  if (next === null || index === -1) return;
  ev.preventDefault();
  switchTab(next);
  TABS[next].tab.focus();
}

// The dialog's data-mode picks which icon CSS shows in every pane, and each button's label names the action.
function applyPlayMode(mode) {
  dialog.dataset.mode = mode;
  relabelLibraryActions(dialog, mode);
}
