// Production serves the copy that pnpm build places in dist/webui/public and reads it on every
// request, so an edit to this folder needs a build and a page reload.

import { getJson, getJsonResult, postJoin, setCsrfToken, setLoginRequiredHandler } from './api.js';
import { connect, setConnState, stopConnection } from './connection.js';
import { byId, setHidden, setProgressVar } from './dom.js';
import { bindGuestAdd, keepAddSongsInPlace, renderAddState, renderSlots, showGuestAdd } from './guest-add.js';
import { bindGuestLyrics, showGuestLyrics, tickGuestLyrics } from './guest-lyrics.js';
import { bindGuestQueue, renderGuestQueue } from './guest-queue.js';
import { bindChangeName, rememberNickname, showChangeName } from './guest-name.js';
import { bindWelcome, closeWelcome, maybeShowWelcome, jukeboxEndText } from './guest-welcome.js';
import { renderNowPlaying } from './now-playing.js';
import { guestEndCard, guestView, hostPollView, keyFromHash } from './page-view.js';
import { durationSeconds, positionSeconds, rebaseClock } from './playback-clock.js';
import { prefRead, prefRemove, prefWrite } from './prefs.js';
import { playingIndex, queueSongId, storeSnapshot } from './snapshot.js';
import { applyTheme, applyThemeHint } from './theme.js';
import { formatTime } from './time-format.js';
import { bindVisualizer, renderVisualizer, stopVisualizer } from './visualizer.js';

const GUEST_PATH = '/guest';
const TICK_MS = 250;
const HTTP_FORBIDDEN = 403;
const CLOSED_TITLE = 'The jukebox is closed.';
const HOST_CLOSED_HELP = 'Open it from the player.';
const JOIN_TITLE = 'Join the jukebox';
const JOIN_HELP = 'Scan the QR code from the host.';
const REJOIN_TITLE = 'Scan the jukebox QR code again';
// A guest session can end while the jukebox stays open, such as on its idle expiry, so the title names only the session.
const ENDED_TITLE = 'Your jukebox session ended';
const HOST_ENDED_TITLE = 'Your admin session ended';
const HOST_LOGIN_LINK = 'Log in again';
const HOST_PLAYER_LINK = 'Open the player';
// The closed card holds no events stream, so the host page reads the session again until the jukebox opens.
const HOST_OPEN_POLL_MS = 5000;
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
const hostBanner = byId('guest-host-banner');
const hostLink = byId('guest-host-link');
const hostLinkAnchor = hostLink.querySelector('a');

let started = false;
let tickTimer = null;
let hostOpenTimer = null;
// The server omits an unchanged queue from a snapshot, so the page keeps the last one it received.
let guestQueue = null;
// An admin session uses this page as the host, under the same rules as a guest.
let isHost = false;
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
  const index = playingIndex(stored.nowPlaying);
  rebaseClock(stored.nowPlaying);
  keepAddSongsInPlace(() => {
    renderNowPlaying(stored.nowPlaying);
    renderGuestQueue(stored.queue, index, stored.nowPlaying?.paused);
    showGuestLyrics(index === null ? null : queueSongId(index), stored.nowPlaying?.isRadio === true);
    renderVisualizer({ visualizer }, stored.nowPlaying);
    if (jukebox) renderJukebox(jukebox);
  });
  renderAddState(stored.queue?.items ?? []);
}

function renderJukebox(jukebox) {
  lastJukebox = jukebox;
  rememberNickname(jukebox.nickname);
  const name = jukebox.nickname ? `${jukebox.nickname} (${jukebox.label})` : jukebox.label;
  // The host keeps its admin session past the code, so only a guest reads when it is signed out.
  jukeboxLine.textContent = isHost ? `You are ${name}.` : `You are ${name}. ${jukeboxEndText(jukebox.expiresAt)}`;
  renderSlots(jukebox);
  maybeShowWelcome(jukebox, isHost);
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
// red, so the help and hint lines carry the neutral text. `adminLink` is the text of the link to the player.
function showJoinCard(title, { help = '', hint = '', error = '', adminLink = '' } = {}) {
  stopHostOpenPoll();
  stopConnection();
  stopVisualizer();
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
  hostLinkAnchor.textContent = adminLink;
  // Only a host page shows the link, so a removed or banned guest never sees an admin link.
  setHidden(hostLink, !isHost || adminLink === '');
}

function showHostClosedCard() {
  showJoinCard(CLOSED_TITLE, { help: HOST_CLOSED_HELP, adminLink: HOST_PLAYER_LINK });
  hostOpenTimer = window.setInterval(() => void startWhenJukeboxOpens(), HOST_OPEN_POLL_MS);
}

function stopHostOpenPoll() {
  if (hostOpenTimer !== null) window.clearInterval(hostOpenTimer);
  hostOpenTimer = null;
}

// A read that resolves after another card replaced the closed card finds the poll stopped and changes nothing.
async function startWhenJukeboxOpens() {
  const { ok, data } = await getJsonResult('/api/auth/session');
  if (hostOpenTimer === null) return;
  const view = hostPollView(ok ? data : null);
  if (view === 'host') startGuestView(data.csrfToken, data.role);
  else if (view === 'closed') showJoinCard(CLOSED_TITLE);
  else if (view === 'ended') showJoinCard(HOST_ENDED_TITLE, { adminLink: HOST_LOGIN_LINK });
}

function showEndCard(reason) {
  endShown = true;
  showJoinCard(ENDED_TITLE, guestEndCard(reason));
}

// The stream's ended event names the reason. A 401, a 403 refusal, or a closed stream with no session
// left carries none.
function showEnded(reason) {
  if (reason === undefined && endShown) return;
  if (tickTimer !== null) window.clearInterval(tickTimer);
  tickTimer = null;
  if (isHost) {
    endShown = true;
    void showHostEnded(reason);
    return;
  }
  // An empty stored reason keeps a reasonless end apart from no end, and reads back as the fallback text.
  prefWrite(ENDED_REASON_KEY, reason ?? '');
  showEndCard(reason);
}

// The host keeps its admin session when the jukebox closes, so an end reason or a live admin session
// means the jukebox closed, and anything else means the admin session ended.
async function showHostEnded(reason) {
  const jukeboxClosed = reason !== undefined || (await readJukeboxSession())?.role === 'admin';
  if (jukeboxClosed) showHostClosedCard();
  else showJoinCard(HOST_ENDED_TITLE, { adminLink: HOST_LOGIN_LINK });
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
  stopHostOpenPoll();
  prefRemove(ENDED_REASON_KEY);
  endShown = false;
  setCsrfToken(csrfToken ?? null);
  isHost = role === 'admin';
  showGuestAdd(true);
  showChangeName(true);
  setHidden(hostBanner, !isHost);
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
  showJoinCard(REJOIN_TITLE, { error: data?.error ?? NO_ANSWER });
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
  const view = guestView(session, key !== null);
  if (view === 'closed') {
    showJoinCard(CLOSED_TITLE);
    return;
  }
  if (view === 'join-key') {
    await join(key);
    return;
  }
  if (view === 'host-closed') {
    isHost = true;
    showHostClosedCard();
    return;
  }
  if (view === 'guest' || view === 'host') {
    startGuestView(session.csrfToken, session.role);
    return;
  }
  // A failed session read shows its own error, since a scan cannot help while the player is down.
  const endReason = session === null ? null : prefRead(ENDED_REASON_KEY);
  if (endReason !== null) {
    showEndCard(endReason);
    return;
  }
  showJoinCard(JOIN_TITLE, { help: JOIN_HELP, error: session === null ? NO_ANSWER : '' });
}

void bootstrap();
