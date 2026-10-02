// Interpolated playback position. Snapshots report it about once a second, so the
// progress bar and the lyrics overlay read a clock that keeps running between them.

let baseSeconds = 0;
let baseWallMs = 0;
let paused = true;
let duration = 0;

export function rebaseClock(np) {
  const running = np !== null && np.engineRunning;
  paused = np?.paused !== false;
  baseWallMs = Date.now();
  baseSeconds = running && typeof np.position === 'number' ? np.position : 0;
  duration = running && typeof np.duration === 'number' ? np.duration : 0;
}

export function isPaused() {
  return paused;
}

export function durationSeconds() {
  return duration;
}

export function positionSeconds(nowMs = Date.now()) {
  if (paused) return baseSeconds;
  const shown = baseSeconds + (nowMs - baseWallMs) / 1000;
  return duration > 0 && shown > duration ? duration : shown;
}

// A seek moves the clock at once, so the bar does not wait a second for the next snapshot.
export function setPosition(seconds) {
  baseSeconds = seconds;
  baseWallMs = Date.now();
}
