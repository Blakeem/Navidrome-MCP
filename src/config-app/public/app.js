/*
 * Served as-is with no build step. Each FIELDS row maps a settings.json path to a form element, so
 * populate() and collect() share one table.
 */
'use strict';

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
  ['features.musicBrainzUserAgent', 'musicBrainzUserAgent', 'stringOrNull'],
  ['features.radioBrowserUserAgent', 'radioBrowserUserAgent', 'stringOrNull'],
  ['features.radioBrowserBase', 'radioBrowserBase', 'stringOrNull'],
  ['features.lyricsProvider', 'lyricsProvider', 'string'],
  ['features.lrclibUserAgent', 'lrclibUserAgent', 'stringOrNull'],
  ['features.lrclibBase', 'lrclibBase', 'stringOrNull'],
  ['playback.mpvPath', 'mpvPath', 'pathOrNull'],
  ['playback.audioDevice', 'audioDevice', 'audioDevice'],
  ['playback.transcodeFormat', 'transcodeFormat', 'string'],
  ['playback.transcodeBitrate', 'transcodeBitrate', 'string'],
  ['webui.enabled', 'webuiEnabled', 'bool', true],
  ['webui.port', 'webuiPort', 'int', 8808],
  ['webui.host', 'webuiHost', 'stringOrNull'],
  ['webui.allowedHosts', 'webuiAllowedHosts', 'csvStringArray'],
  ['webui.publicUrl', 'webuiPublicUrl', 'stringOrNull'],
  ['webui.expose', 'webuiExpose', 'bool', false],
  ['webui.autoOpenBrowser', 'webuiAutoOpen', 'bool', false],
  ['webui.persistAfterMcpExit', 'webuiPersist', 'bool', false],
  ['webui.visualizer', 'webuiVisualizer', 'bool', true],
  ['webui.tls.certPath', 'webuiTlsCert', 'pathOrNull'],
  ['webui.tls.keyPath', 'webuiTlsKey', 'pathOrNull'],
  ['webui.auth.mode', 'webuiAuthMode', 'string', 'none'],
  ['webui.auth.adminAccess', 'webuiAdminAccess', 'string', 'localhost'],
  ['webui.auth.adminPassword', 'webuiAdminPassword', 'writeOnlySecret'],
  ['jukebox.guestQueueLimit', 'jukeboxGuestQueueLimit', 'int', 3],
  ['advanced.debug', 'debug', 'bool', false],
  ['advanced.tokenExpiry', 'tokenExpiry', 'int', 86400],
];

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

function collect() {
  const out = {};
  for (const [path, id, kind, dflt] of FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    let value;
    switch (kind) {
      case 'bool':
        value = el.checked;
        break;
      case 'string':
        value = el.value.trim();
        break;
      case 'secret':
      case 'writeOnlySecret':
        // Not trimmed, since a credential may start or end with whitespace.
        value = el.value;
        break;
      case 'stringOrNull': {
        const v = el.value.trim();
        value = v === '' ? null : v;
        break;
      }
      case 'pathOrNull': {
        // Windows "Copy as path" adds quotes that the mpv existence check rejects.
        const v = el.value.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
        value = v === '' ? null : v;
        break;
      }
      case 'int': {
        const n = parseInt(el.value, 10);
        value = Number.isFinite(n) ? n : dflt;
        break;
      }
      case 'csvIntArray':
        value = el.value
          .split(',')
          .map((t) => parseInt(t.trim(), 10))
          .filter((n) => Number.isFinite(n));
        break;
      case 'csvStringArray':
        value = el.value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== '');
        break;
      case 'audioDevice': {
        // The label may carry a "(not connected)" suffix, so the name comes from data-name.
        const name = el.selectedOptions[0]?.dataset.name ?? '';
        value = el.value === '' ? null : { id: el.value, name: name === '' ? null : name };
        break;
      }
      default:
        value = el.value;
    }
    setPath(out, path, value);
  }
  return out;
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

const ADMIN_PASSWORD_MIN_LENGTH = 12;
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
    : `${ADMIN_PASSWORD_MIN_LENGTH} to ${ADMIN_PASSWORD_MAX_LENGTH} characters.`;
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
  password: 'Every browser needs the admin password, this computer included.',
  jukebox: 'Every browser needs the admin password. Guests scan a QR code from the player and can only add songs.',
};
// The mode the form loaded with, so leaving `jukebox` warns that the restart ends the jukebox.
let loadedAuthMode = 'none';

function renderAuthMode() {
  const mode = document.getElementById('webuiAuthMode').value;
  const hasLogin = mode === 'password' || mode === 'jukebox';
  document.getElementById('webuiAuthModeHint').textContent = AUTH_MODE_HINTS[mode] || '';
  document.getElementById('webuiAuthModeWarn').hidden = !(loadedAuthMode === 'jukebox' && mode !== 'jukebox');
  document.getElementById('webuiAdminPasswordRow').hidden = !hasLogin;
  document.getElementById('webuiAdminAccessRow').hidden = !hasLogin;
  document.getElementById('jukeboxGuestQueueLimitRow').hidden = mode !== 'jukebox';
  renderAdminPasswordConfirm();
  renderExposeWarning();
}

