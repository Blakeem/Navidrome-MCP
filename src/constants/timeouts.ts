/**
 * Timeout constants for radio stream validation operations
 * 
 * Different timeout values based on operation context to balance
 * thoroughness with performance and user experience.
 */

/**
 * Timeout for single, explicit validation operations
 * Used when user specifically requests validation of a stream
 * Higher timeout allows for more thorough testing
 */
export const SINGLE_VALIDATION_TIMEOUT = 8000; // 8 seconds

/**
 * Timeout for batch validation operations
 * Used when validating multiple streams in batch operations
 * Balanced timeout to avoid excessive wait times for multiple validations
 */
export const BATCH_VALIDATION_TIMEOUT = 3000; // 3 seconds

/**
 * Timeout for discovery validation operations.
 * Used when auto-validating discovered radio stations.
 *
 * Discovery validates the first N stations IN PARALLEL (see
 * validateDiscoveredStations), so wall-clock is bounded by the single slowest
 * probe, not the sum. The old 2000ms left only 1200ms for the HEAD probe
 * (HEAD_TIMEOUT_RATIO 0.6), which a slow HTTPS/TLS handshake on a non-standard
 * port (e.g. icecast on :8443) blows past, aborting the HEAD before its ICY
 * headers arrive and false-negativing real streams (Issue #7). 3000ms gives the
 * HEAD an 1800ms budget — comfortable headroom for slow TLS handshakes (observed
 * ~800-1100ms standalone) — while capping discovery latency at 3s.
 *
 * NOTE: this does NOT cure every discovery false-negative. Some hosts serve
 * multiple popular streams from one icecast host:port (e.g. walmradio's
 * classic/jazz/jazz_opus all on :8443) and throttle concurrent connections from
 * the same IP, so a parallel batch can still stall a few same-host probes to the
 * timeout. Those streams validate fine one-at-a-time via `validate_radio_stream`
 * — discovery's auto-validation is a best-effort quick sample, not authoritative.
 */
export const DISCOVERY_VALIDATION_TIMEOUT = 3000; // 3 seconds

/**
 * Maximum allowed timeout for any validation operation
 * Hard limit to prevent excessively long waits
 */
export const MAX_VALIDATION_TIMEOUT = 30000; // 30 seconds

/**
 * Minimum allowed timeout for any validation operation
 * Ensures sufficient time for network operations
 */
export const MIN_VALIDATION_TIMEOUT = 1000; // 1 second

/**
 * Radio stream validation timing and buffer constants
 * Used internally by the validation process for optimal performance
 */
export const RADIO_VALIDATION = {
  /**
   * Ratio of total timeout to allocate for HEAD request
   * 60% of total timeout allows time for subsequent audio sampling
   */
  HEAD_TIMEOUT_RATIO: 0.6,
  
  /**
   * Maximum timeout for the audio sampling phase
   * Caps how long a generous overall budget will linger sampling audio content
   */
  MAX_SAMPLE_TIMEOUT: 2000, // 2 seconds
  
  /**
   * Buffer size for audio content sampling
   * 8KB provides good balance between detection accuracy and efficiency
   */
  SAMPLE_BUFFER_SIZE: 8192, // 8KB

  /**
   * Fallback HEAD timeout when calculated value would be too high
   * Prevents excessive wait times for HEAD requests
   */
  FALLBACK_HEAD_TIMEOUT: 4000, // 4 seconds
} as const;

/**
 * mpv IPC timing constants.
 *
 * The playback subsystem talks to mpv via JSON-IPC over a Unix socket /
 * Windows named pipe. Production-ready behavior requires per-command timeouts
 * (so a stalled mpv can't wedge the MCP server) and a probe-first stale-socket
 * cleanup (so we don't unlink a socket a live mpv is still bound to).
 */

/** Per-command timeout for short mpv IPC operations (property reads/writes,
 *  observe, stop, seek, get_version, etc.). Short because these are pure
 *  in-memory operations on mpv's side; if they don't return in 2s, mpv is
 *  almost certainly wedged. */
