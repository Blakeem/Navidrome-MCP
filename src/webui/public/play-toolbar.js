// The Play Music toolbar: the add or replace toggle and the two shuffle toggles, kept per device.

import { byId } from './dom.js';
import { prefRead, prefWrite } from './prefs.js';

const PLAY_MODE_KEY = 'navidrome-mcp.play-mode';
const PLAY_SHUFFLE_SONGS_KEY = 'navidrome-mcp.play-shuffle-songs';
const PLAY_SHUFFLE_ALBUMS_KEY = 'navidrome-mcp.play-shuffle-albums';

const dialog = byId('play-dialog');
const shuffleSongsToggle = byId('shuffle-songs-toggle');
const shuffleAlbumsToggle = byId('shuffle-albums-toggle');

export function playMode() {
  const checked = dialog.querySelector('input[name="play-mode"]:checked');
  return checked !== null && checked.value === 'replace' ? 'replace' : 'append';
}

export function shuffleOptions() {
  return { shuffleSongs: isPressed(shuffleSongsToggle), shuffleAlbums: isPressed(shuffleAlbumsToggle) };
}

export function bindPlayToolbar(onModeChange) {
  // INPUT
  const mode = prefRead(PLAY_MODE_KEY) === 'replace' ? 'replace' : 'append';
  const shuffleSongs = prefRead(PLAY_SHUFFLE_SONGS_KEY) === 'true';
  const shuffleAlbums = prefRead(PLAY_SHUFFLE_ALBUMS_KEY) === 'true';

  // PROCESS
  for (const radio of modeRadios()) {
    radio.checked = radio.value === mode;
    radio.addEventListener('change', () => {
      prefWrite(PLAY_MODE_KEY, radio.value);
      onModeChange(radio.value);
    });
  }
  bindShuffleToggle(shuffleSongsToggle, PLAY_SHUFFLE_SONGS_KEY, shuffleSongs);
  bindShuffleToggle(shuffleAlbumsToggle, PLAY_SHUFFLE_ALBUMS_KEY, shuffleAlbums);

  // OUTPUT
  onModeChange(mode);
}

function modeRadios() {
  return dialog.querySelectorAll('input[name="play-mode"]');
}

function isPressed(button) {
  return button.getAttribute('aria-pressed') === 'true';
}

function bindShuffleToggle(button, key, pressed) {
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', () => {
    const next = !isPressed(button);
    button.setAttribute('aria-pressed', String(next));
    prefWrite(key, String(next));
  });
}
