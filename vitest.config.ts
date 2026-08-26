import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        '*.config.ts',
        '**/*.d.ts',
        'tests/',
        'scripts/',
      ],
    },
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Integration suites (live-mpv playback + multi-process coordination) require
    // a real mpv binary and/or spawn real child processes against a built dist/.
    // They run via `pnpm test:playback` (vitest.playback.config.ts) and are
    // excluded here so the default `pnpm test:run` stays fast and mpv-free.
    exclude: ['node_modules', 'dist', 'coverage', 'tests/integration/**'],
    // Provision a temp settings.json store (seeded from env/.env) before each
    // test file, since runtime config now comes only from the store.
    setupFiles: ['tests/helpers/setup-config-store.ts'],
    // Live-read blocks skip here so this run is deterministic. They authenticate
    // against a real Navidrome, and vitest's forks pool gives each file its own
    // worker: four concurrent logins all get 429, and their keep-alive sockets
    // raced fork teardown as ERR_IPC_CHANNEL_CLOSED. They run via
    // `pnpm test:live` (vitest.live.config.ts), which shares one fork.
    // Set in config rather than the npm script so it holds on every platform.
    env: {
      SKIP_INTEGRATION_TESTS: 'true',
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});