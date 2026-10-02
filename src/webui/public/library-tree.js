// Rows of the Play Music dialog. An artist row expands into its albums and an album row into its songs.

import { getJson } from './api.js';
import { buildIcon } from './dom.js';
import { FAVORITE_SOURCES } from './favorite-sources.js';
import { playLibraryItem } from './library-play.js';
import { playMode } from './play-toolbar.js';

const ICON_NOTE = 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3Z';
const ICON_PLUS = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';
const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_CHEVRON = 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z';
const ICON_HEART = 'm12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
const CHILD_SOURCES = {
  artist: { url: '/api/library/artist-albums', key: 'albums', kind: 'album', noun: 'albums' },
  album: { url: '/api/library/album-songs', key: 'songs', kind: 'song', noun: 'songs' },
};

// aria-controls needs a page-unique id, and one album can be listed at two depths at once.
let childListSeq = 0;

// `status` is the pane's status line, so a row's play feedback stays in the pane that lists it.
export function buildLibraryNode(kind, item, depth, status) {
  // INPUT
  const fields = libraryRowFields(kind, item, depth);
  const childSource = CHILD_SOURCES[kind];
  const node = document.createElement('li');
  const row = document.createElement('div');
  const main = document.createElement('div');
  const text = document.createElement('div');
  const name = document.createElement('span');
  const meta = document.createElement('span');
  const action = document.createElement('button');

  // PROCESS
  node.className = 'lib-node';
  node.dataset.kind = kind;
  row.className = 'lib-row';
  main.className = 'lib-main';
  text.className = 'lib-text';
  name.className = 'lib-name';
  name.textContent = fields.name;
  meta.className = 'lib-meta';
  meta.textContent = fields.meta.filter((part) => typeof part === 'string' && part !== '').join(' · ');
  action.type = 'button';
  action.className = 'ghost-btn lib-action';
  action.dataset.name = fields.name;
  action.append(buildIcon('lib-icon-add', ICON_PLUS), buildIcon('lib-icon-play', ICON_PLAY));
  labelLibraryAction(action, playMode());
  action.addEventListener('click', () => void playLibraryItem(action, kind, item.id, fields.name, status));

  // OUTPUT
  text.append(name, meta);
  if (fields.thumb) main.appendChild(fields.glyph === undefined ? buildLibraryThumb(fields.coverId) : buildThumbPlaceholder(fields.glyph));
  main.appendChild(text);
  row.append(main, action);
  node.appendChild(row);
  if (childSource !== undefined) bindLibraryExpander({ node, row, main, source: childSource, id: item.id, name: fields.name, depth, status });
  return node;
}

export function relabelLibraryActions(root, mode) {
  for (const button of root.querySelectorAll('.lib-action')) labelLibraryAction(button, mode);
}

function labelLibraryAction(button, mode) {
  const name = button.dataset.name ?? '';
  button.setAttribute('aria-label', mode === 'replace' ? `Play “${name}” now` : `Add “${name}” to the queue`);
}

