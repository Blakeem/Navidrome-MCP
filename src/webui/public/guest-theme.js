// The header button lets a guest pick light or dark for this browser while the host leaves the theme on System.

import { byId, setHidden } from './dom.js';
import { hostThemeIsSystem, onThemeChange, paintedScheme, setDeviceTheme } from './theme.js';

const toggle = byId('guest-theme-toggle');
const moonIcon = toggle.querySelector('.icon-moon');
const sunIcon = toggle.querySelector('.icon-sun');

// The icon shows the scheme the next tap switches to.
function renderThemeToggle() {
  const dark = paintedScheme() === 'dark';
  setHidden(toggle, !hostThemeIsSystem());
  toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  setHidden(moonIcon, dark);
  setHidden(sunIcon, !dark);
}

export function bindThemeToggle() {
  toggle.addEventListener('click', () => setDeviceTheme(paintedScheme() === 'dark' ? 'light' : 'dark'));
  onThemeChange(renderThemeToggle);
  renderThemeToggle();
}
