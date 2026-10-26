// Free of the DOM, so the router test runs the same choices each page makes from the session body and the address.

const JUKEBOX_MODE = 'jukebox';
const KEY_PARAM = 'k';
const GUEST_END_TEXTS = {
  closed: 'The host closed the jukebox.',
  expired: 'The jukebox code expired.',
  idle: 'Your jukebox session expired. Scan the code again to rejoin.',
  'new-code': 'The host made a new jukebox code. Scan the new code to rejoin.',
  removed: 'The host removed you from the jukebox.',
};
// Only an ended jukebox needs a new code. The idle and new-code texts say how to rejoin, and a removed
// guest's code still works unless the host banned the browser, which a new code does not lift.
const NEW_CODE_END_REASONS = new Set(['closed', 'expired']);
const NEW_CODE_HINT = 'Scan a new code from the host to join again.';
const UNKNOWN_END_HELP = "Scan the host's jukebox code to join again.";

// Modes `password` and `jukebox` ask for the admin login. Only `jukebox` has guests.
export function isLoginMode(session) {
  return session?.mode === 'password' || session?.mode === JUKEBOX_MODE;
}

// An unread session leaves the login form, so a failed read never hides the way back in.
export function loginCard(session) {
  if (session === null || session.adminLoginAvailable === true) return 'login';
  return session.outsideLevelMessage === undefined ? 'unavailable' : 'outside-level';
}

// The root sends a jukebox visitor without an admin session to the guest page, so every join card,
// a failed or ended join included, links a host to the login. The closed card has no join.
export function offersAdminLogin(card, session) {
  return card === 'join' && session?.adminLoginAvailable === true;
}

export function adminView(session) {
  if (!isLoginMode(session) || session.role === 'admin') return 'player';
  return loginCard(session);
}

// An empty k= still counts as a join attempt, so a truncated link shows the server's refusal.
export function keyFromHash(hash) {
  return hash.includes(`${KEY_PARAM}=`) ? new URLSearchParams(hash.slice(1)).get(KEY_PARAM) : null;
}

// Outside mode jukebox the join route answers 404, so a key in the address cannot help.
export function guestView(session, hasKey) {
  if (session !== null && session.mode !== JUKEBOX_MODE) return 'closed';
  if (hasKey) return 'join-key';
  if (session?.role === 'guest') return 'guest';
  if (session?.role === 'admin') return 'preview';
  return 'join';
}

// A 401 or a refused session read carries no reason, and any end can reach the page that way, so the text names none.
export function guestEndCard(reason) {
  if (!Object.hasOwn(GUEST_END_TEXTS, reason)) return { help: UNKNOWN_END_HELP, hint: '' };
  return { help: GUEST_END_TEXTS[reason], hint: NEW_CODE_END_REASONS.has(reason) ? NEW_CODE_HINT : '' };
}
