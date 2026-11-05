import { seekTo } from './controls.js';
import { byId, setHidden } from './dom.js';
import { drainSlew, jumpLyricsClock, lyricsShownMs } from './lyrics-clock.js';
import { lyricsOffsetMs } from './lyrics-prefs.js';
import { applyOffset, findActiveLine, isInterlude } from './lyrics-sync.js';

/** Time left before the next line, after a blank LRC marker has ended the active line, that
 *  shows as an instrumental break. */
const INTERLUDE_MS = 4000;

const view = byId('lyrics-view');
const scrollBox = byId('lyrics-scroll');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Both nodes belong to follow mode alone, so they are built here, not left empty in index.html.
const interludeEl = buildInterludeEl();
const pill = buildFollowPill();

// The timed lines and their rows are held here, so a frame never queries the document.
let timed = [];
let rows = [];
let cursor = null;
let activeIndex = -1;
let inInterlude = false;
let frameWallMs = 0;
let following = true;

export function bindFollow() {
  pill.addEventListener('click', resumeFollow);
}

export function followLines(timedLines, rowEls) {
  timed = timedLines;
  rows = rowEls;
}

// A frame would otherwise keep reading the previous track's detached rows and scroll to them.
export function resetFollow() {
  timed = [];
  rows = [];
  cursor = null;
  activeIndex = -1;
  inInterlude = false;
  interludeEl.remove();
}

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

// A scroll event cannot tell the reader from the follow loop, so only a pointer, touch, wheel
// or scrolling-key gesture on the words counts as the reader moving the view.
export function suspendFollow() {
  if (timed.length === 0) return;
  setFollowing(false);
}

export function resumeFollow() {
  const row = rows[activeIndex];
  setFollowing(true);
  if (row !== undefined) centerRow(row, scrollBehavior(false));
}

// A text size or view change reflows the rows and moves the active line off centre.
export function recenterActiveLine() {
  const row = rows[activeIndex];
  if (following && row !== undefined) centerRow(row, 'auto');
}

// Runs every frame and writes only on a change. Any move other than a step to the next line is a
// seek or a resync, so it scrolls without animation.
export function tickLyricsFollow(nowMs) {
  const frameDeltaMs = frameWallMs === 0 ? 0 : nowMs - frameWallMs;
  const previousIndex = activeIndex;
  let timeMs = 0;
  let active = null;
  let interlude = false;

  frameWallMs = nowMs;
  if (timed.length === 0) return;

  drainSlew(frameDeltaMs);
  timeMs = applyOffset(lyricsShownMs(nowMs), lyricsOffsetMs());
  active = findActiveLine(timed, timeMs, cursor);
  cursor = active.cursor;
  interlude = isInterlude(timed, active.index, timeMs, INTERLUDE_MS);
  if (active.index === previousIndex && interlude === inInterlude) return;

  activeIndex = active.index;
  inInterlude = interlude;
  paintActiveLine(previousIndex, active.index !== previousIndex + 1);
}

export function seekToTappedLine(ev) {
  const row = ev.target.closest('.lyric-line');
  const index = row === null ? -1 : Number(row.dataset.index);
  const line = timed[index];
  let mediaMs = 0;

  if (line === undefined) return;
  // The scroll box's own click toggles immersive mode, which a seek must not.
  ev.stopPropagation();
  // A positive offset would highlight past the tapped line, so the seek starts that much earlier.
  // A negative offset matches the output latency it was set for, so the seek ignores it.
  mediaMs = Math.max(0, line.timeMs - Math.max(0, lyricsOffsetMs()));
  void seekTo(mediaMs / 1000);

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
  const boxRect = scrollBox.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const limit = scrollBox.scrollHeight - scrollBox.clientHeight;
  let target = 0;

  target = scrollBox.scrollTop + (rowRect.top - boxRect.top) - (boxRect.height - rowRect.height) / 2;
  target = Math.max(0, Math.min(limit, target));

  scrollBox.scrollTo({ top: target, behavior });
}

function paintActiveLine(previousIndex, instant) {
  const previousRow = rows[previousIndex];
  const row = rows[activeIndex];

  if (previousRow !== undefined && previousRow !== row) previousRow.classList.remove('is-active', 'is-interlude');
  interludeEl.remove();
  if (row === undefined) return;
  row.classList.add('is-active');
  row.classList.toggle('is-interlude', inInterlude);
  if (inInterlude) row.insertAdjacentElement('afterend', interludeEl);

  if (following) centerRow(row, scrollBehavior(instant));
}
