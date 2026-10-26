// The welcome shows once per guest session. "Got it" closes the card only after the typed nickname is
// stored through the guest nickname route. The header close button and Escape discard a typed name.

import { byId, setHidden } from './dom.js';
import { currentNickname, saveNickname } from './guest-name.js';
import { prefRead, prefWrite } from './prefs.js';
import { formatDateTime } from './time-format.js';

const SEEN_KEY = 'navidrome-mcp.guest-welcome-seen';

const dialog = byId('guest-welcome');
const text = byId('guest-welcome-text');
const expiry = byId('guest-welcome-expiry');
const nicknameFields = byId('guest-nickname-fields');
const nicknameInput = byId('guest-nickname');
const nicknameSave = byId('guest-nickname-save');
const nicknameStatus = byId('guest-nickname-status');
const done = byId('guest-welcome-done');

// Held in memory too, since blocked storage would otherwise reopen the welcome on every snapshot.
let shownMarker = null;

// The jukebox code's expiry ends every guest, and a guest session also idles out after a day.
export function jukeboxEndText(expiresAt) {
  return `The jukebox link works until ${formatDateTime(expiresAt)}. You are signed out after a day away.`;
}

export function bindWelcome() {
  nicknameSave.addEventListener('click', () => void saveTypedNickname());
  done.addEventListener('click', () => void closeAfterSave());
  // Enter would submit the dialog form through its first submit button, the close button, and drop the nickname.
  nicknameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void saveTypedNickname();
  });
}

// The label and the join time together name one guest session, so a new session shows the welcome again.
export function maybeShowWelcome(jukebox, canQueue) {
  const marker = `${jukebox.label}|${String(jukebox.joinedAt)}`;
  if (shownMarker === marker || prefRead(SEEN_KEY) === marker) return;
  shownMarker = marker;
  prefWrite(SEEN_KEY, marker);
  text.textContent = `You joined as ${jukebox.nickname ?? jukebox.label}. This page shows what is playing, what comes next and the lyrics.${queueText(jukebox, canQueue)}`;
  expiry.textContent = jukeboxEndText(jukebox.expiresAt);
  nicknameInput.value = jukebox.nickname ?? '';
  nicknameStatus.textContent = '';
  // The host previews this page under its admin session, which holds no guest nickname.
  setHidden(nicknameFields, !canQueue);
  dialog.showModal();
}

// A modal welcome would cover the card that replaces the player when the session ends.
export function closeWelcome() {
  dialog.close();
}

function queueText(jukebox, canQueue) {
  if (!canQueue || typeof jukebox.limit !== 'number') return '';
  const songs = jukebox.limit === 1 ? '1 song' : `${jukebox.limit} songs`;
  return ` You can add up to ${songs} at a time to the end of the queue, and remove your own songs before they start playing.`;
}

// Resolves true when no new name was typed or the route stored it.
async function saveTypedNickname() {
  const nickname = nicknameInput.value.trim();
  if (nickname === '' || nickname === currentNickname()) return true;
  nicknameSave.disabled = true;
  done.disabled = true;
  const result = await saveNickname(nickname);
  nicknameSave.disabled = false;
  done.disabled = false;
  nicknameStatus.textContent = result.ok ? 'Saved.' : result.error;
  return result.ok;
}

async function closeAfterSave() {
  if (await saveTypedNickname()) dialog.close();
}
