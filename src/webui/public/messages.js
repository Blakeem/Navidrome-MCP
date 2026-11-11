// The one writer of the `.msg` action-result lines on the Jukebox Remote pages, so every result follows the
// same tone and timing rules. styles.css draws each tone's icon and color from the line's data-tone.

import { FAILED_TEXT } from './api.js';
import { buildIcon, ICON_CHECK, SYMBOL_VIEWBOX } from './dom.js';

const TONES = new Set(['success', 'info', 'warning', 'error']);
const READING_BASE_MS = 1500;
const READING_PER_CHAR_MS = 50;
const READING_MIN_MS = 2500;
const READING_MAX_MS = 6000;
// Matches the opacity transition of `.msg[data-leaving]` in styles.css.
const FADE_MS = 150;
const SAVED_HOLD_MS = 1500;
const SAVING_TEXT = 'Saving…';
const SAVED_BUTTON_TEXT = 'Saved';
const SAVED_LINE_TEXT = 'Saved.';

// Line to its pending clear, and save button to its pending label restore.
const clearTimers = new WeakMap();
const savedHolds = new WeakMap();

export function readingTimeMs(text) {
  return Math.min(READING_MAX_MS, Math.max(READING_MIN_MS, READING_BASE_MS + READING_PER_CHAR_MS * text.length));
}

// A success clears after its reading time. Every other tone stays until the next message or clear on the line.
export function showMessage(el, text, tone) {
  if (!TONES.has(tone)) throw new Error(`showMessage: unknown tone "${tone}"`);
  cancelClear(el);
  el.textContent = text;
  el.dataset.tone = tone;
  if (tone === 'success') clearTimers.set(el, setTimeout(() => fadeOut(el), readingTimeMs(text)));
}

export function clearMessage(el) {
  cancelClear(el);
  el.textContent = '';
  delete el.dataset.tone;
}

/**
 * Blocks `form` while `request` runs, so the save cannot be sent twice. `request` resolves
 * `{ ok: true }`, `{ ok: true, warning }` or `{ ok: false, error }`. A save with a `button`, which holds
 * only its text label, confirms on it, and one without confirms on `line`. A form that closes on success
 * passes `confirm: false`, since the close is its confirmation. Resolves whether the save went through.
 */
export async function runDialogSave({ form, button = null, line, request, confirm = true }) {
  const focused = form.contains(document.activeElement) ? document.activeElement : null;
  let label = '';
  let result = null;

  if (button !== null) {
    endSavedHold(button);
    label = button.textContent;
  }
  clearMessage(line);
  setBusy(form, true);
  if (button === null) showMessage(line, SAVING_TEXT, 'info');
  else button.textContent = SAVING_TEXT;

  try {
    result = await request();
  } catch (err) {
    console.warn('webui: save failed', err);
    result = { ok: false, error: FAILED_TEXT };
  }

  const warned = result.ok && typeof result.warning === 'string';
  setBusy(form, false);
  if (!result.ok) showMessage(line, result.error, 'error');
  else if (warned) showMessage(line, result.warning, 'warning');
  else if (button === null) showMessage(line, SAVED_LINE_TEXT, 'success');
  if (button !== null && result.ok && !warned && confirm) holdSaved(button, label, focused);
  else if (button !== null) button.textContent = label;
  refocus(focused);
  return result.ok;
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

function fadeOut(el) {
  el.dataset.leaving = '';
  clearTimers.set(el, setTimeout(() => clearMessage(el), FADE_MS));
}

function cancelClear(el) {
  clearTimeout(clearTimers.get(el));
  clearTimers.delete(el);
  delete el.dataset.leaving;
}
