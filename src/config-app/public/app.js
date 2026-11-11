/*
 * Served as-is with no build step. Each FIELDS row maps a settings.json path to a form element, so
 * populate(), collect() and the lookup of a field an error names share one table.
 */
'use strict';

const RAW_TRANSCODE_FORMAT = 'raw';
const LOCALHOST_ADMIN_ACCESS = 'localhost';

const FIELDS = [
  ['navidrome.url', 'url', 'string'],
  ['navidrome.username', 'username', 'string'],
  ['navidrome.password', 'password', 'secret'],
  ['library.defaultLibraryIds', 'defaultLibraries', 'csvIntArray'],
  ['library.filterCacheEnabled', 'filterCacheEnabled', 'bool', true],
  ['transport.type', 'transportType', 'string', 'stdio'],
  ['transport.host', 'transportHost', 'stringOrNull'],
  ['transport.port', 'transportPort', 'int', 3000],
  ['transport.expose', 'transportExpose', 'bool', false],
  ['transport.authToken', 'transportAuthToken', 'stringOrNull'],
  ['transport.allowedHosts', 'transportAllowedHosts', 'csvStringArray'],
  ['transport.allowedOrigins', 'transportAllowedOrigins', 'csvStringArray'],
  ['features.lastFmApiKey', 'lastFmApiKey', 'stringOrNull'],
  ['features.radio', 'radio', 'bool', true],
  ['features.radioBrowserUserAgent', 'radioBrowserUserAgent', 'stringOrNull'],
  ['features.radioBrowserBase', 'radioBrowserBase', 'stringOrNull'],
  ['features.lyrics', 'lyrics', 'bool', true],
  ['features.lrclibUserAgent', 'lrclibUserAgent', 'stringOrNull'],
  ['features.lrclibBase', 'lrclibBase', 'stringOrNull'],
  ['playback.mpvPath', 'mpvPath', 'pathOrNull'],
  ['playback.audioDevice', 'audioDevice', 'audioDevice'],
  ['playback.transcodeFormat', 'transcodeFormat', 'string', RAW_TRANSCODE_FORMAT],
  ['playback.transcodeBitrate', 'transcodeBitrate', 'string', '192'],
  ['webui.enabled', 'webuiEnabled', 'bool', true],
  ['webui.port', 'webuiPort', 'int', 8808],
  ['webui.host', 'webuiHost', 'stringOrNull'],
  ['webui.allowedHosts', 'webuiAllowedHosts', 'csvStringArray'],
  ['webui.publicUrl', 'webuiPublicUrl', 'stringOrNull'],
  ['webui.expose', 'webuiExpose', 'bool', false],
  ['webui.autoOpenBrowser', 'webuiAutoOpen', 'bool', false],
  ['webui.tls.certPath', 'webuiTlsCert', 'pathOrNull'],
  ['webui.tls.keyPath', 'webuiTlsKey', 'pathOrNull'],
  ['webui.auth.mode', 'webuiAuthMode', 'string', 'none'],
  ['webui.auth.adminAccess', 'webuiAdminAccess', 'string', LOCALHOST_ADMIN_ACCESS],
  ['webui.auth.askPasswordOnThisComputer', 'webuiAskPasswordHere', 'bool', true],
  ['webui.auth.adminPassword', 'webuiAdminPassword', 'writeOnlySecret'],
  ['advanced.debug', 'debug', 'bool', false],
];

