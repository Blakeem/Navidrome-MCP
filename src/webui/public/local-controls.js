// The affordances only a browser on the host machine gets: the settings gear and the power button.

import { postJson } from './api.js';
import { setConnState, stopConnection } from './connection.js';
import { byId, setHidden } from './dom.js';

const settingsBtn = byId('open-settings');
const powerBtn = byId('power-btn');

export function bindPowerButton() {
  powerBtn.addEventListener('click', async () => {
    if (!window.confirm('Stop playback and shut down the player? You will need to reopen or restart it to use it again.')) return;
    // The stream closes first, so its reconnect does not flip the terminal state back to Connecting.
    stopConnection();
    await postJson('/api/shutdown');
    setConnState('disconnected');
    document.body.classList.add('player-stopped');
  });
}

// An MCP-launched player that is powered off starts again at the MCP's next play, so power shows for every local browser.
export function setLocalPeer(isLocal) {
  setHidden(settingsBtn, !isLocal);
  setHidden(powerBtn, !isLocal);
}
