// The Playlists tab.

import { getJson } from './api.js';
import { byId } from './dom.js';
import { buildLibraryNode } from './library-tree.js';

const list = byId('playlists-list');
const status = byId('playlists-status');

export async function loadPlaylistsPane() {
  status.textContent = 'Loading playlists…';
  list.replaceChildren();
  const data = await getJson('/api/playlists');
  // A failed read says so, instead of the "No playlists found" an empty list would show.
  if (data === null) {
    status.textContent = 'Could not load playlists.';
    return;
  }
  // A /api/playlists row carries its id as `playlistId`, and the row builder posts `item.id`.
  const rows = (data.playlists ?? []).map((pl) => buildLibraryNode('playlist', { ...pl, id: pl.playlistId }, 0, status));
  status.textContent = rows.length > 0 ? '' : 'No playlists found.';
  list.replaceChildren(...rows);
}
