import { FAILED_TEXT, getJsonResult, postJson } from './api.js';
import { byId } from './dom.js';
import { bindOutputBanner, renderOutputBanner } from './output-banner.js';

const openBtn = byId('btn-audio-device');
const dialog = byId('audio-device-dialog');
const list = byId('audio-device-list');
const statusLine = byId('audio-device-status');

const OUTPUT_LABEL = 'Audio output';

function openAudioDevice() {
  dialog.showModal();
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
  statusLine.textContent = 'Loading outputs…';
  list.replaceChildren();
  const { ok, data } = await getJsonResult('/api/audio-devices');
  if (!ok || data === null) {
    statusLine.textContent = failureText(data);
    return;
  }
  statusLine.textContent = '';
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
  statusLine.textContent = '';
  const { ok, data } = await postJson('/api/controls/audio-device', { id });
  if (ok && data?.success === true) {
    dialog.close();
    return;
  }
  statusLine.textContent = failureText(data);
}

function failureText(data) {
  if (typeof data?.error === 'string' && data.error !== '') return data.error;
  if (typeof data?.message === 'string' && data.message !== '') return data.message;
  return FAILED_TEXT;
}
