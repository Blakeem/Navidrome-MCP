/** Timeouts for radio stream validation, mpv IPC, and outbound fetches. */

// A user asked for this one stream, so the probe can afford to be thorough.
export const SINGLE_VALIDATION_TIMEOUT_MS = 8000;

// Batch probes stay short so many slow streams do not stack up wait time.
export const BATCH_VALIDATION_TIMEOUT_MS = 3000;

// 3000ms leaves the HEAD probe 1800ms, enough for a slow TLS handshake on a non-standard port. Same-host
// stations probe one at a time, so worst-case discovery validation is RADIO_DISCOVERY_PROBE_COUNT x this value.
export const DISCOVERY_VALIDATION_TIMEOUT_MS = 3000;

export const MAX_VALIDATION_TIMEOUT_MS = 30000;

export const MIN_VALIDATION_TIMEOUT_MS = 1000;

export const RADIO_VALIDATION = {
  // 60% of the timeout goes to HEAD so the GET sample keeps a budget.
  HEAD_TIMEOUT_RATIO: 0.6,

  SAMPLE_BUFFER_SIZE: 8192,
} as const;

// Per-command timeouts keep a stalled mpv from wedging the server. The stale-socket probe keeps
// cleanup from unlinking a socket a live mpv still holds.

/** Per-command timeout for short mpv IPC operations (property reads/writes,
 *  observe, stop, seek, get_version, etc.). Short because these are pure
 *  in-memory operations on mpv's side. If they don't return in 2s, mpv is
 *  almost certainly wedged. */
export const MPV_COMMAND_TIMEOUT_QUICK_MS = 2000;

/** Per-command timeout for mpv loadfile/loadlist operations, which involve
 *  opening a remote stream. Navidrome may be cold-starting transcoding, so
 *  this needs more headroom than the QUICK tier. */
export const MPV_COMMAND_TIMEOUT_LOAD_MS = 5000;

/** Initial-connect retry budget when opening the IPC socket post-spawn while
 *  mpv is binding the socket. Fast-failing attempts give 50 x 100ms = 5s.
 *  Hung attempts can each take MPV_IPC_CONNECT_TIMEOUT_MS, for a worst case
 *  near 55s. */
export const MPV_IPC_CONNECT_RETRIES = 50;
export const MPV_IPC_CONNECT_DELAY_MS = 100;

/** Attach retry budget. An existing mpv answers fast, so attach skips the
 *  post-spawn budget. */
export const MPV_ATTACH_CONNECT_RETRIES = 3;
export const MPV_ATTACH_CONNECT_DELAY_MS = 50;

/** A local IPC connect settles in single-digit ms. A hung attempt would otherwise stall
 *  connect()'s retry loop indefinitely, so it is torn down and rejected. */
export const MPV_IPC_CONNECT_TIMEOUT_MS = 1000;

/** Bounds the one-shot quit connection, so shutdown never waits on a wedged mpv. */
export const MPV_QUIT_SOCKET_TIMEOUT_MS = 1000;

/** Probe timeout used by cleanupStaleSocket to decide whether a socket file
 *  is bound to a live mpv before unlinking. */
export const MPV_STALE_SOCKET_PROBE_MS = 100;

/** How often an unattached web owner retries attaching to mpv. Bounds how long
 *  an mpv the MCP process spawned goes without the owner tracking its plays. */
export const WEB_OWNER_ATTACH_INTERVAL_MS = 5000;

/** How long a scrobble claim waits for mpv to echo it back before the tracker submits anyway.
 *  A local IPC round trip takes milliseconds, so only a wedged or gone mpv reaches it. */
export const SCROBBLE_CLAIM_ECHO_TIMEOUT_MS = 5000;

export const MPV_LOAD_COMMANDS: ReadonlySet<string> = new Set([
  'loadfile',
  'loadlist',
]);

// Every fetch timeout, one retry included, stays under the MCP SDK's 60s request timeout. A hung Navidrome,
// Last.fm, MusicBrainz, LRCLIB or Radio Browser then gives the agent a per-call error, not a generic RequestTimeout.

/** Default per-request timeout for Navidrome REST + Subsonic fetches.
 *  15s comfortably covers cold-cache listing endpoints on a healthy server.
 *  Most respond in <1s. */
export const DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS = 15_000;

/** Default per-request timeout for the `/auth/login` POST. Auth is a single
 *  round-trip (DB lookup + bcrypt + JWT mint) and should be fast on a healthy
 *  server. Tighter than the request timeout so a wedged auth fails quickly. */
export const DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS = 10_000;

/** Default per-request timeout for external APIs (Last.fm, MusicBrainz, LRCLIB,
 *  Radio Browser). It equals the Navidrome request default. */
export const DEFAULT_EXTERNAL_API_TIMEOUT_MS = 15_000;

/** Hard upper bound for any fetch timeout. It protects against env-var
 *  misconfiguration that would push wall-clock (timeout + retry) past the
 *  MCP SDK's 60s `DEFAULT_REQUEST_TIMEOUT_MSEC`. 25s × 2 = 50s, leaving 10s
 *  of headroom. */
export const MAX_FETCH_TIMEOUT_MS = 25_000;

/** Hard lower bound. It prevents accidental sub-second timeouts that would
 *  fail-fast on a perfectly healthy but slow connection. */
export const MIN_FETCH_TIMEOUT_MS = 1_000;

/** Longest `Retry-After` wait honored on a 429 from `/auth/login`. Navidrome's
 *  default login window is 20s, and a longer wait would push a tool call past the SDK's 60s limit. */
export const MAX_AUTH_RATE_LIMIT_WAIT_MS = 25_000;

/** Navidrome's default login rate-limit window, the wait when a 429 sends no usable `Retry-After`. */
export const NAVIDROME_LOGIN_RATE_LIMIT_WINDOW_MS = 20_000;
