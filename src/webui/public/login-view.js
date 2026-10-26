import { postLogin } from './api.js';
import { stopConnection } from './connection.js';
import { bindPasswordReveal, byId, setHidden } from './dom.js';
import { loginCard } from './page-view.js';

const view = byId('login-view');
const form = byId('login-form');
const help = byId('login-help');
const fields = byId('login-fields');
const password = byId('login-password');
const submit = byId('login-submit');
const status = byId('login-status');
const address = byId('login-address');

// Guests can open this page too, so the refusal never points at the settings page.
const UNAVAILABLE_HELP = 'The admin page is not available from this device.';
const LOGIN_HELP = help.textContent;

export function bindLoginForm() {
  bindPasswordReveal(password, byId('login-password-toggle'));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = '';
    const { ok, data } = await postLogin(password.value);
    if (ok) {
      // A fresh boot binds every module with the new session's CSRF token.
      window.location.reload();
      return;
    }
    submit.disabled = false;
    password.value = '';
    status.textContent = data?.error ?? 'Login failed. Check the connection and try again.';
  });
}

// An admin session outside the access level carries its own refusal, since only the owner holds one.
function loginHelp(card, session) {
  if (card === 'outside-level') return session.outsideLevelMessage;
  return card === 'unavailable' ? UNAVAILABLE_HELP : LOGIN_HELP;
}

// The stream closes first, so it stops reconnecting with the ended session.
export function showLoginView(session) {
  stopConnection();
  document.body.classList.add('login-required');
  view.hidden = false;
  address.textContent = session === null ? '' : `Your address as the player sees it: ${session.yourAddress}`;
  const card = loginCard(session);
  setHidden(fields, card !== 'login');
  help.textContent = loginHelp(card, session);
  if (card === 'login') password.focus();
}
