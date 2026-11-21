import { FAILED_TEXT, getJson, postJson } from './api.js';
import { byId } from './dom.js';
import { canChangePlayerSettings } from './local-controls.js';
import { clearNotice, notify, openDialog, runDialogSave } from './messages.js';
import { applyTheme } from './theme.js';

const openBtn = byId('open-settings');
const allSettingsBtn = byId('open-all-settings');
const dialog = byId('settings-dialog');
const form = dialog.querySelector('form');
const persist = byId('set-persist');
const autoOpen = byId('set-autoopen');
const visualizer = byId('set-visualizer');
const visualizerUnsupported = byId('set-visualizer-unsupported');
const themeRadios = Array.from(dialog.querySelectorAll('input[name="theme"]'));
// The System radio stands for a stored null, which lets each device pick light or dark for itself.
const SYSTEM_THEME = 'system';
const POPUP_BLOCKED = 'The browser blocked the new tab. Allow pop-ups for this page, then try again.';
const SESSION_ONLY = 'Applied for this session only. settings.json was not saved.';

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
  allSettingsBtn.addEventListener('click', () => void openAllSettings());
}

// The tab opens before the request, since popup blockers drop a window.open that runs after an await.
export async function openAllSettings() {
  const tab = window.open('', '_blank');
  clearNotice();
  if (tab === null) {
    notify(POPUP_BLOCKED, 'error');
    return;
  }
  // The settings page never needs a handle back to this page.
  tab.opener = null;
  const { ok, data } = await postJson('/api/player/settings-page');
  if (!ok || typeof data?.url !== 'string') {
    tab.close();
    notify(typeof data?.error === 'string' && data.error !== '' ? data.error : FAILED_TEXT, 'error');
    return;
  }
  tab.location.href = data.url;
}

async function openSettings() {
  if (!canChangePlayerSettings()) {
    openDialog(dialog);
    return;
  }
  const settings = await getJson('/api/player/settings');
  // Controls left unloaded would save stale values over the stored settings.
  setControlsDisabled(settings === null);
  if (settings !== null) showSettings(settings);
  openDialog(dialog);
  if (settings === null) notify('Could not load settings.', 'error');
}

function queueSave(patch) {
  saveChain = saveChain.then(() => runDialogSave({ form, request: () => saveSettings(patch) }));
}

async function saveSettings(patch) {
  const { ok, data } = await postJson('/api/player/settings', patch);
  if (!ok || data === null) {
    if (saved !== null) showSettings(saved);
    return { ok: false, error: 'Could not save settings.' };
  }
  showSettings(data);
  applyTheme(data.theme);
  return data.persisted === false ? { ok: true, warning: SESSION_ONLY } : { ok: true };
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
