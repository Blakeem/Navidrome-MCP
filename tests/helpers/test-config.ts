/**
 * Deterministic config factory for unit tests.
 *
 * Tests that only need a `Config` object with specific feature flags (e.g. the
 * tool-registry coverage test) should build it directly rather than going
 * through `loadConfig()` / the settings store, so they stay independent of the
 * developer's real configuration and of mpv being installed on the host.
 */

import type { Config } from '../../src/config.js';
import { DEFAULT_MCP_HTTP_PORT } from '../../src/constants/defaults.js';

type FeatureOverrides = Partial<Config['features']>;
type ConfigOverrides = Partial<Omit<Config, 'features'>> & { features?: FeatureOverrides };

const BASE: Config = {
  navidromeUrl: 'http://deterministic-test:4533',
  navidromeUsername: 'test-user',
  navidromePassword: 'test-password',
  debug: false,
  tokenExpiry: 86400,
  transport: { type: 'stdio', host: '127.0.0.1', port: DEFAULT_MCP_HTTP_PORT, expose: false },
  features: {
    lastfm: false,
    radioBrowser: false,
    lyrics: false,
    playback: false,
  },
  lrclibBase: 'https://lrclib.net',
  playbackTranscodeFormat: 'raw',
  playbackTranscodeBitrate: '192',
  filterCacheEnabled: true,
  webui: {
    enabled: true,
    host: '127.0.0.1',
    port: 8808,
    expose: false,
    autoOpenBrowser: false,
    persistAfterMcpExit: false,
    theme: null,
    visualizer: true,
  },
};

export function makeTestConfig(overrides: ConfigOverrides = {}): Config {
  const { features: featureOverrides, ...rest } = overrides;
  return {
    ...BASE,
    ...rest,
    features: { ...BASE.features, ...featureOverrides },
  };
}
