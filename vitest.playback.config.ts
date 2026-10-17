// The playback and coordination suites need a real mpv, a reachable Navidrome and a built dist/,
// so `pnpm test:run` excludes them and this config runs them.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/integration/playback/**/*.test.ts',
      'tests/integration/coordination/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'coverage'],
    // setup-cleanup.ts clears the mpv queue after each file, so the run never leaves music playing.
    setupFiles: ['tests/helpers/setup-config-store.ts', 'tests/integration/playback/setup-cleanup.ts'],
    // Every file drives the same mpv queue, so concurrent files would interleave queue changes.
    fileParallelism: false,
    // A worker per file would log in again per file and trip Navidrome's 429 login limit.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // An isolated file re-imports the client and engine singletons, so it logs in again.
    isolate: false,
    // Coordination tests chain several child-process startups, each with a Navidrome login.
    testTimeout: 90000,
    // A beforeAll random-sort song search can take 10s+ on a large library.
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
