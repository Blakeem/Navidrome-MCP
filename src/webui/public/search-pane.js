// The Search tab: one query across artists, albums and songs, or the recent plays when the query is empty.

import { getJson } from './api.js';
import { byId } from './dom.js';
import { buildLibraryNode } from './library-tree.js';

const query = byId('lib-query');
const searchBtn = byId('lib-search-btn');
const caption = byId('lib-caption');
const status = byId('lib-status');
const results = byId('lib-results');
const RESULT_GROUPS = [
  { kind: 'artist', key: 'artists', title: 'Artists' },
  { kind: 'album', key: 'albums', title: 'Albums' },
  { kind: 'song', key: 'songs', title: 'Songs' },
];

// Bumped on every load, so a slow response never paints over a newer one.
let generation = 0;
// Clearing the query returns to the recent plays only while search results are shown.
let showingSearch = false;

export function bindSearchPane() {
  searchBtn.addEventListener('click', () => void loadLibrary(query.value));
  query.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    // Enter implicitly submits the dialog's form, which would close the dialog.
    ev.preventDefault();
    void loadLibrary(query.value);
  });
  // The type=search clear button also fires `input`, so it lands here too.
  query.addEventListener('input', () => {
    if (showingSearch && query.value === '') void loadLibrary('');
  });
}

export function resetSearchPane() {
  query.value = '';
  status.textContent = '';
  void loadLibrary('');
}

async function loadLibrary(rawQuery) {
  // INPUT
  const text = rawQuery.trim();
  const isSearch = text !== '';
  const url = isSearch ? `/api/library/search?q=${encodeURIComponent(text)}` : '/api/library/recent';
  const shownCaption = isSearch ? `Results for “${text}”` : 'Your 5 most recently played artists, albums and songs.';
  const emptyCaption = isSearch ? `Nothing matched “${text}”.` : 'Nothing played yet.';
  const mine = generation + 1;
  let data = null;

  // PROCESS
  generation = mine;
  showingSearch = isSearch;
  caption.textContent = isSearch ? `Searching for “${text}”…` : 'Loading recently played…';
  results.replaceChildren();
  data = await getJson(url);
  if (mine !== generation) return;

  // OUTPUT
  if (data === null) {
    caption.textContent = 'Could not load results.';
    return;
  }
  const groups = RESULT_GROUPS
    .filter(({ key }) => Array.isArray(data[key]) && data[key].length > 0)
    .map(({ kind, key, title }) => buildResultGroup(title, kind, data[key]));
  caption.textContent = groups.length > 0 ? shownCaption : emptyCaption;
  results.replaceChildren(...groups);
}

function buildResultGroup(title, kind, items) {
  const group = document.createElement('div');
  const heading = document.createElement('h3');
  const list = document.createElement('ul');
  group.className = 'lib-group';
  heading.className = 'lib-group-title';
  heading.textContent = title;
  list.className = 'lib-list';
  list.append(...items.map((item) => buildLibraryNode(kind, item, 0, status)));
  group.append(heading, list);
  return group;
}
