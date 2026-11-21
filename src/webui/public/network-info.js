import { getJson } from './api.js';
import { byId } from './dom.js';
import { canChangePlayerSettings } from './local-controls.js';
import { openDialog } from './messages.js';
import { openAllSettings } from './settings.js';

const openBtn = byId('open-network-info');
const dialog = byId('network-info-dialog');
const help = byId('network-info-help');
const list = byId('network-info-list');
const hint = byId('network-info-hint');

// The settings page opens only on the player's computer, so a remote viewer gets the place named instead.
const LOCAL_SETTINGS = 'All settings';
const REMOTE_SETTINGS = "the settings on the player's computer";
const RESTART_STEP = 'then shut down the player and start it again';

export function bindNetworkInfo() {
  openBtn.addEventListener('click', async () => {
    const info = await getJson('/api/network-info');
    if (info === null) {
      list.replaceChildren();
      hint.replaceChildren();
      help.textContent = 'Could not load network info.';
    } else {
      renderNetworkInfo(info);
    }
    openDialog(dialog);
  });
}

function renderNetworkInfo(info) {
  const interfaces = info.interfaces ?? [];
  const entries = [{ iface: 'Localhost', address: '127.0.0.1', url: info.localhostUrl }, ...interfaces];
  help.textContent = info.lanReachable
    ? 'The panel is reachable from devices on the same network.'
    : 'Currently only reachable from this device.';
  list.replaceChildren(...entries.map(buildAddressRow));
  renderHint(info, interfaces.length);
}

function renderHint(info, interfaceCount) {
  const isLocal = canChangePlayerSettings();
  const text = networkHint(info, interfaceCount, isLocal ? LOCAL_SETTINGS : REMOTE_SETTINGS);
  hint.replaceChildren(text);
  if (isLocal && !info.lanReachable) hint.append(' ', buildAllSettingsButton());
}

function buildAllSettingsButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary small';
  button.textContent = LOCAL_SETTINGS;
  button.addEventListener('click', () => void openAllSettings());
  return button;
}

function buildAddressRow(entry) {
  const li = document.createElement('li');
  const head = document.createElement('span');
  const link = document.createElement('a');
  head.className = 'iface';
  head.textContent = `${entry.iface} · ${entry.address}`;
  link.href = entry.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = entry.url;
  li.append(head, link);
  return li;
}

function networkHint(info, interfaceCount, settingsPlace) {
  if (!info.lanReachable && info.expose) {
    return `The bind host is a loopback address, which overrides Expose on LAN. Clear Bind host in the Jukebox Remote section of ${settingsPlace}, ${RESTART_STEP}.`;
  }
  if (!info.lanReachable) return `Turn on Expose on LAN in ${settingsPlace}, ${RESTART_STEP}.`;
  if (interfaceCount === 0) return 'No LAN interfaces detected (only localhost is reachable).';
  return '';
}
