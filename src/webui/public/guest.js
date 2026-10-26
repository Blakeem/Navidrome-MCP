// Production serves the copy that pnpm build places in dist/webui/public and reads it on every
// request, so an edit to this folder needs a build and a page reload.

import { getJson, getJsonResult, postJoin, setCsrfToken, setLoginRequiredHandler } from './api.js';
import { connect, setConnState, stopConnection } from './connection.js';
import { byId, setHidden, setProgressVar } from './dom.js';
import { bindGuestAdd, renderSlots, showGuestAdd } from './guest-add.js';
import { bindGuestLyrics, showGuestLyrics, tickGuestLyrics } from './guest-lyrics.js';
import { bindGuestQueue, renderGuestQueue } from './guest-queue.js';
import { bindChangeName, rememberNickname, showChangeName } from './guest-name.js';
import { bindWelcome, closeWelcome, maybeShowWelcome, jukeboxEndText } from './guest-welcome.js';
import { renderNowPlaying } from './now-playing.js';
import { guestEndCard, guestView, keyFromHash, offersAdminLogin } from './page-view.js';
import { durationSeconds, positionSeconds, rebaseClock } from './playback-clock.js';
import { prefRead, prefRemove, prefWrite } from './prefs.js';
import { playingIndex, queueSongId, storeSnapshot } from './snapshot.js';
import { applyTheme, applyThemeHint } from './theme.js';
import { formatTime } from './time-format.js';
import { bindVisualizer, renderVisualizer } from './visualizer.js';

const GUEST_PATH = '/guest';
const TICK_MS = 250;
const HTTP_FORBIDDEN = 403;
const CLOSED_TITLE = 'The jukebox is closed.';
const JOIN_TITLE = 'Join the jukebox';
const JOIN_HELP = 'Scan the QR code from the host.';
const REJOIN_TITLE = 'Scan the jukebox QR code again';
// A guest session can end while the jukebox stays open, such as on its idle expiry, so the title names only the session.
const ENDED_TITLE = 'Your jukebox session ended';
const PREVIEW_ENDED_TITLE = 'Your admin session ended';
// The end reason outlives a reload, since the ended session leaves the server nothing to say why.
const ENDED_REASON_KEY = 'navidrome-mcp.guest-end-reason';
// A refusal carries the server's error text, so a reply with no body means the request never got an answer.
const NO_ANSWER = 'The player did not answer. Check the connection and try again.';

const main = byId('guest-main');
const joinView = byId('guest-join');
const joinTitle = byId('guest-join-title');
const joinHelp = byId('guest-join-help');
const joinHint = byId('guest-join-hint');
const joinStatus = byId('guest-join-status');
const progress = byId('guest-progress');
const positionLabel = byId('guest-position');
const durationLabel = byId('guest-duration');
const jukeboxLine = byId('guest-jukebox');
const preview = byId('guest-preview');
const adminLogin = byId('guest-admin-login');

let started = false;
let tickTimer = null;
// The server omits an unchanged queue from a snapshot, so the page keeps the last one it received.
let guestQueue = null;
// Only a guest session adds songs. The host previews this page under its admin session.
let canQueue = false;
let isPreview = false;
// The session read at load decides the admin login link on every later card.
let pageSession = null;
// Set once an end card shows, so a later 401 with no reason keeps the reason the stream sent.
let endShown = false;
// The last jukebox view, so a saved nickname re-renders the line before the next snapshot arrives.
let lastJukebox = null;

// The key leaves the address bar before any other work, so it never lands in history or a bookmark.
function takeKeyFromHash() {
  const key = keyFromHash(location.hash);
  if (location.hash !== '') history.replaceState(null, '', GUEST_PATH);
  return key;
}

function applySnapshot({ nowPlaying, queue, visualizer, theme, jukebox }) {
  applyTheme(theme);
  if (queue !== undefined) guestQueue = queue;
  const stored = storeSnapshot({ nowPlaying, queue: guestQueue });
  rebaseClock(stored.nowPlaying);
  renderNowPlaying(stored.nowPlaying);
  const index = playingIndex(stored.nowPlaying);
  renderGuestQueue(stored.queue, index, stored.nowPlaying?.paused);
  showGuestLyrics(index === null ? null : queueSongId(index), stored.nowPlaying?.isRadio === true);
  renderVisualizer({ visualizer }, stored.nowPlaying);
  if (jukebox) renderJukebox(jukebox);
}

function renderJukebox(jukebox) {
  lastJukebox = jukebox;
  rememberNickname(jukebox.nickname);
  const name = jukebox.nickname ? `${jukebox.nickname} (${jukebox.label})` : jukebox.label;
  jukeboxLine.textContent = `You are ${name}. ${jukeboxEndText(jukebox.expiresAt)}`;
  renderSlots(jukebox);
  maybeShowWelcome(jukebox, canQueue);
}

function tick() {
  const duration = durationSeconds();
  const position = positionSeconds();
  setProgressVar(progress, duration > 0 ? (position / duration) * 100 : 0);
  positionLabel.textContent = formatTime(position);
  durationLabel.textContent = formatTime(duration);
  tickGuestLyrics();
}

