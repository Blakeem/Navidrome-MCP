// Navidrome returns 429 to four concurrent logins, so one shared fork logs in once for the suite.
// One fork also keeps keep-alive sockets from racing fork teardown into ERR_IPC_CHANNEL_CLOSED.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Live blocks share files with mocked tests, so each file with a describeLive block is listed.
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
    // Live reads of a large library on a cold cache can exceed the unit suite's 10s.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