export const MPV_COMMAND_TIMEOUT_QUICK_MS = 2000;

/** Per-command timeout for mpv loadfile/loadlist operations, which involve
 *  opening a remote stream — Navidrome may be cold-starting transcoding, so
 *  this needs more headroom than the QUICK tier. */
export const MPV_COMMAND_TIMEOUT_LOAD_MS = 5000;

/** Initial-connect retry budget when opening the IPC socket post-spawn while
 *  mpv is binding the socket. 50 × 100ms = 5s total budget. */
export const MPV_IPC_CONNECT_RETRIES = 50;
export const MPV_IPC_CONNECT_DELAY_MS = 100;

/** Probe timeout used by cleanupStaleSocket to decide whether a socket file
 *  is bound to a live mpv before unlinking. */
export const MPV_STALE_SOCKET_PROBE_MS = 100;

/** Set of mpv command names that should use the LOAD tier timeout. */
export const MPV_LOAD_COMMANDS: ReadonlySet<string> = new Set([
  'loadfile',
  'loadlist',
  'playlist-load',
]);

/**
 * Outbound HTTP fetch timing constants.
 *
 * Without these, a hung Navidrome (or unreachable Last.fm / LRCLIB / Radio
 * Browser) wedges every MCP tool call until the MCP SDK's own
 * `DEFAULT_REQUEST_TIMEOUT_MSEC` (60s) fires. The SDK then surfaces a
 * generic `RequestTimeout` MCP error with no per-tool context.
 *
 * Our timeouts MUST be strictly less than 60_000ms even after one retry, so
 * that we surface a clear "Navidrome did not respond" error to the LLM
 * before the SDK gives up. Ceiling: 30s wall-clock = (15s timeout + 15s
 * retry) — leaves ~30s of slack for the SDK envelope and any in-process
 * post-processing.
 *
 * Configurable via `NAVIDROME_REQUEST_TIMEOUT_MS`,
 * `NAVIDROME_AUTH_TIMEOUT_MS`, and `EXTERNAL_API_TIMEOUT_MS` env vars.
 * The hard `MAX_FETCH_TIMEOUT_MS` cap prevents misconfiguration from
 * pushing us past the SDK's 60s envelope.
 */

/** Default per-request timeout for Navidrome REST + Subsonic fetches.
 *  15s comfortably covers cold-cache listing endpoints on a healthy server;
 *  most respond in <1s. With single retry → 30s wall-clock max. */
export const DEFAULT_NAVIDROME_REQUEST_TIMEOUT_MS = 15_000;

/** Default per-request timeout for the `/auth/login` POST. Auth is a single
 *  round-trip (DB lookup + bcrypt + JWT mint) and should be fast on a healthy
 *  server. Tighter than the request timeout so a wedged auth fails quickly. */
export const DEFAULT_NAVIDROME_AUTH_TIMEOUT_MS = 10_000;

/** Default per-request timeout for external APIs (Last.fm, LRCLIB,
 *  Radio Browser). Slightly more generous than Navidrome because these are
 *  third-party services with variable latency, but still well under the SDK
 *  60s envelope after retry. */
export const DEFAULT_EXTERNAL_API_TIMEOUT_MS = 15_000;

/** Hard upper bound for any fetch timeout — protects against env-var
 *  misconfiguration that would push wall-clock (timeout + retry) past the
 *  MCP SDK's 60s `DEFAULT_REQUEST_TIMEOUT_MSEC`. 25s × 2 = 50s, leaving 10s
 *  of headroom. */
export const MAX_FETCH_TIMEOUT_MS = 25_000;

/** Hard lower bound — prevents accidental sub-second timeouts that would
 *  fail-fast on a perfectly healthy but slow connection. */
export const MIN_FETCH_TIMEOUT_MS = 1_000;