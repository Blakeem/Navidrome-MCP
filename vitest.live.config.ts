/**
 * Vitest config for the live-read suite (real Navidrome, no writes).
 *
 * Run with: pnpm test:live
 *
 * Why a separate config:
 *   - These files authenticate against a real Navidrome. `pnpm test:run` sets
 *     SKIP_INTEGRATION_TESTS so their live blocks skip, which keeps the default
 *     run deterministic; this config is where they actually execute.
 *   - Navidrome rate-limits concurrent logins. Four simultaneous /auth/login
 *     calls all return 429 while two succeed, and vitest's default forks pool
 *     gives every file its own worker. singleFork + isolate:false put all four
 *     files in ONE process so the shared-client singleton is reused and the
 *     suite authenticates exactly once. Same reasoning as
 *     vitest.playback.config.ts.
 *   - Those live workers also hold undici keep-alive sockets open, which raced
 *     fork teardown in the default run and surfaced as an
 *     ERR_IPC_CHANNEL_CLOSED unhandled rejection (exit 1 with zero failures).
 *     Keeping them out of the parallel pool removes that race too.
 *
 * `include` is an explicit list rather than a glob: live blocks sit inside
 * files that also hold mocked tests, so there is no path pattern that selects
 * them. A new file with a describeLive block must be added here.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/unit/tools/playlist.test.ts',
      'tests/unit/tools/search.test.ts',
      'tests/unit/tools/test-connection.test.ts',
      'tests/unit/tools/user-preferences.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'coverage'],
    setupFiles: ['tests/helpers/setup-config-store.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    isolate: false,
    // Live reads hit a real server over the network; the default 10s is tight
    // for a large library on a cold cache.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
