/*
 * Navidrome MCP — Settings form logic (vanilla, no build step).
 *
 * Symmetric mapping between the nested settings.json shape and the flat form:
 * each field declares its dotted path, DOM id, and value kind, so seed→form and
 * form→payload use the same table. Password is masked (sentinel) by the server.
 */
'use strict';

const FIELDS = [
  ['navidrome.url', 'url', 'string'],
  ['navidrome.username', 'username', 'string'],
  ['navidrome.password', 'password', 'string'],
  ['library.defaultLibraryIds', 'defaultLibraries', 'csvIntArray'],
  ['library.filterCacheEnabled', 'filterCacheEnabled', 'bool', true],
  ['transport.type', 'transportType', 'string', 'stdio'],
  ['transport.host', 'transportHost', 'stringOrNull'],
  ['transport.port', 'transportPort', 'int', 3000],
  ['transport.expose', 'transportExpose', 'bool', false],
  ['transport.authToken', 'transportAuthToken', 'stringOrNull'],
  ['features.lastFmApiKey', 'lastFmApiKey', 'stringOrNull'],
  ['features.musicBrainzUserAgent', 'musicBrainzUserAgent', 'stringOrNull'],
  ['features.radioBrowserUserAgent', 'radioBrowserUserAgent', 'stringOrNull'],
  ['features.radioBrowserBase', 'radioBrowserBase', 'stringOrNull'],
  ['features.lyricsProvider', 'lyricsProvider', 'string'],
  ['features.lrclibUserAgent', 'lrclibUserAgent', 'stringOrNull'],
  ['features.lrclibBase', 'lrclibBase', 'stringOrNull'],
  ['playback.mpvPath', 'mpvPath', 'stringOrNull'],
  ['playback.transcodeFormat', 'transcodeFormat', 'string'],
  ['playback.transcodeBitrate', 'transcodeBitrate', 'string'],
  ['webui.enabled', 'webuiEnabled', 'bool', true],
  ['webui.port', 'webuiPort', 'int', 8808],
  ['webui.host', 'webuiHost', 'stringOrNull'],
  ['webui.expose', 'webuiExpose', 'bool', false],
  ['webui.autoOpenBrowser', 'webuiAutoOpen', 'bool', false],
  ['webui.persistAfterMcpExit', 'webuiPersist', 'bool', false],
  ['advanced.debug', 'debug', 'bool', false],
  ['advanced.cacheTtl', 'cacheTtl', 'int', 300],
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
      case 'int':
        el.value = raw == null ? '' : String(raw);
        break;
      default: // string | stringOrNull
        // Fall back to the declared default when the seed has no value, so a
        // <select> (e.g. transport.type) lands on a valid option instead of an
        // empty/-1 selection. Text inputs without a default just stay blank.
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
      case 'stringOrNull': {
        const v = el.value.trim();
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
      default:
        value = el.value;
    }
    setPath(out, path, value);
  }
  return out;
}

function isEmptyField(el) {
  return el.value == null || String(el.value).trim() === '';
}

/*
 * Surface recommended values beside any blank field that has one, WITHOUT
 * touching the field. On first run the seed already pre-fills these (so the
 * fields aren't empty and nothing shows); on later runs an existing config is
 * left verbatim, so a deliberately-blank field just gets a gentle suggestion.
 */
function renderSuggestions(suggestions) {
  for (const [path, id] of FIELDS) {
    const value = suggestions[path];
    if (value == null || value === '') continue;
    const el = document.getElementById(id);
    if (!el || !isEmptyField(el)) continue; // pre-filled / user value always wins
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

  // Outside the field: appended to the end of the field's <label>.
  (el.closest('label') || el.parentNode).appendChild(wrap);

  // If the user fills the field themselves, the suggestion is no longer useful.
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
    /* non-JSON error */
  }
  return { ok: res.ok, data };
}

async function onTest() {
  setBusy(true);
  showStatus('Testing connection…', 'info');
  try {
    const { data } = await postJson('/api/settings/test', collect());
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
  setBusy(true);
  showStatus('Saving…', 'info');
  try {
    const { ok, data } = await postJson('/api/settings', collect());
    if (ok && data.ok) showStatus(data.message || 'Saved.', 'ok');
    else showStatus(data.error || 'Save failed.', 'err');
  } catch (err) {
    showStatus(`Save failed: ${err.message}`, 'err');
  } finally {
    setBusy(false);
  }
}

async function init() {
  try {
    const res = await fetch('/api/settings/seed');
    if (res.ok) populate(await res.json());
  } catch (_) {
    showStatus('Could not load existing settings; starting blank.', 'err');
  }
  // Suggestions are optional polish: fetch after populate so we only annotate
  // fields that ended up blank. A failure here must not break the form.
  try {
    const res = await fetch('/api/settings/suggestions');
    if (res.ok) renderSuggestions(await res.json());
  } catch (_) {
    /* no suggestions — the form still works */
  }
  document.getElementById('test-btn').addEventListener('click', onTest);
  document.getElementById('settings-form').addEventListener('submit', onSave);
  const genBtn = document.getElementById('transportAuthTokenGen');
  if (genBtn) genBtn.addEventListener('click', generateAuthToken);
}

/* Fill the auth-token field with a fresh 256-bit random token (hex). Shown as
 * plaintext on generation so the user can copy it for their client config. */
function generateAuthToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const el = document.getElementById('transportAuthToken');
  el.type = 'text';
  el.value = token;
}

init();
