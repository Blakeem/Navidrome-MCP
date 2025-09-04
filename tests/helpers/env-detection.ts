/**
 * Environment Detection Utilities for Testing
 * 
 * Provides utilities to detect CI environments and skip live integration tests
 * when Navidrome server is not available, while maintaining full testing
 * in local development environments.
 */

import { logger } from '../../src/utils/logger.js';

/**
 * Check if we're running in a CI environment
 */
export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL ||
    process.env.BUILDKITE ||
    process.env.CIRCLECI
  );
}

/**
 * Check if Navidrome test configuration is available
 */
export function hasNavidromeConfig(): boolean {
  return !!(
    process.env.NAVIDROME_URL &&
    process.env.NAVIDROME_USERNAME &&
    process.env.NAVIDROME_PASSWORD
  );
}

/**
 * Determine if live integration tests should be skipped
 * 
 * Skip when:
 * - Running in CI without Navidrome config
 * - SKIP_INTEGRATION_TESTS is explicitly set
 * - MOCK_ONLY_TESTS is enabled
 */
export function shouldSkipLiveTests(): boolean {
  // Explicit skip flags
  if (process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.MOCK_ONLY_TESTS === 'true') {
    return true;
  }

  // Skip in CI without proper config
  if (isCI() && !hasNavidromeConfig()) {
    return true;
  }

  return false;
}

/**
 * Get a descriptive reason why live tests are being skipped
 */
export function getSkipReason(): string {
  if (process.env.SKIP_INTEGRATION_TESTS === 'true') {
    return 'SKIP_INTEGRATION_TESTS environment variable is set';
  }
  
  if (process.env.MOCK_ONLY_TESTS === 'true') {
    return 'MOCK_ONLY_TESTS environment variable is set';
  }

  if (isCI() && !hasNavidromeConfig()) {
    return 'Running in CI environment without Navidrome server configuration';
  }

  return 'Unknown reason';
}

/**
 * Log test environment information
 */
export function logTestEnvironment(): void {
  const skipLive = shouldSkipLiveTests();
  
  logger.info('Test Environment Configuration:');
  logger.info(`- CI Environment: ${isCI()}`);
  logger.info(`- Has Navidrome Config: ${hasNavidromeConfig()}`);
  logger.info(`- Skip Live Tests: ${skipLive}`);
  
  if (skipLive) {
    logger.info(`- Skip Reason: ${getSkipReason()}`);
  }
}

/**
 * Create a conditional describe block that skips when live tests should be skipped
 */
export function describeLive(name: string, fn: () => void): void {
  if (shouldSkipLiveTests()) {
    describe.skip(`${name} (skipped: ${getSkipReason()})`, fn);
  } else {
    describe(name, fn);
  }
}

/**
 * Create a conditional test that skips when live tests should be skipped
 */
export function itLive(name: string, fn: () => void | Promise<void>): void {
  if (shouldSkipLiveTests()) {
    it.skip(`${name} (skipped: ${getSkipReason()})`, fn);
  } else {
    it(name, fn);
  }
}

/**
 * Enhanced client getter that provides clear error messaging
 */
export async function getSharedLiveClientSafe(): Promise<any> {
  if (shouldSkipLiveTests()) {
    throw new Error(`Live client not available: ${getSkipReason()}`);
  }

  try {
    const { getSharedLiveClient } = await import('../factories/shared-client.js');
    return await getSharedLiveClient();
  } catch (error) {
    logger.error('Failed to create live client:', error);
    
    // If we're not in CI, this might be a real issue we should know about
    if (!isCI()) {
      throw error;
    }
    
    // In CI, provide helpful guidance
    throw new Error(
      `Failed to initialize Navidrome client in CI environment. ` +
      `This usually means the test server is not available. ` +
      `Consider setting SKIP_INTEGRATION_TESTS=true for CI builds. ` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}