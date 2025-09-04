#!/usr/bin/env node

/**
 * CI Test Environment Setup
 * 
 * Sets appropriate environment variables for running tests in CI environments
 * where Navidrome server is not available.
 */

console.log('Setting CI test environment variables...');

// Skip all live integration tests in CI
process.env.SKIP_INTEGRATION_TESTS = 'true';
process.env.MOCK_ONLY_TESTS = 'true';

// Provide dummy values to satisfy config validation while tests are skipped
process.env.NAVIDROME_URL = 'http://ci-dummy-server:4533';
process.env.NAVIDROME_USERNAME = 'ci-dummy-user';
process.env.NAVIDROME_PASSWORD = 'ci-dummy-password';

// Disable debug logging in CI
process.env.DEBUG = 'false';

console.log('CI environment configured:');
console.log('- SKIP_INTEGRATION_TESTS=true');
console.log('- MOCK_ONLY_TESTS=true');
console.log('- Dummy Navidrome config provided');
console.log('- Debug logging disabled');

// Export for other scripts to use
module.exports = {
  SKIP_INTEGRATION_TESTS: 'true',
  MOCK_ONLY_TESTS: 'true',
  NAVIDROME_URL: 'http://ci-dummy-server:4533',
  NAVIDROME_USERNAME: 'ci-dummy-user',
  NAVIDROME_PASSWORD: 'ci-dummy-password',
  DEBUG: 'false'
};