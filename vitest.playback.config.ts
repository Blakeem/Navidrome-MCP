/**
 * Vitest config for the live-playback integration test suite.
 *
 * Run with: pnpm test:playback
 *
 * Why a separate config:
 *   - These tests require a real mpv binary AND a reachable Navidrome
 *     instance. They are skipped cleanly via describePlayback when either
 *     is missing, but the default `pnpm test:run` excludes them entirely
 *     so contributors aren't required to install mpv to run the unit suite.
 *   - File-level parallelism is disabled here because every test file
 *     drives the same singleton mpv process; running concurrent files
 *     would produce non-deterministic queue manipulations.
 *   - The default test timeout is bumped to 15s to absorb mpv's async
 *     property-update latency plus Navidrome HTTP round-trips.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/playback/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'coverage'],
    // Registered once per test file. Adds an `afterAll` that clears mpv's
    // queue when the file's last test finishes, so `pnpm test:playback`
    // never leaves music playing on the host after the run exits.
    setupFiles: ['tests/integration/playback/setup-cleanup.ts'],
    // mpv is a single shared resource; concurrent test files would fight
    // over queue state. Run files sequentially.
    fileParallelism: false,
    // Run all test files in the SAME worker process so the shared
    // Navidrome auth client (a process-singleton) is reused across files.
    // Without this, each file's worker re-authenticates, which trips
    // Navidrome's auth rate limiter (HTTP 429) on the 2nd-Nth file.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Re-use module state across files in this single fork. Without this,
    // vitest re-imports modules per-file even when sharing a worker, so the
    // shared-client singleton (and the playback engine singleton) are
    // re-initialized per file — which means a fresh /auth/login each time
    // and Navidrome's auth rate limiter (HTTP 429) kicks in.
    isolate: false,
    testTimeout: 30000,
    // Hook timeout is generous because beforeAll fetches test fixtures from
    // Navidrome (random-sort song search can take 10s+ on large libraries)
    // and may also auth against a cold cache.
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
