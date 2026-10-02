// The lyrics overlay: opening and closing it, its full screen or window view, and its track changes.

import { mountCover } from './cover.js';
import { byId, setHidden } from './dom.js';
import { clearLyricsSlew, rebaseLyricsClock, snapLyricsClock } from './lyrics-clock.js';
import { showLyricsFor } from './lyrics-content.js';
import { lyricsFor } from './lyrics-data.js';
import {
  bindFollow,
  recenterActiveLine,
  resetFollowFrame,
  resumeFollow,
  seekToTappedLine,
  setFollowing,
  suspendFollow,
  tickLyricsFollow,
} from './lyrics-follow.js';
import { bindLyricPrefs, lyricsSettingsOpen } from './lyrics-prefs.js';
import { bindLyricsTransport, renderLyricsPlayState, renderLyricsProgress } from './lyrics-transport.js';
import { placeBelowTopbar } from './modal-placement.js';
import { isPaused } from './playback-clock.js';
import { prefRead, prefWrite } from './prefs.js';
import { currentNowPlaying, playingIndex, queueSongId } from './snapshot.js';
import { acquireWakeHold, bindWakeHold, releaseWakeHold } from './wake-hold.js';

const VIEW_KEY = 'navidrome-mcp.lyrics-view';

const view = byId('lyrics-view');
const backdrop = byId('lyrics-backdrop');
const openBtn = byId('open-lyrics');
const backBtn = byId('lyrics-back');
const closeBtn = byId('lyrics-close');
const viewToggle = byId('lyrics-view-toggle');
const iconToWindow = byId('lyrics-icon-window');
const iconToFull = byId('lyrics-icon-full');
const title = byId('lyrics-title');
const artist = byId('lyrics-artist');
const cover = byId('lyrics-cover');
const thumb = byId('lyrics-thumb');
const scrollBox = byId('lyrics-scroll');
const lines = byId('lyrics-lines');
const topbar = document.querySelector('.topbar');
const main = document.querySelector('main');

let open = false;
// The window view is a per-device choice, like the other reading preferences.
let windowed = prefRead(VIEW_KEY) === 'window';
// Starts undefined rather than null, so the first snapshot paints an initial state even with nothing playing.
let shownSongId = undefined;
let raf = null;

export function bindLyricsView() {
  openBtn.addEventListener('click', openLyrics);
  backBtn.addEventListener('click', closeLyrics);
  closeBtn.addEventListener('click', closeLyrics);
  viewToggle.addEventListener('click', toggleViewMode);
  scrollBox.addEventListener('click', () => {
    view.classList.toggle('is-immersive');
    // A gesture that ends in a click was a tap, so the suspend its pointerdown armed is taken back.
    resumeFollow();
  });
  scrollBox.addEventListener('pointerdown', suspendFollow);
  scrollBox.addEventListener('touchstart', suspendFollow, { passive: true });
  scrollBox.addEventListener('wheel', suspendFollow, { passive: true });
  lines.addEventListener('click', seekToTappedLine);
  window.addEventListener('resize', () => {
    if (open && windowed) placeBelowTopbar(view);
  });
  // Back from a hidden tab, the interpolation is arbitrarily stale.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') snapLyricsClock();
  });
  // Immersive mode hides the header controls, so Escape is the way out.
  // The lyrics settings dialog answers Escape itself, and its keydown reaches here too.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && open && !lyricsSettingsOpen()) closeLyrics();
  });
  bindFollow();
  bindLyricPrefs(recenterActiveLine);
  bindLyricsTransport();
  bindWakeHold();
  applyViewMode();
}

export function syncLyricsToSnapshot(np) {
  rebaseLyricsClock(np);
  syncTrack(np);
  renderLyricsPlayState(np);
  syncWakeHold(np);
}

function openLyrics() {
  if (open) return;
  open = true;
  setHidden(view, false);
  applyViewMode();
  renderHeader(currentNowPlaying());
  renderLyricsProgress();
  // The loop was down with the overlay, so the frame clock and any outstanding correction are stale.
  resetFollowFrame();
  clearLyricsSlew();
  resumeFollow();
  if (raf === null) raf = requestAnimationFrame(tick);
  syncWakeHold(currentNowPlaying());
  topbar.inert = true;
  main.inert = true;
  // preventScroll, since focusing a control would scroll the main view behind the overlay.
  (windowed ? closeBtn : backBtn).focus({ preventScroll: true });
}

// Nothing here touches window scroll, so the main view comes back where the reader left it.
function closeLyrics() {
  if (!open) return;
  open = false;
  view.classList.remove('is-immersive');
  setHidden(view, true);
  setHidden(backdrop, true);
  topbar.inert = false;
  main.inert = false;
  if (raf !== null) {
    cancelAnimationFrame(raf);
    raf = null;
  }
  syncWakeHold(currentNowPlaying());
  openBtn.focus({ preventScroll: true });
}

function toggleViewMode() {
  windowed = !windowed;
  prefWrite(VIEW_KEY, windowed ? 'window' : 'full');
  applyViewMode();
  recenterActiveLine();
}

// The window view sits below the top bar like the Play Music dialog, and closes with its own X.
function applyViewMode() {
  view.classList.toggle('is-window', windowed);
  setHidden(backdrop, !(open && windowed));
  setHidden(backBtn, windowed);
  setHidden(closeBtn, !windowed);
  setHidden(iconToWindow, windowed);
  setHidden(iconToFull, !windowed);
  viewToggle.setAttribute('aria-label', windowed ? 'Show lyrics full screen' : 'Show lyrics in a window');
  viewToggle.dataset.tip = windowed ? 'Full screen' : 'Window';
  if (open && windowed) placeBelowTopbar(view);
}

function tick() {
  renderLyricsProgress();
  tickLyricsFollow(Date.now());
  raf = requestAnimationFrame(tick);
}

function renderHeader(np) {
  const running = np?.engineRunning === true;
  title.textContent = running ? (np.title ?? 'Unknown title') : 'No track loaded';
  artist.textContent = running ? (np.artist ?? '') : '';
}

// Repaints the overlay for a new song and warms the next queue entry. A radio stream carries
// no Navidrome songId, so it has no lyrics path and the button goes away.
function syncTrack(np) {
  // INPUT
  const isRadio = np?.isRadio === true;
  const index = playingIndex(np);
  const inQueue = index !== null && !isRadio;
  const songId = inQueue ? queueSongId(index) : null;
  const nextSongId = inQueue ? queueSongId(index + 1) : null;

  // PROCESS
  setHidden(openBtn, isRadio);
  if (isRadio) closeLyrics();
  renderHeader(np);
  if (songId === shownSongId) return;
  shownSongId = songId;
  // A new track starts followed, and lands without animating through it.
  setFollowing(true);
  snapLyricsClock();
  mountCover(cover, songId, () => shownSongId === songId);
  mountCover(thumb, songId, () => shownSongId === songId);

  // OUTPUT
  showLyricsFor(songId);
  if (nextSongId !== null) void lyricsFor(nextSongId);
}

// An idle mpv reports paused:false with queueIndex -1, so `paused` alone would keep
// the screen awake after the last queue entry has played out.
function syncWakeHold(np) {
  const playing = np?.engineRunning === true && (np.queueIndex ?? -1) >= 0 && !isPaused();
  if (open && playing) acquireWakeHold();
  else releaseWakeHold();
}
