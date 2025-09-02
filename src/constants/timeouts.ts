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