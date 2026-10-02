// The player settings dialog, host machine only. Each change saves itself, with no Save button.

import { getJson, postJson } from './api.js';
import { byId } from './dom.js';
import { applyTheme, systemTheme } from './theme.js';

const openBtn = byId('open-settings');
const dialog = byId('settings-dialog');
const persist = byId('set-persist');
const autoOpen = byId('set-autoopen');
const status = byId('settings-status');
const themeRadios = Array.from(dialog.querySelectorAll('input[name="theme"]'));

// The server's last answer, so a failed save puts the controls back to what is stored.
let saved = null;
// One save at a time, so quick changes reach the server and come back in order.
let saveChain = Promise.resolve();

export function bindSettings() {
  openBtn.addEventListener('click', () => void openSettings());
  // A click, not a change, so picking the theme the device already shows still stores it.
  for (const radio of themeRadios) {
    radio.addEventListener('click', () => {
      if (radio.value !== saved?.theme) queueSave({ theme: radio.value });
    });
  }
  persist.addEventListener('change', () => queueSave({ persistAfterMcpExit: persist.checked }));
  autoOpen.addEventListener('change', () => queueSave({ autoOpenBrowser: autoOpen.checked }));
}

async function openSettings() {
  status.textContent = '';
  const settings = await getJson('/api/player/settings');
  // Controls left unloaded would save stale values over the stored settings.
  setControlsDisabled(settings === null);
  if (settings === null) status.textContent = 'Could not load settings.';
  else showSettings(settings);
  dialog.showModal();
}

function queueSave(patch) {
  saveChain = saveChain.then(() => saveSettings(patch));
}

async function saveSettings(patch) {
  status.textContent = 'Saving…';
  const { ok, data } = await postJson('/api/player/settings', patch);
  if (!ok || data === null) {
    status.textContent = 'Could not save settings.';
    if (saved !== null) showSettings(saved);
    return;
  }
  showSettings(data);
  applyTheme(data.theme);
  status.textContent = 'Saved.';
}

// With no theme stored, the toggle shows the one this device follows.
function showSettings(settings) {
  const theme = settings.theme ?? systemTheme();
  saved = settings;
  persist.checked = settings.persistAfterMcpExit === true;
  autoOpen.checked = settings.autoOpenBrowser === true;
  for (const radio of themeRadios) radio.checked = radio.value === theme;
}

function setControlsDisabled(disabled) {
  for (const control of [...themeRadios, persist, autoOpen]) control.disabled = disabled;
}
