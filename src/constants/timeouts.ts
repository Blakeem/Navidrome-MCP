/**
 * Navidrome MCP Server - Timeouts
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// A user asked for this one stream, so the probe can afford to be thorough.
export const SINGLE_VALIDATION_TIMEOUT_MS = 8000;

// Batch probes stay short so many slow streams do not stack up wait time.
export const BATCH_VALIDATION_TIMEOUT_MS = 3000;

// 3000ms leaves the HEAD probe 1800ms, enough for a slow TLS handshake on a non-standard port.
// Same-host stations probe in series, so discovery can take RADIO_DISCOVERY_PROBE_COUNT x this.
export const DISCOVERY_VALIDATION_TIMEOUT_MS = 3000;

export const MAX_VALIDATION_TIMEOUT_MS = 30000;

export const MIN_VALIDATION_TIMEOUT_MS = 1000;

export const RADIO_VALIDATION = {
  // 60% of the timeout goes to HEAD so the GET sample keeps a budget.
  HEAD_TIMEOUT_RATIO: 0.6,

  SAMPLE_BUFFER_SIZE: 8192,
} as const;

// Per-command timeouts keep a stalled mpv from wedging the server.

/** Property reads and writes, seek and stop are in-memory work for mpv, so a reply slower than 2s
 *  means mpv is wedged. */
export const MPV_COMMAND_TIMEOUT_QUICK_MS = 2000;

/** loadfile and loadlist open a remote stream, and Navidrome may be cold-starting a transcode. */
export const MPV_COMMAND_TIMEOUT_LOAD_MS = 5000;

/** mpv binds the IPC socket a moment after spawn. Fast-failing attempts give 50 x 100ms = 5s, and
 *  hung attempts can each add MPV_IPC_CONNECT_TIMEOUT_MS, for a worst case near 55s. */
export const MPV_IPC_CONNECT_RETRIES = 50;
export const MPV_IPC_CONNECT_DELAY_MS = 100;

/** An existing mpv answers fast, so attach skips the post-spawn budget. */
export const MPV_ATTACH_CONNECT_RETRIES = 3;
export const MPV_ATTACH_CONNECT_DELAY_MS = 50;

/** A local IPC connect settles in single-digit ms, so a slower attempt counts as hung. */
export const MPV_IPC_CONNECT_TIMEOUT_MS = 1000;

/** The bound on the one-shot quit connection keeps shutdown from waiting on a wedged mpv. */
export const MPV_QUIT_SOCKET_TIMEOUT_MS = 1000;

export const MPV_STALE_SOCKET_PROBE_MS = 100;

/** An mpv the MCP process spawned plays untracked by the web owner for at most this long. */
export const WEB_OWNER_ATTACH_INTERVAL_MS = 5000;

/** An echo is a local IPC round trip of milliseconds, so only a wedged or gone mpv hits this. */
export const SCROBBLE_CLAIM_ECHO_TIMEOUT_MS = 5000;

/** The headless mpv filter check took 313 ms when measured. */
export const MPV_VISUALIZER_VALIDATE_TIMEOUT_MS = 10_000;

/** A check that timed out or failed to start says nothing about the filter, so its result is
 *  dropped after this delay and the next request reruns it. */
export const MPV_VISUALIZER_VALIDATE_RETRY_MS = 60_000;

/** A fresh mpv waits this long for the filter check before its first track. A slower check leaves
 *  that track without the filter but does not delay the play. */
export const MPV_VISUALIZER_SPAWN_WAIT_MS = 1000;

export const VISUALIZER_FEED_RETRY_MS = 3000;

export const VISUALIZER_FEED_GRACE_MS = 5000;

/** Reverse proxies close an idle stream, nginx after 60 s, so a quiet SSE stream sends a comment
 *  this often. The interval also bounds how long a dead client lingers. */
export const SSE_HEARTBEAT_MS = 10_000;

export const MPV_LOAD_COMMANDS: ReadonlySet<string> = new Set([
  'loadfile',
  'loadlist',
]);

// Each fetch timeout, one retry included, stays under the MCP SDK's 60s request timeout, so a hung
// upstream gives the agent a per-call error instead of a generic RequestTimeout.

/** 15s covers cold-cache listing endpoints on a healthy server. Most respond in under 1s. */
export const DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS = 15_000;

/** Login is one round trip (DB lookup, bcrypt, JWT mint), so this sits below the request timeout
 *  and a wedged login fails fast. */
export const DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS = 10_000;

export const DEFAULT_EXTERNAL_API_TIMEOUT_MS = 15_000;

/** The cap on an env override keeps timeout plus retry, 25s x 2 = 50s, under the MCP SDK's 60s
 *  `DEFAULT_REQUEST_TIMEOUT_MSEC`. */
export const MAX_FETCH_TIMEOUT_MS = 25_000;

/** A sub-second env override would fail a healthy but slow connection. */
export const MIN_FETCH_TIMEOUT_MS = 1_000;

/** A longer `Retry-After` wait on a login 429 would push a tool call past the SDK's 60s limit. */
export const MAX_AUTH_RATE_LIMIT_WAIT_MS = 25_000;

/** Navidrome's default login window, the wait when a 429 has no usable `Retry-After`. */
export const NAVIDROME_LOGIN_RATE_LIMIT_WINDOW_MS = 20_000;
