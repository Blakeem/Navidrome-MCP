// The "Change name" control under the "You are" line, and the one save the welcome card shares with it.

import { postGuestNickname } from './api.js';
import { byId, setHidden } from './dom.js';

const SAVE_FAILED = 'The nickname was not saved. Check the connection and try again.';
const NICKNAME_BLANK = 'Enter a nickname to save.';

const changeButton = byId('guest-name-change');
const form = byId('guest-name-form');
const input = byId('guest-name-input');
const saveButton = byId('guest-name-save');
const cancelButton = byId('guest-name-cancel');
const status = byId('guest-name-status');

let storedNickname = null;
let available = false;
let onSaved = () => {};

// The server answers a name it already holds without spending the guest's hourly budget.
export async function saveNickname(nickname) {
  const { ok, data } = await postGuestNickname(nickname);
  if (!ok) return { ok: false, error: data?.error ?? SAVE_FAILED };
  storedNickname = data.nickname;
  onSaved(data.nickname);
  return { ok: true };
}

export function currentNickname() {
  return storedNickname;
}

// A snapshot names the nickname the server holds, so a change from another tab shows here too.
export function rememberNickname(nickname) {
  storedNickname = nickname;
}

// Every join card hides the control, since only a live guest or host session has a name to change.
export function showChangeName(visible) {
  available = visible;
  closeForm();
}

export function bindChangeName(onNicknameSaved) {
  onSaved = onNicknameSaved;
  changeButton.addEventListener('click', openForm);
  cancelButton.addEventListener('click', closeForm);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitForm();
  });
}

function openForm() {
  input.value = storedNickname ?? '';
  status.textContent = '';
  setHidden(form, false);
  setHidden(changeButton, true);
  input.focus();
}

function closeForm() {
  setHidden(form, true);
  setHidden(changeButton, !available);
  status.textContent = '';
}

async function submitForm() {
  const nickname = input.value.trim();
  if (nickname === '') {
    status.textContent = NICKNAME_BLANK;
    return;
  }
  saveButton.disabled = true;
  const result = await saveNickname(nickname);
  saveButton.disabled = false;
  if (result.ok) closeForm();
  else status.textContent = result.error;
}
