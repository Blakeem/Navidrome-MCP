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
    // The integration suites need mpv or a built dist/, so they run under `pnpm test:playback`.
    exclude: ['node_modules', 'dist', 'coverage', 'tests/integration/**'],
    // Each test file gets a throwaway settings.json store, so the suite never touches the real one.
    setupFiles: ['tests/helpers/setup-config-store.ts'],
    // Per-file workers log in to Navidrome at once and get 429, so live reads run in test:live.
    // The flag lives here instead of the npm script so it holds on every platform.
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