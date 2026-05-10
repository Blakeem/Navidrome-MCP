/**
 * Environment Detection Utilities for Testing
 * 
 * Provides utilities to detect CI environments and skip live integration tests
 * when Navidrome server is not available, while maintaining full testing
 * in local development environments.
 */

/**
 * Check if we're running in a CI environment
 */
function isCI(): boolean {
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
function hasNavidromeConfig(): boolean {
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
 * Create a conditional describe block that skips when live tests should be skipped
 */
export function describeLive(name: string, fn: () => void): void {
  if (shouldSkipLiveTests()) {
    describe.skip(`${name} (skipped: ${getSkipReason()})`, fn);
  } else {
    describe(name, fn);
  }
}
