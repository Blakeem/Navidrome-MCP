/**
 * Builds a `Config` without `loadConfig()`, so a test is independent of the developer's settings
 * store and of mpv detection on the host.
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
    allowedHosts: [],
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