function countLabel(count, noun) {
  if (typeof count !== 'number') return '';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// Artist and playlist cover ids carry the `ar-` and `pl-` prefixes, and a song shows its album's cover.
// A nested row omits what its parent row already shows: an album its artist, a song its album and cover.
function libraryRowFields(kind, item, depth) {
  const nested = depth > 0;
  const favorite = FAVORITE_SOURCES[kind];
  if (favorite !== undefined) {
    return { name: favorite.name, meta: [countLabel(item[favorite.countKey], favorite.noun)], coverId: null, glyph: ICON_HEART, thumb: true };
  }
  if (kind === 'playlist') {
    return { name: item.name ?? '', meta: [countLabel(item.songCount, 'song'), item.durationFormatted], coverId: `pl-${item.id}`, thumb: true };
  }
  if (kind === 'artist') {
    return { name: item.name ?? '', meta: [countLabel(item.albumCount, 'album')], coverId: `ar-${item.id}`, thumb: true };
  }
  if (kind === 'album' && nested) {
    const year = typeof item.releaseYear === 'number' ? String(item.releaseYear) : '';
    return { name: item.name ?? '', meta: [year, countLabel(item.songCount, 'song')], coverId: item.id, thumb: true };
  }
  if (kind === 'album') {
    return { name: item.name ?? '', meta: [item.artist, countLabel(item.songCount, 'song')], coverId: item.id, thumb: true };
  }
  if (nested) {
    return { name: item.title ?? '', meta: [item.durationFormatted], coverId: null, thumb: false };
  }
  return { name: item.title ?? '', meta: [item.artist, item.album, item.durationFormatted], coverId: item.albumId, thumb: true };
}

function buildThumbPlaceholder(glyph = ICON_NOTE) {
  const tile = document.createElement('span');
  tile.className = 'lib-thumb lib-thumb-empty';
  tile.appendChild(buildIcon('lib-thumb-glyph', glyph));
  return tile;
}

function buildLibraryThumb(coverId) {
  if (typeof coverId !== 'string' || coverId === '') return buildThumbPlaceholder();
  const img = document.createElement('img');
  img.className = 'lib-thumb';
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.width = 40;
  img.height = 40;
  // A cover the server cannot find shows the neutral tile, never a broken-image icon.
  img.addEventListener('error', () => img.replaceWith(buildThumbPlaceholder()), { once: true });
  img.src = `/api/cover/${encodeURIComponent(coverId)}?size=96`;
  return img;
}

function buildLibraryNotice(message) {
  const notice = document.createElement('li');
  notice.className = 'lib-notice';
  notice.textContent = message;
  return notice;
}

function labelLibraryToggle(toggle, noun, name, expanded) {
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} ${noun} of “${name}”`);
}

// The chevron is the keyboard control. A click on the row's main area is a pointer shortcut.
function bindLibraryExpander({ node, row, main, source, id, name, depth, status }) {
  // INPUT
  const list = document.createElement('ul');
  const toggle = document.createElement('button');
  let loadState = 'idle';
  const onToggle = async () => {
    const expanded = list.hidden;
    list.hidden = !expanded;
    node.classList.toggle('is-expanded', expanded);
    labelLibraryToggle(toggle, source.noun, name, expanded);
    if (!expanded || loadState !== 'idle') return;
    loadState = 'loading';
    loadState = (await loadLibraryChildren({ node, list, source, id, depth, status })) ? 'loaded' : 'idle';
  };

  // PROCESS
  childListSeq += 1;
  list.id = `lib-children-${childListSeq}`;
  list.className = 'lib-children';
  list.hidden = true;
  // A created button defaults to submit, which would close the dialog through its form.
  toggle.type = 'button';
  toggle.className = 'ghost-btn lib-toggle';
  toggle.setAttribute('aria-controls', list.id);
  toggle.appendChild(buildIcon('lib-chevron', ICON_CHEVRON));
  labelLibraryToggle(toggle, source.noun, name, false);
  toggle.addEventListener('click', () => void onToggle());
  main.addEventListener('click', () => void onToggle());

  // OUTPUT
  row.appendChild(toggle);
  node.appendChild(list);
}

// Resolves true once the children are rendered, false when the next expand must fetch again.
async function loadLibraryChildren({ node, list, source, id, depth, status }) {
  // INPUT
  const url = `${source.url}?id=${encodeURIComponent(id)}`;
  let data = null;
  let items = null;

  // PROCESS
  list.replaceChildren(buildLibraryNotice('Loading…'));
  data = await getJson(url);
  // A new search replaced the results while this load was in flight.
  if (!node.isConnected) return false;
  items = data !== null && Array.isArray(data[source.key]) ? data[source.key] : null;

  // OUTPUT
  if (items === null) {
    list.replaceChildren(buildLibraryNotice(`Could not load ${source.noun}.`));
    return false;
  }
  if (items.length === 0) {
    list.replaceChildren(buildLibraryNotice(`No ${source.noun}.`));
    return true;
  }
  list.replaceChildren(...items.map((child) => buildLibraryNode(source.kind, child, depth + 1, status)));
  return true;
}
