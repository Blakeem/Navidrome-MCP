import { postLogin } from './api.js';
import { stopConnection } from './connection.js';
import { bindPasswordReveal, byId, setHidden } from './dom.js';
import { closeLyrics } from './lyrics-view.js';
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
const LOGIN_FAILED = 'Login failed. Check the connection and try again.';
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
    status.textContent = data?.error ?? LOGIN_FAILED;
  });
}

// An admin session outside the access level carries its own refusal, since only the owner holds one.
// The no-password text comes from the server, since only the server knows the config source and the admin access level.
// A refused passwordless login shows its refusal first, since it names the cause and the wait.
function loginHelp(card, session) {
  if (session?.loginError !== undefined) return session.loginError ?? LOGIN_FAILED;
  if (card === 'outside-level') return session.outsideLevelMessage;
  if (card === 'no-password') return session.noAdminPasswordMessage;
  return card === 'unavailable' ? UNAVAILABLE_HELP : LOGIN_HELP;
}

// The stream closes first, so it stops reconnecting with the ended session. The open dialogs and the
// lyrics overlay close next, since they would cover the login card.
// A passwordless source gets no password field, since the login route ignores its password once the launch key
// admits it. readSession clears the flag when the route asks for the password.
export function showLoginView(session) {
  stopConnection();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  closeLyrics();
  document.body.classList.add('login-required');
  view.hidden = false;
  address.textContent = session === null ? '' : `Your address as the player sees it: ${session.yourAddress}`;
  const card = loginCard(session);
  const showsFields = card === 'login' && session?.passwordlessHere !== true;
  setHidden(fields, !showsFields);
  help.textContent = loginHelp(card, session);
  if (showsFields) password.focus();
}
