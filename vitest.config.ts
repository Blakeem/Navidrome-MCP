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
    // Playback integration tests require a live mpv binary and run via
    // `pnpm test:playback` against vitest.playback.config.ts. Excluded here
    // so the default `pnpm test:run` stays mpv-free.
    exclude: ['node_modules', 'dist', 'coverage', 'tests/integration/playback/**'],
    // Provision a temp settings.json store (seeded from env/.env) before each
    // test file, since runtime config now comes only from the store.
    setupFiles: ['tests/helpers/setup-config-store.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});