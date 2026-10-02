// Transport actions shared by the main controls and the lyrics overlay. The play state
// changes only when the next snapshot confirms it, so a button never disagrees with mpv.

import { postJson } from './api.js';
import { isPaused, setPosition } from './playback-clock.js';

export function togglePlayPause() {
  void postJson(isPaused() ? '/api/controls/resume' : '/api/controls/pause');
}

export function previousTrack() {
  void postJson('/api/controls/previous');
}

export function nextTrack() {
  void postJson('/api/controls/next');
}

export function seekTo(seconds) {
  void postJson('/api/controls/seek', { seconds, mode: 'absolute' });
  setPosition(seconds);
}

export function controlAvailability(np) {
  const running = np?.engineRunning === true;
  return { running, hasTrack: running && (np.queueLength ?? 0) > 0 };
}
