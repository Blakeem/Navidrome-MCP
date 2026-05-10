/**
 * Per-test-file teardown for the playback integration suite.
 *
 * Registered via `setupFiles` in vitest.playback.config.ts. Vitest runs this
 * once per test file, and `afterAll` at module scope here applies to every
 * test in that file — meaning every playback test file automatically clears
 * the live mpv queue after its last test, regardless of whether the file's
 * own author remembered to add an afterAll. Without this, the very last
 * test in the very last test file would leave music playing on the user's
 * machine after `pnpm test:playback` exits.
 *
 * Each test file already does `clearPlayQueue` in `beforeEach`, so this is
 * specifically for the trailing-state problem: nothing wipes the queue
 * after the final test has run.
 */

import { afterAll } from 'vitest';
import { clearPlayQueue } from './helpers.js';
import { shouldSkipLiveTests } from '../../helpers/env-detection.js';
import { detectMpvBinary } from '../../../src/services/playback/mpv-process.js';

afterAll(async () => {
  // Match the same skip conditions describePlayback uses — no point in
  // calling clearPlayQueue if the tests themselves were skipped (mpv
  // missing, Navidrome unreachable, etc.).
  if (shouldSkipLiveTests() || detectMpvBinary() === null) {
    return;
  }
  try {
    await clearPlayQueue();
  } catch {
    // Best-effort cleanup; if mpv crashed mid-run this would throw and we
    // don't want to mask the real test failure with a teardown error.
  }
});
