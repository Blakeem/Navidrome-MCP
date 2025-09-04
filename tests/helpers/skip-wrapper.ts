/**
 * Test Skip Wrapper Utilities
 * 
 * Provides easy-to-use wrappers for conditionally skipping tests
 * based on environment conditions.
 */

import { shouldSkipLiveTests } from './env-detection.js';

/**
 * Conditionally skip entire test suites that require live integration
 */
export const describeLiveOnly = shouldSkipLiveTests() 
  ? describe.skip 
  : describe;

/**
 * Conditionally skip individual tests that require live integration
 */
export const itLiveOnly = shouldSkipLiveTests() 
  ? it.skip 
  : it;

/**
 * Wrapper for beforeAll hooks in live-dependent test suites
 * Returns early if live tests should be skipped
 */
export function beforeAllLive(fn: () => Promise<void> | void) {
  return beforeAll(async () => {
    if (shouldSkipLiveTests()) {
      return; // Skip setup if live tests are disabled
    }
    await fn();
  });
}

/**
 * Mock-only describe - only runs when live tests are skipped
 */
export const describeMockOnly = shouldSkipLiveTests() 
  ? describe 
  : describe.skip;

/**
 * Mock-only it - only runs when live tests are skipped  
 */
export const itMockOnly = shouldSkipLiveTests() 
  ? it 
  : it.skip;