const TRANSPORT_TYPE_PATH = 'transport.type';

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = cur[keys[i]] || {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function populate(seed) {
  for (const [path, id, kind, dflt] of FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const raw = getPath(seed, path);
    switch (kind) {
      case 'bool':
        el.checked = typeof raw === 'boolean' ? raw : Boolean(dflt);
        break;
      case 'csvIntArray':
        el.value = Array.isArray(raw) ? raw.join(',') : '';
        break;
      case 'csvStringArray':
        el.value = Array.isArray(raw) ? raw.join(', ') : '';
        break;
      case 'int':
        el.value = raw == null ? '' : String(raw);
        break;
      case 'audioDevice':
        selectAudioDevice(el, raw);
        break;
      case 'writeOnlySecret':
        // The seed never carries this value, so the field always starts blank.
        el.value = '';
        break;
      default:
        // A <select> such as transport.type needs its default, or it shows no selected option.
        el.value = raw == null ? (dflt == null ? '' : String(dflt)) : String(raw);
    }
  }
}

function readField(el, kind, dflt) {
  switch (kind) {
    case 'bool':
      return el.checked;
    case 'string':
      return el.value.trim();
    case 'secret':
    case 'writeOnlySecret':
      // Not trimmed, since a credential may start or end with whitespace.
      return el.value;
    case 'stringOrNull': {
      const v = el.value.trim();
      return v === '' ? null : v;
    }
    case 'pathOrNull': {
      // Windows "Copy as path" adds quotes that the mpv existence check rejects.
      const v = el.value.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
      return v === '' ? null : v;
    }
    case 'int': {
      const n = parseInt(el.value, 10);
      return Number.isFinite(n) ? n : dflt;
    }
    case 'csvIntArray':
      return el.value
        .split(',')
        .map((t) => parseInt(t.trim(), 10))
        .filter((n) => Number.isFinite(n));
    case 'csvStringArray':
      return el.value
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');
    case 'audioDevice': {
      // The label may carry a "(not connected)" suffix, so the name comes from data-name.
      const name = el.selectedOptions[0]?.dataset.name ?? '';
      return el.value === '' ? null : { id: el.value, name: name === '' ? null : name };
    }
    default:
      return el.value;
  }
}

// The value readField returns after populate() fills a field that has no stored value.
function defaultFieldValue(kind, dflt) {
  switch (kind) {
    case 'bool':
      return Boolean(dflt);
    case 'int':
      return dflt;
    case 'csvIntArray':
    case 'csvStringArray':
      return [];
    case 'stringOrNull':
    case 'pathOrNull':
    case 'audioDevice':
      return null;
    default:
      return dflt == null ? '' : dflt;
  }
}

// A disabled field sits in a hidden row, so the post omits it and the stored value stays.
function collect() {
  const out = {};
  for (const [path, id, kind, dflt] of FIELDS) {
    const el = document.getElementById(id);
    if (!el || el.disabled) continue;
    setPath(out, path, readField(el, kind, dflt));
  }
  return out;
}

// Each field value as populate() loaded it, keyed by settings.json path, so Save can post only the changed fields.
let loadedValues = new Map();
// False when the seed came from env, a suggestion or a voided store, so the first Save writes every value.
let storeUsable = false;

function snapshotFields() {
  const values = new Map();
  for (const [path, id, kind, dflt] of FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    // The store never holds a typed password as text, so any typed password counts as a change.
    const value = kind === 'writeOnlySecret' ? '' : readField(el, kind, dflt);
    values.set(path, JSON.stringify(value));
  }
  return values;
}

// Marks a changed-fields post, so the server refuses it when the store turned unusable after the page loaded.
const CHANGED_ONLY_HEADER = 'X-Settings-Changed-Only';

// The store keeps each key the post omits, so a value the gear menu saved while this page was open survives.
function changedFields(payload) {
  if (!storeUsable) return payload;
  const out = {};
  for (const [path] of FIELDS) {
    const value = getPath(payload, path);
    if (value === undefined || loadedValues.get(path) === JSON.stringify(value)) continue;
    setPath(out, path, value);
  }
  return out;
}

// The libraries the user can see, or null while they are not loaded or could not load.
let userLibraries = null;
// The checkboxes of the last renderLibraryPicker(), in the order the picker shows them.
let libraryBoxes = [];
// A slow answer for an earlier request must not replace a later one.
let libraryRequestCount = 0;

// The text field stays the value of defaultLibraryIds, so collect(), the changed-fields post and the
// check in collectChecked() need no picker code. The picker only hides it and writes to it.
function renderLibraryPicker() {
  const loaded = Array.isArray(userLibraries) && userLibraries.length > 0;
  const picker = document.getElementById('libraryPicker');
  document.getElementById('defaultLibrariesRow').hidden = loaded;
  // One library leaves nothing to pick, and a stored ID stays in the hidden text field.
  picker.hidden = !loaded || userLibraries.length < 2;
  if (picker.hidden) return;

  const stored = new Set(readField(document.getElementById('defaultLibraries'), 'csvIntArray'));
  const known = new Set(userLibraries.map((library) => library.id));
  // A stored ID the user cannot see gets its own checked box, so a save keeps it.
  const unseen = Array.from(stored).filter((id) => !known.has(id));
  const choices = [
    ...userLibraries.map((library) => buildLibraryChoice(library.id, library.name, stored.has(library.id))),
    ...unseen.map((id) => buildLibraryChoice(id, `Library ${id} (not found)`, true)),
  ];
  libraryBoxes = choices.map((choice) => choice.box);
  document.getElementById('libraryChoices').replaceChildren(...choices.map((choice) => choice.row));
}

function buildLibraryChoice(id, label, checked) {
  const row = document.createElement('label');
  row.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = String(id);
  box.checked = checked;
  box.addEventListener('change', syncLibraryField);
  const text = document.createElement('span');
  text.textContent = label;
  row.append(box, text);
  return { row, box };
}

function syncLibraryField() {
  document.getElementById('defaultLibraries').value = libraryBoxes
    .filter((box) => box.checked)
    .map((box) => box.value)
    .join(',');
}

// Resolves to null when the server cannot list them, so the text field stays.
async function fetchUserLibraries() {
  try {
    const { ok, data } = await postJson('/api/settings/libraries', collect());
    return ok && data.ok === true && Array.isArray(data.libraries) ? data.libraries : null;
  } catch (_) {
    return null;
  }
}

async function refreshUserLibraries() {
  const request = ++libraryRequestCount;
  const libraries = await fetchUserLibraries();
  if (request !== libraryRequestCount) return;
  userLibraries = libraries;
  renderLibraryPicker();
}

// An edited login no longer matches the list, so the text field returns until the next successful Test.
function dropUserLibraries() {
  libraryRequestCount++;
  userLibraries = null;
  renderLibraryPicker();
}

// A form with no login yet cannot list libraries, so it skips the request.
function hasLoginFields() {
  return ['url', 'username', 'password'].every((id) => document.getElementById(id).value.trim() !== '');
}

function advancedSection() {
  return document.getElementById('advancedSettings');
}

function openAdvancedFor(el) {
  const section = advancedSection();
  if (el && section.contains(el)) section.open = true;
}

// A stored value the user set by hand opens the section, so the first view never hides it.
function openAdvancedWhenNotDefault() {
  const section = advancedSection();
  for (const [, id, kind, dflt] of FIELDS) {
    const el = document.getElementById(id);
    if (!el || el.disabled || !section.contains(el)) continue;
    if (!holdsDefault(el, kind, dflt)) {
      section.open = true;
      return;
    }
  }
}

// The runtime reads a blank string such as playback.transcodeFormat as its default (nonEmpty in map-config.ts).
function holdsDefault(el, kind, dflt) {
  const value = readField(el, kind, dflt);
  if (kind === 'string' && value === '') return true;
  return JSON.stringify(value) === JSON.stringify(defaultFieldValue(kind, dflt));
}

// A longer path such as webui.tls.certPath does not count as naming webui.tls, and a sentence's closing period does not block a match.
function namesPath(text, path) {
  const escaped = path.replace(/\./g, '\\.');
  return new RegExp(`(^|[^\\w.])${escaped}(?!\\w|\\.\\w)`).test(text);
}

// Server errors name settings.json paths such as webui.host, which FIELDS maps to a form field.
function openAdvancedForFieldsNamedIn(text) {
  if (typeof text !== 'string') return;
  for (const [path, id] of FIELDS) {
    if (namesPath(text, path)) openAdvancedFor(document.getElementById(id));
  }
}

function showFieldError(fieldId, message) {
  showStatus(message, 'err');
  openAdvancedFor(document.getElementById(fieldId));
}

// The empty option already stands for mpv's `auto` device.
const AUTO_DEVICE_ID = 'auto';

// A failed probe leaves only System default, so the form still loads and saves.
async function loadAudioDevices() {
  try {
    const res = await fetch('/api/settings/audio-devices');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.devices) ? data.devices : [];
  } catch (_) {
    return [];
  }
}

