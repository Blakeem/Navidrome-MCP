import { FAILED_TEXT, getJson, postJson } from './api.js';
import { byId } from './dom.js';
import { canChangePlayerSettings } from './local-controls.js';
import { applyTheme } from './theme.js';

const openBtn = byId('open-settings');
const allSettingsBtn = byId('open-all-settings');
const dialog = byId('settings-dialog');
const persist = byId('set-persist');
const autoOpen = byId('set-autoopen');
const visualizer = byId('set-visualizer');
const visualizerUnsupported = byId('set-visualizer-unsupported');
const status = byId('settings-status');
const themeRadios = Array.from(dialog.querySelectorAll('input[name="theme"]'));
// The System radio stands for a stored null, which lets each device follow its own setting.
const SYSTEM_THEME = 'system';
const POPUP_BLOCKED = 'The browser blocked the new tab. Allow pop-ups for this page, then try again.';

// The server's last answer, so a failed save puts the controls back to what is stored.
let saved = null;
// One save at a time, so quick changes reach the server and come back in order.
let saveChain = Promise.resolve();

export function bindSettings() {
  openBtn.addEventListener('click', () => void openSettings());
  for (const radio of themeRadios) {
    radio.addEventListener('change', () => {
      const theme = radio.value === SYSTEM_THEME ? null : radio.value;
      if (theme !== (saved?.theme ?? null)) queueSave({ theme });
    });
  }
  persist.addEventListener('change', () => queueSave({ persistAfterMcpExit: persist.checked }));
  autoOpen.addEventListener('change', () => queueSave({ autoOpenBrowser: autoOpen.checked }));
  visualizer.addEventListener('change', () => queueSave({ visualizer: visualizer.checked }));
  allSettingsBtn.addEventListener('click', () => void openAllSettings(status));
}

// The tab opens before the request, since popup blockers drop a window.open that runs after an await.
export async function openAllSettings(statusLine) {
  const tab = window.open('', '_blank');
  statusLine.textContent = '';
  if (tab === null) {
    statusLine.textContent = POPUP_BLOCKED;
    return;
  }
  // The settings page never needs a handle back to this page.
  tab.opener = null;
  const { ok, data } = await postJson('/api/player/settings-page');
  if (!ok || typeof data?.url !== 'string') {
    tab.close();
    statusLine.textContent = typeof data?.error === 'string' && data.error !== '' ? data.error : FAILED_TEXT;
    return;
  }
  tab.location.href = data.url;
}

async function openSettings() {
  status.textContent = '';
  if (!canChangePlayerSettings()) {
    dialog.showModal();
    return;
  }
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
  status.textContent =
    data.persisted === false ? 'Applied for this session only. settings.json was not saved.' : 'Saved.';
}

function showSettings(settings) {
  const theme = settings.theme ?? SYSTEM_THEME;
  saved = settings;
  persist.checked = settings.persistAfterMcpExit === true;
  autoOpen.checked = settings.autoOpenBrowser === true;
  visualizer.checked = settings.visualizer !== false;
  visualizerUnsupported.hidden = !(visualizer.checked && settings.visualizerUnsupported === true);
  for (const radio of themeRadios) radio.checked = radio.value === theme;
}

function setControlsDisabled(disabled) {
  for (const control of [...themeRadios, persist, autoOpen, visualizer]) control.disabled = disabled;
}
