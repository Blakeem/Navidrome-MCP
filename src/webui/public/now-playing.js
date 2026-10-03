// The now-playing card: title, artist, album, queue position, state badge and cover.

import { mountCover } from './cover.js';
import { byId } from './dom.js';
import { playingIndex, queueSongId } from './snapshot.js';

const coverWrap = byId('cover');
const badge = byId('state-badge');
const title = byId('track-title');
const artist = byId('track-artist');
const album = byId('track-album');
const queuePos = byId('queue-pos');

let coverSongId = null;

export function renderNowPlaying(np) {
  renderTrackInfo(np);
  renderCover(np);
}

function renderTrackInfo(np) {
  if (playingIndex(np) === null) {
    title.textContent = 'No track loaded';
    artist.textContent = '';
    album.textContent = '';
    queuePos.textContent = '';
    setBadge('idle', 'Idle');
    return;
  }
  title.textContent = np.title ?? 'Unknown title';
  artist.textContent = np.artist ?? '';
  album.textContent = np.album ?? '';
  queuePos.textContent = typeof np.queueIndex === 'number' && typeof np.queueLength === 'number'
    ? `${np.queueIndex + 1} / ${np.queueLength}`
    : '';

  if (np.isRadio === true) {
    setBadge('radio', np.radioStation?.name ? `Radio · ${np.radioStation.name}` : 'Radio');
  } else if (np.paused === true) {
    setBadge('paused', 'Paused');
  } else if (np.paused === false) {
    setBadge('playing', 'Playing');
  } else {
    setBadge('idle', 'Idle');
  }
}

function setBadge(state, text) {
  badge.dataset.state = state;
  badge.textContent = text;
}

// Subsonic getCoverArt takes a song id and returns its album art, so one lookup per track is enough.
function renderCover(np) {
  const index = playingIndex(np);
  const songId = index === null ? null : queueSongId(index);
  if (songId === coverSongId) return;
  coverSongId = songId;
  mountCover(coverWrap, songId, () => coverSongId === songId);
}