function fillAudioDevices(devices) {
  const select = document.getElementById('audioDevice');
  for (const device of devices) {
    if (device.id === AUTO_DEVICE_ID) continue;
    select.appendChild(buildAudioDeviceOption(device.id, device.name, device.name || device.id));
  }
}

// A saved device missing from the probe gets its own option, so a save keeps it.
function selectAudioDevice(select, device) {
  const id = device != null && typeof device.id === 'string' ? device.id : '';
  if (id === '' || id === AUTO_DEVICE_ID) {
    select.value = '';
    return;
  }
  const listed = Array.from(select.options).some((option) => option.value === id);
  if (!listed) {
    const name = typeof device.name === 'string' ? device.name : '';
    select.appendChild(buildAudioDeviceOption(id, name, `${name || id} (not connected)`));
  }
  select.value = id;
}

function buildAudioDeviceOption(id, name, label) {
  const option = document.createElement('option');
  option.value = id;
  option.dataset.name = name;
  option.textContent = label;
  return option;
}

// Mirrors the server's webui.host rule, so a bad value is flagged before a round trip.
const WEBUI_BIND_HOSTS = ['127.0.0.1', '0.0.0.0', '::'];

const ADMIN_PASSWORD_MIN_LENGTH = 8;
const ADMIN_PASSWORD_MAX_LENGTH = 128;
// The seed reports only whether a hash is stored, never the hash.
let adminPasswordSet = false;

