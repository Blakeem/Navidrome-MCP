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
 * Timeout for discovery validation operations
 * Used when auto-validating discovered radio stations
 * Lower timeout for quick feedback when validating many discovered stations
 */
export const DISCOVERY_VALIDATION_TIMEOUT = 2000; // 2 seconds

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
   * Minimum timeout for audio sampling phase
   * Ensures sufficient time to detect audio content even with slow connections
   */
  MIN_SAMPLE_TIMEOUT: 2000, // 2 seconds
  
  /**
   * Buffer size for audio content sampling
   * 8KB provides good balance between detection accuracy and efficiency
   */
  SAMPLE_BUFFER_SIZE: 8192, // 8KB
  
  /**
   * Timeout for reading stream content during validation
   * Prevents hanging on non-responsive streams during content analysis
   */
  STREAM_READ_TIMEOUT: 3000, // 3 seconds
  
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