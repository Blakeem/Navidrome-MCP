// The Theme group a remote browser sees in the Settings dialog. The pick changes only this browser,
// so it sends nothing to the server.

import { byId, setHidden } from './dom.js';
import { canChangePlayerSettings } from './local-controls.js';
import { hostThemeIsSystem, onThemeChange, paintedScheme, setDeviceTheme } from './theme.js';

const group = byId('settings-device-theme-group');
const radios = Array.from(group.querySelectorAll('input[name="device-theme"]'));

// The player's computer sets the host's theme in its own group, so this group is for other browsers.
function renderDeviceTheme() {
  const scheme = paintedScheme();
  setHidden(group, canChangePlayerSettings() || !hostThemeIsSystem());
  for (const radio of radios) radio.checked = radio.value === scheme;
}

// Runs after setLocalPeer, since the group stays hidden on the player's computer.
export function bindDeviceTheme() {
  for (const radio of radios) radio.addEventListener('change', () => setDeviceTheme(radio.value));
  onThemeChange(renderDeviceTheme);
  renderDeviceTheme();
}