const ADMIN_ACCESS_WARNINGS = {
  localhost: '',
  lan: 'Anyone on your network who learns the admin password gets full control of the player.',
  anywhere:
    'The admin login is open to the internet. Without HTTPS the password crosses the internet in clear text, ' +
    'so set the HTTPS certificate and key files. Anyone who learns the password gets full control of the player.',
};

function renderAdminAccessWarning() {
  const warning = ADMIN_ACCESS_WARNINGS[document.getElementById('webuiAdminAccess').value] || '';
  const el = document.getElementById('webuiAdminAccessWarn');
  el.textContent = warning;
  el.hidden = warning === '';
}

function renderAdminPasswordState() {
  document.getElementById('webuiAdminPasswordState').textContent = adminPasswordSet
    ? 'A password is set. Leave blank to keep it.'
    : `No password is set. Only this computer can log in as admin. Use ${ADMIN_PASSWORD_MIN_LENGTH} to ${ADMIN_PASSWORD_MAX_LENGTH} characters.`;
}

// The confirm field follows the password field, since a blank password keeps the stored one.
function renderAdminPasswordConfirm() {
  const hasLogin = document.getElementById('webuiAuthMode').value !== 'none';
  const typed = document.getElementById('webuiAdminPassword').value !== '';
  document.getElementById('webuiAdminPasswordConfirmRow').hidden = !(hasLogin && typed);
}

const LOOPBACK_BIND = '127.0.0.1';
const EXPOSE_WARNINGS = {
  exposeOff: 'Guests cannot reach the jukebox until Expose on LAN is on.',
  loopbackHost: 'Guests cannot reach the jukebox while Bind host is 127.0.0.1. Clear Bind host or set it to 0.0.0.0.',
};

