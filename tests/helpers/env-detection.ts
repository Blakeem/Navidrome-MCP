import { readSettings } from '../../src/config/store.js';
import { resolveMpvBinary } from '../../src/services/playback/mpv-process.js';

/** CI hosts may lack a Navidrome server, so live tests skip in CI without stored credentials. */

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

/** Runtime config comes from the seeded settings store, so the gate reads the same source. */
function hasNavidromeConfig(): boolean {
  const navidrome = readSettings()?.navidrome;
  return [navidrome?.url, navidrome?.username, navidrome?.password].every((value) => (value ?? '') !== '');
}

/** Mirrors the runtime mpv resolution, so an explicit playback.mpvPath enables the playback suites. */
export function isMpvAvailable(): boolean {
  return resolveMpvBinary(readSettings()?.playback?.mpvPath) !== null;
}

export function shouldSkipLiveTests(): boolean {
  if (process.env.SKIP_INTEGRATION_TESTS === 'true' || process.env.MOCK_ONLY_TESTS === 'true') {
    return true;
  }

  if (isCI() && !hasNavidromeConfig()) {
    return true;
  }

  return false;
}

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

export function describeLive(name: string, fn: () => void): void {
  if (shouldSkipLiveTests()) {
    describe.skip(`${name} (skipped: ${getSkipReason()})`, fn);
  } else {
    describe(name, fn);
  }
}
