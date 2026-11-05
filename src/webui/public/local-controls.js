import { postJson } from './api.js';
import { setConnState, stopConnection } from './connection.js';
import { byId, setHidden } from './dom.js';

const settingsBtn = byId('open-settings');
const settingsDialog = byId('settings-dialog');
const powerBtn = byId('power-btn');
const logoutBtn = byId('logout-btn');
// The groups and the button that change the player on this computer, so a remote browser never sees them.
const localOnlyControls = [byId('settings-theme-group'), byId('settings-player-group'), powerBtn];
const remoteNote = byId('settings-remote-note');

// Whether this browser may read and change the player settings. The settings dialog reads it.
let canChangeSettings = false;

export function canChangePlayerSettings() {
  return canChangeSettings;
}

export function bindPowerButton() {
  powerBtn.addEventListener('click', async () => {
    if (!window.confirm('Stop playback and shut down the player? You will need to reopen or restart it to use it again.')) return;
    // The stream closes first, so a reconnect cannot set the terminal state back to Connecting.
    stopConnection();
    await postJson('/api/shutdown');
    setConnState('disconnected');
    // A modal left open would cover the stopped state.
    settingsDialog.close();
    document.body.classList.add('player-stopped');
    // inert also blocks keyboard focus. The .topbar-actions box stays live, since it holds
    // the .conn status region.
    document.querySelector('main').inert = true;
    for (const button of document.querySelectorAll('.topbar-actions .ghost-btn')) button.inert = true;
  });
}

// The reload boots into the login view, since the session is gone.
export function bindLogoutButton() {
  logoutBtn.addEventListener('click', async () => {
    stopConnection();
    await postJson('/api/auth/logout');
    window.location.reload();
  });
}

// The settings dialog opens for every visitor, since Network info works from any device. The system
// settings (the Theme and Player groups) and Shut down stay local in every mode, as the server
// enforces. An MCP-launched player that is powered off starts again at the MCP's next play, so Shut
// down shows for every local browser.
export function setLocalPeer(isLocal) {
  canChangeSettings = isLocal;
  setHidden(settingsBtn, false);
  for (const control of localOnlyControls) setHidden(control, !isLocal);
  setHidden(remoteNote, isLocal);
}

// A mode with a login boots the player only for an admin session.
export function showAdminControls() {
  setHidden(logoutBtn, false);
}