// The jukebox link needs a LAN-reachable bind. A blank Bind host follows Expose on LAN, and an explicit one overrides it.
function renderExposeWarning() {
  const jukebox = document.getElementById('webuiAuthMode').value === 'jukebox';
  const exposed = document.getElementById('webuiExpose').checked;
  const host = document.getElementById('webuiHost').value.trim();
  const el = document.getElementById('webuiExposeWarn');
  const loopback = host === '' ? !exposed : host === LOOPBACK_BIND;
  el.textContent = host === '' ? EXPOSE_WARNINGS.exposeOff : EXPOSE_WARNINGS.loopbackHost;
  el.hidden = !(jukebox && loopback);
}

// Only the http transport reads these fields.
function renderTransport() {
  const http = document.getElementById('transportType').value === 'http';
  document.getElementById('transportHttpFields').hidden = !http;
  for (const [path, id] of FIELDS) {
    if (path.startsWith('transport.') && path !== TRANSPORT_TYPE_PATH) document.getElementById(id).disabled = !http;
  }
}

// The player streams the original file while the format is raw, so it reads no bitrate.
function renderTranscode() {
  const format = document.getElementById('transcodeFormat').value.trim();
  const raw = format === '' || format === RAW_TRANSCODE_FORMAT;
  document.getElementById('transcodeBitrateRow').hidden = raw;
  document.getElementById('transcodeBitrate').disabled = raw;
}

function bindRevealButton(button) {
  const input = document.getElementById(button.dataset.reveal);
  const iconShow = button.querySelector('.icon-show');
  const iconHide = button.querySelector('.icon-hide');
  button.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    // An SVG element has no `hidden` property, so the attribute is toggled directly.
    iconShow.toggleAttribute('hidden', reveal);
    iconHide.toggleAttribute('hidden', !reveal);
  });
}

const AUTH_MODE_HINTS = {
  none: 'No login. Every device that reaches the player controls it. Internet addresses are refused.',
  password: 'A browser logs in with the admin password.',
  jukebox: 'A browser logs in with the admin password. Guests scan a QR code from the player and can only add songs.',
};
// The mode the form loaded with, so leaving `jukebox` warns that the restart ends the jukebox.
let loadedAuthMode = 'none';

function renderAuthMode() {
  const mode = document.getElementById('webuiAuthMode').value;
  const adminAccess = document.getElementById('webuiAdminAccess');
  const hasLogin = mode === 'password' || mode === 'jukebox';
  document.getElementById('webuiAuthModeHint').textContent = AUTH_MODE_HINTS[mode] || '';
  document.getElementById('webuiAuthModeWarn').hidden = !(loadedAuthMode === 'jukebox' && mode !== 'jukebox');
  document.getElementById('webuiAdminPasswordRow').hidden = !hasLogin;
  document.getElementById('webuiAskPasswordHereRow').hidden = !hasLogin;
  document.getElementById('webuiAskPasswordHere').disabled = !hasLogin;
  document.getElementById('webuiAdminAccessRow').hidden = !hasLogin;
  adminAccess.disabled = !hasLogin;
  // The admin access row and its warning sit in the Advanced section, so a wider access opens it.
  if (hasLogin && adminAccess.value !== LOCALHOST_ADMIN_ACCESS) openAdvancedFor(adminAccess);
  renderAdminPasswordConfirm();
  renderExposeWarning();
}

