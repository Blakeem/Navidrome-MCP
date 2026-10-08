// The Favorites tab: one row for the starred albums and one for the starred songs.

import { getJson } from './api.js';
import { byId } from './dom.js';
import { FAVORITE_SOURCES } from './favorite-sources.js';
import { buildLibraryNode } from './library-tree.js';

const list = byId('favorites-list');
const status = byId('favorites-status');

// The rows render before the counts read, so a failed read leaves them playable without numbers.
export async function loadFavoritesPane() {
  status.textContent = '';
  renderFavoriteRows({});
  const counts = await getJson('/api/library/favorites');
  if (counts !== null) renderFavoriteRows(counts);
}

function renderFavoriteRows(counts) {
  list.replaceChildren(...Object.keys(FAVORITE_SOURCES).map((kind) => buildLibraryNode(kind, counts, 0, status)));
}
