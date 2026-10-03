// Follow mode for timed lyrics: highlights the active line and keeps it centred until the reader scrolls.

import { seekTo } from './controls.js';
import { byId, setHidden } from './dom.js';
import { drainSlew, jumpLyricsClock, lyricsShownMs } from './lyrics-clock.js';
import { lyricsOffsetMs } from './lyrics-prefs.js';
import { applyOffset, findActiveLine, isInterlude } from './lyrics-sync.js';

/** Time still left before the next line, once a blank LRC end marker has closed the active line, that reads as an instrumental break. */
const INTERLUDE_MS = 4000;

const view = byId('lyrics-view');
const scrollBox = byId('lyrics-scroll');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Both nodes belong to follow mode alone, so they are built here rather than carried as empty markup.
const interludeEl = buildInterludeEl();
const pill = buildFollowPill();

// The timed lines and the rows drawn from them, held together so a frame never reads the document.
let timed = [];
let rows = [];
let cursor = null;
let activeIndex = -1;
let inInterlude = false;
let frameWallMs = 0;
// False once the reader has scrolled the words themselves.
let following = true;

export function bindFollow() {
  pill.addEventListener('click', resumeFollow);
}

export function followLines(timedLines, rowEls) {
  timed = timedLines;
  rows = rowEls;
}

// Drops every reference into the previous track's rows, which a frame would otherwise keep alive.
export function resetFollow() {
  timed = [];
  rows = [];
  cursor = null;
  activeIndex = -1;
  inInterlude = false;
  interludeEl.remove();
}

// The frame clock is stale after the overlay was down, so the next frame starts a fresh delta.
export function resetFollowFrame() {
  frameWallMs = 0;
}

export function isFollowing() {
  return following;
}

export function setFollowing(next) {
  following = next;
  // Hiding the focused pill would drop focus to body, so focus moves to the scroll box first.
  if (next && document.activeElement === pill) scrollBox.focus({ preventScroll: true });
  setHidden(pill, next);
}

// A pointer, wheel or scrolling-key gesture on the words is the only signal that the reader moved the view.
// The scroll event cannot tell the reader from the follow loop, so it is never listened for.
export function suspendFollow() {
  if (timed.length === 0) return;
  setFollowing(false);
}

export function resumeFollow() {
  const row = rows[activeIndex];
  setFollowing(true);
  if (row !== undefined) centerRow(row, scrollBehavior(false));
}

// A resize moves every row below the active one, so the centred line returns under the reader's eyes.
export function recenterActiveLine() {
  const row = rows[activeIndex];
  if (following && row !== undefined) centerRow(row, 'auto');
}

// Runs every frame and writes only on a change. Anything but a step to the very next line
// is a seek or a resync, which lands without a long animated scroll.
export function tickLyricsFollow(nowMs) {
  // INPUT
  const frameDeltaMs = frameWallMs === 0 ? 0 : nowMs - frameWallMs;
  const previousIndex = activeIndex;
  let timeMs = 0;
  let active = null;
  let interlude = false;

  frameWallMs = nowMs;
  if (timed.length === 0) return;

  // PROCESS
  drainSlew(frameDeltaMs);
  timeMs = applyOffset(lyricsShownMs(nowMs), lyricsOffsetMs());
  active = findActiveLine(timed, timeMs, cursor);
  cursor = active.cursor;
  interlude = isInterlude(timed, active.index, timeMs, INTERLUDE_MS);
  if (active.index === previousIndex && interlude === inInterlude) return;

  // OUTPUT
  activeIndex = active.index;
  inInterlude = interlude;
  paintActiveLine(previousIndex, active.index !== previousIndex + 1);
}

export function seekToTappedLine(ev) {
  // INPUT
  const row = ev.target.closest('.lyric-line');
  const index = row === null ? -1 : Number(row.dataset.index);
  const line = timed[index];
  let mediaMs = 0;

  // PROCESS
  if (line === undefined) return;
  // The scroll box's own click toggles immersive mode, which a seek must not.
  ev.stopPropagation();
  // A positive offset would highlight past the tapped line, so the seek starts earlier by that offset.
  // A negative offset already matches the device latency it was calibrated for, so it is left alone.
  mediaMs = Math.max(0, line.timeMs - Math.max(0, lyricsOffsetMs()));
  void seekTo(mediaMs / 1000);

  // OUTPUT
  jumpLyricsClock(mediaMs);
  resumeFollow();
}

function buildInterludeEl() {
  const li = document.createElement('li');
  li.className = 'lyric-interlude';
  li.setAttribute('aria-hidden', 'true');
  for (let dot = 0; dot < 3; dot += 1) li.appendChild(document.createElement('span'));
  return li;
}

function buildFollowPill() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lyrics-follow-pill';
  btn.textContent = 'Jump to current';
  btn.setAttribute('hidden', '');
  view.appendChild(btn);
  return btn;
}

function scrollBehavior(instant) {
  return instant || reducedMotion.matches ? 'auto' : 'smooth';
}

// scrollIntoView walks every scrollable ancestor and would move the view behind the overlay,
// so the row is centred through the scroll box's own scrollTop.
function centerRow(row, behavior) {
  // INPUT
  const boxRect = scrollBox.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const limit = scrollBox.scrollHeight - scrollBox.clientHeight;
  let target = 0;

  // PROCESS
  target = scrollBox.scrollTop + (rowRect.top - boxRect.top) - (boxRect.height - rowRect.height) / 2;
  target = Math.max(0, Math.min(limit, target));

  // OUTPUT
  scrollBox.scrollTo({ top: target, behavior });
}

// The frame loop's only DOM write. Reached when the active line or the interlude changes.
function paintActiveLine(previousIndex, instant) {
  // INPUT
  const previousRow = rows[previousIndex];
  const row = rows[activeIndex];

  // PROCESS
  if (previousRow !== undefined && previousRow !== row) previousRow.classList.remove('is-active', 'is-interlude');
  interludeEl.remove();
  if (row === undefined) return;
  row.classList.add('is-active');
  row.classList.toggle('is-interlude', inInterlude);
  if (inInterlude) row.insertAdjacentElement('afterend', interludeEl);

  // OUTPUT
  if (following) centerRow(row, scrollBehavior(instant));
}
