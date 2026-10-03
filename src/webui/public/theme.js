// The color theme. The server holds a forced light or dark theme for every device, and with none set
// each device follows its own setting. This device keeps the last forced theme as a hint,
// so it is painted at load before the server answers.

import { prefRead, prefRemove, prefWrite } from './prefs.js';

const THEME_HINT_KEY = 'navidrome-mcp.theme';
const THEMES = new Set(['light', 'dark']);
// Each theme-color meta carries its system-scheme color, which a forced theme overrides.
const themeColorMetas = Array.from(
  document.querySelectorAll('meta[name="theme-color"]'),
  (meta) => ({ meta, systemColor: meta.content }),
);

// Undefined until the first apply, so the first call always paints, even for an unset theme.
let appliedTheme;

export function applyThemeHint() {
  applyTheme(prefRead(THEME_HINT_KEY));
}

// Snapshots repeat the theme every second during playback, so an unchanged theme returns early.
export function applyTheme(theme) {
  const next = THEMES.has(theme) ? theme : null;
  if (next === appliedTheme) return;
  appliedTheme = next;

  const root = document.documentElement;
  if (next === null) {
    prefRemove(THEME_HINT_KEY);
    delete root.dataset.theme;
  } else {
    prefWrite(THEME_HINT_KEY, next);
    root.dataset.theme = next;
  }
  const forcedColor = next === null ? '' : getComputedStyle(root).getPropertyValue('--bg').trim();
  for (const { meta, systemColor } of themeColorMetas) meta.content = forcedColor || systemColor;
}
