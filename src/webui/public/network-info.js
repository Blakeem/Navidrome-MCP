// The network info dialog: the addresses the player is reachable on.

import { getJson } from './api.js';
import { byId } from './dom.js';

const openBtn = byId('open-network-info');
const dialog = byId('network-info-dialog');
const help = byId('network-info-help');
const list = byId('network-info-list');
const hint = byId('network-info-hint');

export function bindNetworkInfo() {
  openBtn.addEventListener('click', async () => {
    const info = await getJson('/api/network-info');
    if (info === null) {
      list.replaceChildren();
      hint.textContent = '';
      help.textContent = 'Could not load network info.';
    } else {
      renderNetworkInfo(info);
    }
    dialog.showModal();
  });
}

function renderNetworkInfo(info) {
  const interfaces = info.interfaces ?? [];
  const entries = [{ iface: 'Localhost', address: '127.0.0.1', url: info.localhostUrl }, ...interfaces];
  help.textContent = info.lanReachable
    ? 'The panel is reachable from devices on the same network.'
    : 'Currently only reachable from this device.';
  list.replaceChildren(...entries.map(buildAddressRow));
  hint.textContent = networkHint(info, interfaces.length);
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

function networkHint(info, interfaceCount) {
  if (!info.lanReachable && info.expose) {
    return 'The Web UI bind host is a loopback address, which overrides Expose on LAN. Clear Bind host in the Web UI (mpv remote) section of navidrome-config, then restart the server.';
  }
  if (!info.lanReachable) return 'Tip: run navidrome-config, check Expose on LAN in the Web UI (mpv remote) section, then restart the server.';
  if (interfaceCount === 0) return 'No LAN interfaces detected (only localhost is reachable).';
  return '';
}