// Only a save stores the admin password, so only a save needs it confirmed.
function collectChecked(confirmPassword = false) {
  const payload = collect();
  const host = payload.webui ? payload.webui.host : null;
  if (host != null && !WEBUI_BIND_HOSTS.includes(host)) {
    showStatus(`Bind host "${host}" is not supported. Leave it blank or use one of ${WEBUI_BIND_HOSTS.join(', ')}.`, 'err');
    return null;
  }
  // Mirrors the server's rule that HTTPS needs both files.
  const tls = payload.webui ? payload.webui.tls : null;
  if (tls && (tls.certPath === null) !== (tls.keyPath === null)) {
    showStatus('HTTPS needs both the certificate file and the key file. Set both, or clear both to serve HTTP.', 'err');
    return null;
  }
  // Mirrors the server's admin password rules, so a bad value is flagged before a round trip.
  const auth = payload.webui ? payload.webui.auth : null;
  if (auth) {
    // A hidden row keeps its stored value, so a value typed there before a mode switch is neither saved nor checked.
    if (auth.mode === 'none') {
      auth.adminPassword = '';
      delete auth.adminAccess;
    }
    if (auth.mode !== 'jukebox' && payload.jukebox) delete payload.jukebox.guestQueueLimit;
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
    if (auth.mode !== 'none' && length === 0 && !adminPasswordSet) {
      showStatus('Access with the admin password needs an admin password. Enter one, or set Access to Open.', 'err');
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
    showStatus(`Default libraries "${bad}" is not a library ID. Use comma-separated numbers such as 1,2, or leave blank for all.`, 'err');
    return null;
  }
  return payload;
}

function isEmptyField(el) {
  return el.value == null || String(el.value).trim() === '';
}

function renderSuggestions(suggestions) {
  for (const [path, id] of FIELDS) {
    const value = suggestions[path];
    if (value == null || value === '') continue;
    const el = document.getElementById(id);
    if (!el || !isEmptyField(el)) continue;
    addSuggestion(el, value);
  }
}

function addSuggestion(el, value) {
  const wrap = document.createElement('span');
  wrap.className = 'suggest';
  wrap.appendChild(document.createTextNode(`Suggested: ${value} `));

  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'suggest-use';
  use.textContent = 'use';
  use.addEventListener('click', () => {
    el.value = value;
    wrap.remove();
  });
  wrap.appendChild(use);

  (el.closest('label') || el.parentNode).appendChild(wrap);

  el.addEventListener('input', () => { if (!isEmptyField(el)) wrap.remove(); });
}

function showStatus(message, kind) {
  const box = document.getElementById('status');
  box.textContent = message;
  box.className = `status show ${kind}`;
}

function setBusy(busy) {
  document.getElementById('test-btn').disabled = busy;
  document.getElementById('save-btn').disabled = busy;
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function onTest() {
  const payload = collectChecked();
  if (payload === null) return;
  setBusy(true);
  showStatus('Testing connection…', 'info');
  try {
    const { data } = await postJson('/api/settings/test', payload);
    if (data.ok) showStatus(data.message || 'Connected.', 'ok');
    else showStatus(data.error || 'Connection failed.', 'err');
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, 'err');
  } finally {
    setBusy(false);
  }
}

async function onSave(event) {
  event.preventDefault();
  const payload = collectChecked(true);
  if (payload === null) return;
  setBusy(true);
  showStatus('Saving…', 'info');
  try {
    const { ok, data } = await postJson('/api/settings', payload);
    if (ok && data.ok) {
      showStatus(data.message || 'Saved.', 'ok');
      // The stored hash now holds the typed password, so the field clears and the next save keeps it.
      if (payload.webui.auth.adminPassword !== '') {
        adminPasswordSet = true;
        document.getElementById('webuiAdminPassword').value = '';
        document.getElementById('webuiAdminPasswordConfirm').value = '';
        renderAdminPasswordState();
        renderAdminPasswordConfirm();
      }
    } else {
      showStatus(data.error || 'Save failed.', 'err');
    }
  } catch (err) {
    showStatus(`Save failed: ${err.message}`, 'err');
  } finally {
    setBusy(false);
  }
}

// The options go in before populate() picks one, so a slow probe cannot reset the field.
async function loadForm() {
  const devicesRequest = loadAudioDevices();
  try {
    const res = await fetch('/api/settings/seed');
    const seed = res.ok ? await res.json() : null;
    fillAudioDevices(await devicesRequest);
    if (seed !== null) {
      populate(seed);
      adminPasswordSet = getPath(seed, 'webui.auth.adminPasswordSet') === true;
      loadedAuthMode = document.getElementById('webuiAuthMode').value;
    }
  } catch (_) {
    showStatus('Could not load existing settings; starting blank.', 'err');
  }
}

async function init() {
  await loadForm();
  renderAdminPasswordState();
  renderAdminAccessWarning();
  renderAuthMode();
  document.getElementById('webuiAdminAccess').addEventListener('change', renderAdminAccessWarning);
  document.getElementById('webuiAuthMode').addEventListener('change', renderAuthMode);
  document.getElementById('webuiAdminPassword').addEventListener('input', renderAdminPasswordConfirm);
  document.getElementById('webuiExpose').addEventListener('change', renderExposeWarning);
  document.getElementById('webuiHost').addEventListener('input', renderExposeWarning);
  document.querySelectorAll('button[data-reveal]').forEach(bindRevealButton);
  // Fetched after populate(), so only fields left blank get a hint.
  try {
    const res = await fetch('/api/settings/suggestions');
    if (res.ok) renderSuggestions(await res.json());
  } catch (_) {
    // Hints are optional, so the form works without them.
  }
  document.getElementById('test-btn').addEventListener('click', onTest);
  document.getElementById('settings-form').addEventListener('submit', onSave);
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