// Only a save stores the admin password, so only a save needs it confirmed.
function collectChecked(confirmPassword = false) {
  const payload = collect();
  const host = payload.webui ? payload.webui.host : null;
  if (host != null && !WEBUI_BIND_HOSTS.includes(host)) {
    showFieldError('webuiHost', `Bind host "${host}" is not supported. Leave it blank or use one of ${WEBUI_BIND_HOSTS.join(', ')}.`);
    return null;
  }
  // Mirrors the server's rule that HTTPS needs both files.
  const tls = payload.webui ? payload.webui.tls : null;
  if (tls && (tls.certPath === null) !== (tls.keyPath === null)) {
    showFieldError('webuiTlsCert', 'HTTPS needs both the certificate file and the key file. Set both, or clear both to serve HTTP.');
    return null;
  }
  // Mirrors the server's admin password rules, so a bad value is flagged before a round trip.
  const auth = payload.webui ? payload.webui.auth : null;
  if (auth) {
    // A hidden row keeps its stored value, so a password typed there before a mode switch is neither saved nor checked.
    if (auth.mode === 'none') auth.adminPassword = '';
    const confirmation = document.getElementById('webuiAdminPasswordConfirm').value;
    if (confirmPassword && auth.adminPassword !== '' && auth.adminPassword !== confirmation) {
      showStatus('The passwords do not match.', 'err');
      return null;
    }
    const length = auth.adminPassword.length;
    if (length > 0 && (length < ADMIN_PASSWORD_MIN_LENGTH || length > ADMIN_PASSWORD_MAX_LENGTH)) {
      showStatus(`The admin password must be ${ADMIN_PASSWORD_MIN_LENGTH} to ${ADMIN_PASSWORD_MAX_LENGTH} characters.`, 'err');
      return null;
    }
  }
  // collect() drops non-numeric tokens, and an empty list means all libraries, so a typo would
  // lift the restriction without notice.
  const bad = document.getElementById('defaultLibraries').value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .find((t) => !/^\d+$/.test(t));
  if (bad !== undefined) {
    showFieldError('defaultLibraries', `Default libraries "${bad}" is not a library ID. Use comma-separated numbers such as 1,2, or leave blank for all.`);
    return null;
  }
  return payload;
}

function showStatus(message, kind, boxId = 'status') {
  const box = document.getElementById(boxId);
  box.textContent = message;
  box.className = `status show ${kind}`;
}

// A save that the Jukebox Remote could not start from still saved, so the form stays and names the field.
// A first save lists the next steps, and the Jukebox Remote address is a link.
function showSaveResult(data) {
  const startFailed = data.startFailed === true;
  showStatus(data.message || 'Saved.', startFailed ? 'err' : 'ok');
  if (startFailed) openAdvancedForFieldsNamedIn(data.message);
  if (!Array.isArray(data.nextSteps)) return;
  const list = document.createElement('ol');
  list.className = 'next-steps';
  for (const step of data.nextSteps) {
    const item = document.createElement('li');
    item.textContent = String(step.text);
    if (typeof step.url === 'string') {
      const link = document.createElement('a');
      link.href = typeof step.href === 'string' ? step.href : step.url;
      link.textContent = step.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(' ', link);
    }
    list.append(item);
  }
  document.getElementById('status').append(list);
}

// Set when a Save started the Jukebox Remote, since its settings server closes after that reply.
let pageClosed = false;

function setBusy(busy) {
  document.getElementById('test-btn').disabled = busy || pageClosed;
  document.getElementById('save-btn').disabled = busy || pageClosed;
  renderShortcutButton();
}

// Set while a shortcut request runs, since writing a Windows shortcut can take seconds.
let shortcutBusy = false;

function renderShortcutButton() {
  document.getElementById('shortcut-btn').disabled = shortcutBusy || pageClosed;
}

function showShortcutResult(message, kind, paths = []) {
  showStatus(message, kind, 'shortcutStatus');
  if (paths.length === 0) return;
  const list = document.createElement('ul');
  list.className = 'shortcut-paths';
  for (const path of paths) {
    const item = document.createElement('li');
    item.textContent = String(path);
    list.append(item);
  }
  document.getElementById('shortcutStatus').append(list);
}

