// The Guests dialog: signed-in guests, bans and the guest song limit. The Jukebox dialog owns the code.

import { getJson, postJson } from './api.js';
import { byId, setHidden } from './dom.js';
import { bindGuestList, refreshGuests, resetGuests } from './guests-list.js';
import { makeNewCode } from './jukebox.js';
import { clearMessage, runDialogSave, showMessage } from './messages.js';

const openBtn = byId('open-guests');
const dialog = byId('guests-dialog');
const form = dialog.querySelector('form');
const guestLimit = byId('jukebox-guest-limit');
const guestLimitSave = byId('jukebox-guest-limit-save');
const guestLimitMessage = byId('jukebox-guest-limit-message');

export function bindGuestsDialog() {
  openBtn.addEventListener('click', () => {
    clearMessage(guestLimitMessage);
    resetGuests();
    void refreshGuests();
    void loadGuestLimit();
    dialog.showModal();
  });
  guestLimitSave.addEventListener('click', () => void saveGuestLimit());
  bindGuestList({ rotate: () => makeNewCode(false), changed: refreshGuests });
  // Enter would submit the dialog form through its first submit button, the close button, and drop the limit.
  guestLimit.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void saveGuestLimit();
  });
}

export function showGuestsButton() {
  setHidden(openBtn, false);
}

async function loadGuestLimit() {
  const settings = await getJson('/api/jukebox/settings');
  if (settings === null) {
    showMessage(guestLimitMessage, 'Could not load the guest song limit.', 'error');
    return;
  }
  guestLimit.value = String(settings.guestQueueLimit);
}

// The limit applies at once, and each guest page shows its new count with the next snapshot.
function saveGuestLimit() {
  return runDialogSave({ form, button: guestLimitSave, line: guestLimitMessage, request: postGuestLimit });
}

async function postGuestLimit() {
  const { ok, data } = await postJson('/api/jukebox/settings', { guestQueueLimit: Number(guestLimit.value) });
  if (!ok) return { ok: false, error: data?.error ?? 'The limit was not saved. Check the connection and try again.' };
  return data?.persisted === false ? { ok: true, warning: 'Applied until the player restarts. settings.json was not written.' } : { ok: true };
}
