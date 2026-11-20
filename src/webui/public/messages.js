// The one writer of action results on the Jukebox Remote pages, so every result follows the same tone and
// timing rules. A result shows in one notice at the top edge of the screen, a dialog Save button confirms on
// itself, and a result the page already shows another way goes only to a screen reader through announce().
// styles.css draws each tone's icon and color from the notice's data-tone.

import { FAILED_TEXT } from './api.js';
import { buildIcon, ICON_CHECK, SYMBOL_VIEWBOX } from './dom.js';

const TONES = new Set(['success', 'info', 'warning', 'error']);
// A success or info only confirms, so it clears on its own. A warning or error waits for the user.
const PASSING_TONES = new Set(['success', 'info']);
const READING_BASE_MS = 1500;
const READING_PER_CHAR_MS = 50;
const READING_MIN_MS = 2500;
const READING_MAX_MS = 6000;
// Matches the opacity transition of `.notice[data-leaving]` in styles.css.
const FADE_MS = 150;
const SAVED_HOLD_MS = 1500;
// A screen reader reads a change to a live region, so the text lands after a clear and a repeated text is read again.
const ANNOUNCE_DELAY_MS = 100;
const SAVING_TEXT = 'Saving…';
const SAVED_BUTTON_TEXT = 'Saved';
const SAVED_NOTICE_TEXT = 'Saved.';
const DISMISS_LABEL = 'Dismiss';
const ICON_CLOSE = 'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z';

// A modal dialog makes the page outside it inert, so the notice moves into the dialog that opened last.
const openDialogs = [];
const watchedDialogs = new WeakSet();
// Save button to its pending label restore.
const savedHolds = new WeakMap();
// Built on first use, so a page that never reports builds nothing.
let notice = null;
let clearTimer = null;
let announcer = null;
let announceTimer = null;

export function readingTimeMs(text) {
  return Math.min(READING_MAX_MS, Math.max(READING_MIN_MS, READING_BASE_MS + READING_PER_CHAR_MS * text.length));
}

/**
 * Shows `text` in the notice and replaces the one showing. Every text goes in through textContent.
 * A polite live region that shows in the same task as its text tends to go unread, so only an error is
 * read from the notice, as an alert, and every other tone is read through announce().
 */
export function notify(text, tone) {
  if (!TONES.has(tone)) throw new Error(`notify: unknown tone "${tone}"`);
  const host = liveHost();
  const passing = PASSING_TONES.has(tone);
  notice ??= buildNotice();

  clearTimeout(clearTimer);
  clearTimer = null;
  if (notice.box.parentElement !== host) host.append(notice.box);
  delete notice.box.dataset.leaving;
  notice.box.dataset.tone = tone;
  if (tone === 'error') notice.text.setAttribute('role', 'alert');
  else notice.text.removeAttribute('role');
  notice.text.textContent = text;
  notice.dismiss.hidden = passing;
  notice.box.hidden = false;
  if (tone !== 'error') announce(text);
  if (passing) clearTimer = setTimeout(fadeOut, readingTimeMs(text));
}

export function clearNotice() {
  clearTimeout(clearTimer);
  clearTimer = null;
  if (notice === null) return;
  notice.box.hidden = true;
  delete notice.box.dataset.tone;
  delete notice.box.dataset.leaving;
  notice.text.textContent = '';
}

/** Reads `text` to a screen reader with nothing on screen, for a result the page already shows another way. */
export function announce(text) {
  const host = liveHost();
  announcer ??= buildAnnouncer();

  if (announcer.parentElement !== host) host.append(announcer);
  clearTimeout(announceTimer);
  announcer.textContent = '';
  announceTimer = setTimeout(() => { announcer.textContent = text; }, ANNOUNCE_DELAY_MS);
}

/** Opens `dialog` as a modal. A dialog that opens or closes changes what the user looks at, so it clears the notice. */
export function openDialog(dialog) {
  clearNotice();
  watchClose(dialog);
  dialog.showModal();
  dropDialog(dialog);
  openDialogs.push(dialog);
}

/**
 * Blocks `form` while `request` runs, so the save cannot be sent twice. `request` resolves
 * `{ ok: true }`, `{ ok: true, warning }` or `{ ok: false, error }`. A save with a `button`, which holds
 * only its text label, confirms on it, and one without confirms in the notice. A form that closes on
 * success passes `confirm: false`, since the close is its confirmation. Resolves whether the save went through.
 */
