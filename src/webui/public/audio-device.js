import { FAILED_TEXT, getJsonResult, postJson } from './api.js';
import { buildListStatusRow, byId } from './dom.js';
import { clearNotice, notify, openDialog } from './messages.js';
import { bindOutputBanner, renderOutputBanner } from './output-banner.js';

const openBtn = byId('btn-audio-device');
const dialog = byId('audio-device-dialog');
const list = byId('audio-device-list');

const OUTPUT_LABEL = 'Audio output';
const LOADING_TEXT = 'Loading outputs…';

function openAudioDevice() {
  openDialog(dialog);
  void loadDevices();
}

export function bindAudioDevice() {
  openBtn.addEventListener('click', openAudioDevice);
  bindOutputBanner(openAudioDevice);
}

export function renderAudioDevice(status) {
  const lost = status?.audioOutputLost === true;
  const label = lost ? `${OUTPUT_LABEL}: not connected` : OUTPUT_LABEL;
  openBtn.classList.toggle('is-lost', lost);
  openBtn.dataset.tip = label;
  openBtn.setAttribute('aria-label', label);
  renderOutputBanner(lost);
}

async function loadDevices() {
  list.replaceChildren(buildListStatusRow(LOADING_TEXT));
  const { ok, data } = await getJsonResult('/api/audio-devices');
  if (!ok || data === null) {
    list.replaceChildren();
    // A failure that arrives after the dialog closed would show on the page, away from the dialog it explains.
    if (dialog.open) notify(failureText(data), 'error');
    return;
  }
  list.replaceChildren(...deviceEntries(data).map(buildDeviceRow));
}

// A disconnected selection is missing from mpv's list, so it is added back to show what is chosen.
function deviceEntries(report) {
  const devices = Array.isArray(report.devices) ? report.devices : [];
  const selected = report.selected;
  const listed = devices.some((device) => device.id === selected.id);
  const entries = listed ? devices : [...devices, { id: selected.id, name: selected.name ?? selected.id }];
  return entries.map((device) => ({
    id: device.id,
    name: device.name,
    selected: device.id === selected.id,
    lost: device.id === selected.id && selected.connected === false,
  }));
}

function buildDeviceRow(entry) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary audio-device-btn';
  button.setAttribute('aria-pressed', String(entry.selected));
  button.textContent = entry.name;
  if (entry.lost) {
    const note = document.createElement('span');
    note.className = 'audio-device-note';
    note.textContent = 'not connected';
    button.append(note);
  }
  button.addEventListener('click', () => void chooseDevice(entry.id));
  li.append(button);
  return li;
}

async function chooseDevice(id) {
  clearNotice();
  const { ok, data } = await postJson('/api/controls/audio-device', { id });
  if (ok && data?.success === true) {
    dialog.close();
    return;
  }
  notify(failureText(data), 'error');
}

function failureText(data) {
  if (typeof data?.error === 'string' && data.error !== '') return data.error;
  if (typeof data?.message === 'string' && data.message !== '') return data.message;
  return FAILED_TEXT;
}