async function onCreateShortcut() {
  shortcutBusy = true;
  renderShortcutButton();
  showShortcutResult('Creating the shortcut…', 'info');
  try {
    const { data } = await postJson('/api/settings/shortcut', {});
    if (data.ok) {
      showShortcutResult(data.message || 'Created the shortcut.', 'ok', Array.isArray(data.paths) ? data.paths : []);
    } else {
      showShortcutResult(data.error || 'Could not create the shortcut.', 'err');
    }
  } catch (err) {
    showShortcutResult(`Could not create the shortcut: ${err.message}`, 'err');
  } finally {
    shortcutBusy = false;
    renderShortcutButton();
  }
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    // A non-JSON error body leaves data empty.
  }
  return { ok: res.ok, data };
}

// The server validates a Test body with no merge onto the stored file, so Test posts every enabled field.
async function onTest() {
  const payload = collectChecked();
  if (payload === null) return;
  setBusy(true);
  showStatus('Testing connection…', 'info');
  try {
    const { data } = await postJson('/api/settings/test', payload);
    if (data.ok) {
      showStatus(data.message || 'Connected.', 'ok');
      void refreshUserLibraries();
    } else {
      showStatus(data.error || 'Connection failed.', 'err');
      openAdvancedForFieldsNamedIn(data.error);
    }
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, 'err');
  } finally {
    setBusy(false);
  }
}

async function onSave(event) {
  event.preventDefault();
  const form = collectChecked(true);
  if (form === null) return;
  setBusy(true);
  showStatus('Saving…', 'info');
  try {
    const headers = storeUsable ? { [CHANGED_ONLY_HEADER]: '1' } : {};
    const { ok, data } = await postJson('/api/settings', changedFields(form), headers);
    if (ok && data.ok) {
      showSaveResult(data);
      showStoreNotices(data.storeNotices);
      pageClosed = data.pageClosed === true;
      if (pageClosed) return;
      // The stored hash now holds the typed password, so the field clears and the next save keeps it.
      if (form.webui.auth.adminPassword !== '') {
        adminPasswordSet = true;
        document.getElementById('webuiAdminPassword').value = '';
        document.getElementById('webuiAdminPasswordConfirm').value = '';
        renderAdminPasswordState();
        renderAdminPasswordConfirm();
      }
      storeUsable = true;
      await reloadSavedSettings();
      loadedValues = snapshotFields();
    } else {
      showStatus(data.error || 'Save failed.', 'err');
      openAdvancedForFieldsNamedIn(data.error);
    }
  } catch (err) {
    showStatus(`Save failed: ${err.message}`, 'err');
  } finally {
    setBusy(false);
  }
}

const SEED_FAILED_MESSAGE = 'Could not load the saved settings. The form shows default values.';

// A save over an unusable store replaces it, so the user must learn before Save which of its values did not load.
// A file the server cannot read cannot be backed up either, so Save fails until the file is fixed.
function storeProblemMessage(problem, unreadable, salvaged) {
  const shown = salvaged
    ? 'This form shows each value of the file that the server could read and accept. Default and environment values fill the rest.'
    : "This form shows default and environment values instead of the file's values.";
  const remedy = unreadable
    ? "Save fails until the server can read the file. Fix the file's permissions or move it away, then reload this page."
    : 'A save keeps the old file as settings.json.bak.';
  return `${problem}. ${shown} ${remedy}`;
}

// One item per settings.json key the server read past, such as an unknown key or a quoted number.
// A save rewrites each coerced value, so the list it returns replaces the one shown.
function showStoreNotices(notices) {
  const list = document.getElementById('storeNotices');
  const shown = Array.isArray(notices) ? notices : [];
  const items = shown.map((notice) => {
    const item = document.createElement('li');
    item.textContent = String(notice);
    return item;
  });
  list.replaceChildren(...items);
  list.hidden = items.length === 0;
}

