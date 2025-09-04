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