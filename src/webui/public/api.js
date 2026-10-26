// Every request resolves instead of rejecting and logs its own failure,
// so a caller branches on one value.

// The line a control or dialog shows when a request got no answer or no readable reason.
export const FAILED_TEXT = 'That action failed. Try again.';

// A mode with a login refuses a session's POST without this token, which GET /api/auth/session returns.
let csrfToken = null;
// A 401 means the session ended, so the page swaps the player for the login view or the jukebox-ended view.
let onLoginRequired = () => {};

export function setCsrfToken(token) {
  csrfToken = token;
}

export function setLoginRequiredHandler(handler) {
  onLoginRequired = handler;
}

export async function getJson(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.json();
    if (res.status === 401) onLoginRequired();
    const text = await res.text().catch(() => '');
    console.warn(`webui: ${url} failed`, res.status, text);
  } catch (err) {
    console.warn(`webui: ${url} failed`, err);
  }
  return null;
}

// A failed answer keeps its body, so the caller can show the server's error text.
export function getJsonResult(url) {
  return requestJson(url);
}

// The server rejects a POST without a JSON Content-Type, so a bodyless control sends `{}`.
export function postJson(path, body = {}) {
  return requestJson(path, body);
}

// The login answers 401 for a wrong password, which must not trigger the login-required handler.
export function postLogin(password) {
  return requestJson('/api/auth/login', { password }, { notifyLoginRequired: false });
}

// A refused join never answers 401, since a join never ends a session, so it skips the handler too.
export function postJoin(key) {
  return requestJson('/api/auth/join', { key }, { notifyLoginRequired: false });
}

export function postGuestNickname(nickname) {
  return requestJson('/api/guest/nickname', { nickname });
}

// A body makes the request a JSON POST. It is serialized inside the try, so an
// unserializable body resolves too. A request that gets no answer reports a null status.
async function requestJson(url, body, { notifyLoginRequired = true } = {}) {
  try {
    const init = body === undefined ? undefined : { method: 'POST', headers: postHeaders(), body: JSON.stringify(body) };
    const res = await fetch(url, init);
    const text = await res.text().catch(() => '');
    if (!res.ok) console.warn(`webui: ${url} failed`, res.status, text);
    if (res.status === 401 && notifyLoginRequired) onLoginRequired();
    return { ok: res.ok, status: res.status, data: parseJson(text) };
  } catch (err) {
    console.warn(`webui: ${url} failed`, err);
    return { ok: false, status: null, data: null };
  }
}

function postHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (csrfToken !== null) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