// A seed without the path keeps the generic name written in index.html.
function showPath(elementId, path) {
  if (typeof path === 'string' && path !== '') document.getElementById(elementId).textContent = path;
}

// Resolves to null when the server answers an error or the request fails.
async function fetchSeed() {
  try {
    const res = await fetch('/api/settings/seed');
    return res.ok ? await res.json() : null;
  } catch (_) {
    return null;
  }
}

// The options go in before populate() picks one, so a slow probe cannot reset the field.
async function loadForm() {
  const devicesRequest = loadAudioDevices();
  const seed = await fetchSeed();
  fillAudioDevices(await devicesRequest);
  if (seed === null) {
    // An unfilled checkbox reads as off, so a Save would turn off each feature whose default is on.
    populate({});
    showStatus(SEED_FAILED_MESSAGE, 'err');
    return;
  }
  populate(seed);
  storeUsable = seed.storeUsable === true;
  showPath('storePath', seed.storePath);
  showPath('logPath', seed.logPath);
  adminPasswordSet = getPath(seed, 'webui.auth.adminPasswordSet') === true;
  loadedAuthMode = document.getElementById('webuiAuthMode').value;
  showStoreNotices(seed.storeNotices);
  if (typeof seed.storeProblem === 'string') {
    showStatus(storeProblemMessage(seed.storeProblem, seed.storeUnreadable === true, seed.storeSalvaged === true), 'err');
  }
}

// A changed-fields Save keeps each key it omits, so the form re-reads a value another writer such as
// the set_audio_device tool stored. A typed password the Save did not store stays in its field.
async function reloadSavedSettings() {
  const seed = await fetchSeed();
  if (seed === null || seed.storeUsable !== true) return;
  const passwordField = document.getElementById('webuiAdminPassword');
  const typedPassword = passwordField.value;
  populate(seed);
  passwordField.value = typedPassword;
  adminPasswordSet = getPath(seed, 'webui.auth.adminPasswordSet') === true;
  renderFormState();
}

function renderFormState() {
  renderAdminPasswordState();
  renderAdminAccessWarning();
  renderAuthMode();
  renderTransport();
  renderTranscode();
  renderLibraryPicker();
}

async function init() {
  await loadForm();
  renderFormState();
  loadedValues = snapshotFields();
  openAdvancedWhenNotDefault();
  if (hasLoginFields()) void refreshUserLibraries();
  document.getElementById('webuiAdminAccess').addEventListener('change', renderAdminAccessWarning);
  document.getElementById('webuiAuthMode').addEventListener('change', renderAuthMode);
  document.getElementById('webuiAdminPassword').addEventListener('input', renderAdminPasswordConfirm);
  document.getElementById('webuiExpose').addEventListener('change', renderExposeWarning);
  document.getElementById('webuiHost').addEventListener('input', renderExposeWarning);
  document.getElementById('transportType').addEventListener('change', renderTransport);
  document.getElementById('transcodeFormat').addEventListener('input', renderTranscode);
  document.querySelectorAll('button[data-reveal]').forEach(bindRevealButton);
  document.getElementById('test-btn').addEventListener('click', onTest);
  document.getElementById('shortcut-btn').addEventListener('click', onCreateShortcut);
  for (const id of ['url', 'username', 'password']) {
    document.getElementById(id).addEventListener('input', dropUserLibraries);
  }
  const form = document.getElementById('settings-form');
  form.addEventListener('submit', onSave);
  // The browser cannot show the message of a field inside a closed section, and `invalid` does not bubble.
  form.addEventListener('invalid', (event) => openAdvancedFor(event.target), true);
  const genBtn = document.getElementById('transportAuthTokenGen');
  if (genBtn) genBtn.addEventListener('click', generateAuthToken);
}

// Shown as plain text so the user can copy it into the client config.
function generateAuthToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const el = document.getElementById('transportAuthToken');
  el.type = 'text';
  el.value = token;
}

init();
