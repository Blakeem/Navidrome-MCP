// The Guests dialog: signed-in guests, bans and the guest song limit. The Jukebox dialog owns the code.

import { getJson, postJson } from './api.js';
import { byId, setHidden } from './dom.js';
import { bindGuestList, refreshGuests, resetGuests } from './guests-list.js';
import { makeNewCode } from './jukebox.js';

const openBtn = byId('open-guests');
const dialog = byId('guests-dialog');
const guestLimit = byId('jukebox-guest-limit');
const guestLimitSave = byId('jukebox-guest-limit-save');
const guestLimitMessage = byId('jukebox-guest-limit-message');

export function bindGuestsDialog() {
  openBtn.addEventListener('click', () => {
    guestLimitMessage.textContent = '';
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
    guestLimitMessage.textContent = 'Could not load the guest song limit.';
    return;
  }
  guestLimit.value = String(settings.guestQueueLimit);
}

// The limit applies at once, and each guest page shows its new count with the next snapshot.
async function saveGuestLimit() {
  guestLimitSave.disabled = true;
  guestLimitMessage.textContent = '';
  const { ok, data } = await postJson('/api/jukebox/settings', { guestQueueLimit: Number(guestLimit.value) });
  guestLimitSave.disabled = false;
  if (!ok) {
    guestLimitMessage.textContent = data?.error ?? 'The limit was not saved. Check the connection and try again.';
    return;
  }
  guestLimitMessage.textContent = data.persisted ? 'Saved.' : 'Applied until the player restarts. settings.json was not written.';
}
