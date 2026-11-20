// The server forces one theme on every device, or none. With none, a device paints its own choice,
// or else follows its own light or dark mode.
// The last forced theme is stored here, so a load paints it before the server answers.
// The device's own choice is stored apart from it, and only while it differs from the device's own mode.

import { prefRead, prefRemove, prefWrite } from './prefs.js';

const THEME_HINT_KEY = 'navidrome-mcp.theme';
const DEVICE_THEME_KEY = 'navidrome-mcp.device-theme';
const THEMES = new Set(['light', 'dark']);
// Each theme-color meta carries its system-scheme color, which a forced theme overrides.
const themeColorMetas = Array.from(
  document.querySelectorAll('meta[name="theme-color"]'),
  (meta) => ({ meta, systemColor: meta.content }),
);
const deviceDarkMode = window.matchMedia('(prefers-color-scheme: dark)');
const changeListeners = [];

function validTheme(value) {
  return THEMES.has(value) ? value : null;
}

// The scheme the device follows when nothing forces one.
function deviceScheme() {
  return deviceDarkMode.matches ? 'dark' : 'light';
}

// A stored choice equal to the device's own mode is dropped, so the device follows its mode again.
function readDeviceTheme() {
  const stored = validTheme(prefRead(DEVICE_THEME_KEY));
  if (stored !== deviceScheme()) return stored;
  prefRemove(DEVICE_THEME_KEY);
  return null;
}

// Undefined until the first apply, so the first call always paints, even for an unset theme.
let hostTheme;
// True once the server has answered, since the stored hint alone does not show that the host's theme is System.
let hostKnown = false;
let deviceTheme = readDeviceTheme();

function paint() {
  const forced = hostTheme ?? deviceTheme;
  const root = document.documentElement;
  if (forced === null) delete root.dataset.theme;
  else root.dataset.theme = forced;
  const forcedColor = forced === null ? '' : getComputedStyle(root).getPropertyValue('--bg').trim();
  for (const { meta, systemColor } of themeColorMetas) meta.content = forcedColor || systemColor;
}

function notifyChange() {
  for (const listener of changeListeners) listener();
}

// Snapshots repeat the theme every second during playback, so an unchanged state returns early.
function update(nextHostTheme, nextHostKnown, nextDeviceTheme) {
  if (nextHostTheme === hostTheme && nextHostKnown === hostKnown && nextDeviceTheme === deviceTheme) return;
  hostTheme = nextHostTheme;
  hostKnown = nextHostKnown;
  deviceTheme = nextDeviceTheme;
  paint();
  notifyChange();
}

export function applyThemeHint() {
  update(validTheme(prefRead(THEME_HINT_KEY)), hostKnown, deviceTheme);
}

export function applyTheme(theme) {
  const next = validTheme(theme);
  if (next !== hostTheme) {
    if (next === null) prefRemove(THEME_HINT_KEY);
    else prefWrite(THEME_HINT_KEY, next);
  }
  update(next, true, deviceTheme);
}

// A scheme equal to the device's own mode stores nothing, so the device keeps following its mode.
export function setDeviceTheme(scheme) {
  const picked = validTheme(scheme);
  if (picked === null) return;
  const kept = picked === deviceScheme() ? null : picked;
  if (kept === null) prefRemove(DEVICE_THEME_KEY);
  else prefWrite(DEVICE_THEME_KEY, kept);
  update(hostTheme, hostKnown, kept);
}

// The player's computer sets the theme in its own group and offers no control for the device choice, so its
// page ignores the choice. The stored key stays, since the guest page on the same origin keeps using it.
export function ignoreDeviceTheme() {
  update(hostTheme, hostKnown, null);
}

// The scheme this page shows now: the host's forced theme, else the device's choice, else its own mode.
export function paintedScheme() {
  return hostTheme ?? deviceTheme ?? deviceScheme();
}

// The per-device controls apply only while the server has said that it forces no theme.
export function hostThemeIsSystem() {
  return hostKnown && hostTheme === null;
}

// The listener runs after the host's theme, the device's choice or the device's own mode changes.
export function onThemeChange(listener) {
  changeListeners.push(listener);
}

// A phone that turns dark at night would otherwise keep a Dark choice that now matches its mode,
// and stay dark when its mode turns light again.
deviceDarkMode.addEventListener('change', () => {
  if (deviceTheme === deviceScheme()) {
    prefRemove(DEVICE_THEME_KEY);
    deviceTheme = null;
    paint();
  }
  notifyChange();
});