export async function runDialogSave({ form, button = null, request, confirm = true }) {
  const focused = form.contains(document.activeElement) ? document.activeElement : null;
  let label = '';
  let result = null;

  if (button !== null) {
    endSavedHold(button);
    label = button.textContent;
    button.textContent = SAVING_TEXT;
  }
  clearNotice();
  setBusy(form, true);

  try {
    result = await request();
  } catch (err) {
    console.warn('webui: save failed', err);
    result = { ok: false, error: FAILED_TEXT };
  }

  const warned = result.ok && typeof result.warning === 'string';
  setBusy(form, false);
  if (!result.ok) notify(result.error, 'error');
  else if (warned) notify(result.warning, 'warning');
  else if (button === null) notify(SAVED_NOTICE_TEXT, 'success');
  if (button !== null && result.ok && !warned && confirm) holdSaved(button, label, focused);
  else if (button !== null) button.textContent = label;
  refocus(focused);
  return result.ok;
}

function buildNotice() {
  const box = document.createElement('div');
  const text = document.createElement('p');
  const dismiss = document.createElement('button');
  box.className = 'notice';
  // The notice has no accessible name, so the e2e page objects locate it by this id.
  box.dataset.testid = 'notice';
  box.hidden = true;
  text.className = 'notice-text';
  dismiss.type = 'button';
  dismiss.className = 'modal-close';
  dismiss.setAttribute('aria-label', DISMISS_LABEL);
  dismiss.append(buildIcon('', ICON_CLOSE, SYMBOL_VIEWBOX));
  box.append(text, dismiss);
  box.addEventListener('click', (event) => {
    // A dialog that holds the notice may close on a click, such as the full screen QR code.
    event.stopPropagation();
    if (dismiss.contains(event.target) || PASSING_TONES.has(box.dataset.tone)) clearNotice();
  });
  return { box, text, dismiss };
}

function fadeOut() {
  notice.box.dataset.leaving = '';
  clearTimer = setTimeout(clearNotice, FADE_MS);
}

function buildAnnouncer() {
  const region = document.createElement('p');
  region.className = 'visually-hidden';
  region.setAttribute('aria-live', 'polite');
  return region;
}

// The live region goes where the notice goes, since a screen reader skips the page outside an open modal dialog.
function liveHost() {
  return topDialog() ?? document.body;
}

function topDialog() {
  for (let index = openDialogs.length - 1; index >= 0; index -= 1) {
    if (openDialogs[index].open) return openDialogs[index];
  }
  return null;
}

function dropDialog(dialog) {
  const index = openDialogs.indexOf(dialog);
  if (index !== -1) openDialogs.splice(index, 1);
}

// The close event fires a task after close(), so it clears only a notice inside that dialog. A notice a
// writer shows on the page right after close() stays.
function watchClose(dialog) {
  if (watchedDialogs.has(dialog)) return;
  watchedDialogs.add(dialog);
  dialog.addEventListener('close', () => {
    dropDialog(dialog);
    if (notice?.box.parentElement === dialog) clearNotice();
  });
}

// The button stays disabled while it shows Saved, so a click on it cannot save the same value again.
function holdSaved(button, label, focused) {
  button.disabled = true;
  button.replaceChildren(buildIcon('', ICON_CHECK, SYMBOL_VIEWBOX), SAVED_BUTTON_TEXT);
  const timer = setTimeout(() => {
    endSavedHold(button);
    refocus(focused);
  }, SAVED_HOLD_MS);
  savedHolds.set(button, { label, timer });
}

function endSavedHold(button) {
  const hold = savedHolds.get(button);
  if (hold === undefined) return;
  clearTimeout(hold.timer);
  savedHolds.delete(button);
  button.textContent = hold.label;
  button.disabled = false;
}

function setBusy(form, busy) {
  form.inert = busy;
  if (busy) form.setAttribute('aria-busy', 'true');
  else form.removeAttribute('aria-busy');
}

// An inert form drops focus to the body, so the control the user was on takes it back.
function refocus(target) {
  if (target === null || !target.isConnected) return;
  if (document.activeElement === null || document.activeElement === document.body) target.focus({ preventScroll: true });
}