// Every card holds no stream, so the indicator leaves its first Connecting state. The error line is
// red, so the help and hint lines carry the neutral text.
function showJoinCard(card, title, { help = '', hint = '', error = '' } = {}) {
  stopConnection();
  setConnState('disconnected');
  closeWelcome();
  showGuestAdd(false);
  showChangeName(false);
  main.hidden = true;
  joinView.hidden = false;
  joinTitle.textContent = title;
  joinHelp.textContent = help;
  joinHint.textContent = hint;
  joinStatus.textContent = error;
  setHidden(joinHelp, help === '');
  setHidden(joinHint, hint === '');
  setHidden(adminLogin, !offersAdminLogin(card, pageSession));
}

function showEndCard(reason) {
  endShown = true;
  showJoinCard('join', ENDED_TITLE, guestEndCard(reason));
}

// The stream's ended event names the reason. A 401, a 403 refusal, or a closed stream with no session
// left carries none. An admin preview ends with the admin session, which says nothing about the code.
function showEnded(reason) {
  if (reason === undefined && endShown) return;
  if (tickTimer !== null) window.clearInterval(tickTimer);
  tickTimer = null;
  if (isPreview) {
    endShown = true;
    showJoinCard('join', PREVIEW_ENDED_TITLE);
    return;
  }
  // An empty stored reason keeps a reasonless end apart from no end, and reads back as the fallback text.
  prefWrite(ENDED_REASON_KEY, reason ?? '');
  showEndCard(reason);
}

function isJukeboxSession(session) {
  return session?.role === 'guest' || session?.role === 'admin';
}

async function readJukeboxSession() {
  const session = await getJson('/api/auth/session');
  return isJukeboxSession(session) ? session : null;
}

// Once the code ends, the server refuses an internet guest with 403 before any route runs. No answer
// or a 5xx, such as a proxy error while the player restarts, leaves the page disconnected instead.
// A 401 reaches showEnded through the login-required handler.
async function checkSessionEnded() {
  const { ok, status, data } = await getJsonResult('/api/auth/session');
  if (status === HTTP_FORBIDDEN || (ok && !isJukeboxSession(data))) showEnded();
}

// A live session follows a join that succeeded, so the stored end reason no longer applies.
function startGuestView(csrfToken, role) {
  prefRemove(ENDED_REASON_KEY);
  endShown = false;
  setCsrfToken(csrfToken ?? null);
  canQueue = role === 'guest';
  isPreview = role === 'admin';
  showGuestAdd(canQueue);
  showChangeName(canQueue);
  setHidden(preview, !isPreview);
  joinView.hidden = true;
  main.hidden = false;
  if (!started) {
    started = true;
    bindVisualizer();
    bindGuestAdd();
    bindGuestQueue();
    bindGuestLyrics();
  }
  tickTimer ??= window.setInterval(tick, TICK_MS);
  connect({
    url: '/api/guest/events',
    onOpen: () => {},
    onSnapshot: applySnapshot,
    onClosed: () => void checkSessionEnded(),
    onEnded: showEnded,
  });
}

// A guest kept through a rotation may open the old link again, so a refused key falls back to the
// guest session. An admin gets no fallback, so a host who tests a dead link sees it fail.
async function join(key) {
  const { ok, data } = await postJoin(key);
  if (ok) {
    startGuestView(data.csrfToken, data.role);
    return;
  }
  const session = await readJukeboxSession();
  if (session?.role === 'guest') {
    startGuestView(session.csrfToken, session.role);
    return;
  }
  showJoinCard('join', REJOIN_TITLE, { error: data?.error ?? NO_ANSWER });
}

async function bootstrap() {
  const key = takeKeyFromHash();
  // Before anything renders, so a forced theme replaces the system one.
  applyThemeHint();
  setLoginRequiredHandler(() => showEnded());
  // A new link opened in this tab changes only the fragment, so the page does not reload.
  window.addEventListener('hashchange', () => {
    const newKey = takeKeyFromHash();
    if (newKey !== null) void join(newKey);
  });
  bindWelcome();
  bindChangeName((nickname) => {
    if (lastJukebox !== null) renderJukebox({ ...lastJukebox, nickname });
  });

  const session = await getJson('/api/auth/session');
  pageSession = session;
  const view = guestView(session, key !== null);
  if (view === 'closed') {
    showJoinCard('closed', CLOSED_TITLE);
    return;
  }
  if (view === 'join-key') {
    await join(key);
    return;
  }
  if (view === 'guest' || view === 'preview') {
    startGuestView(session.csrfToken, session.role);
    return;
  }
  // A failed session read shows its own error, since a scan cannot help while the player is down.
  const endReason = session === null ? null : prefRead(ENDED_REASON_KEY);
  if (endReason !== null) {
    showEndCard(endReason);
    return;
  }
  showJoinCard('join', JOIN_TITLE, { help: JOIN_HELP, error: session === null ? NO_ANSWER : '' });
}

void bootstrap();
