// Clears the live mpv queue after each playback test file, so no queue keeps playing after the run.

import { afterAll } from 'vitest';
import { clearPlayQueue } from './helpers.js';
import { isMpvAvailable, shouldSkipLiveTests } from '../../helpers/env-detection.js';
import { playbackEngine } from '../../../src/services/playback/playback-engine.js';

afterAll(async () => {
  if (shouldSkipLiveTests() || !isMpvAvailable()) {
    return;
  }
  try {
    await playbackEngine.ensureAttached();
    if (!playbackEngine.isRunning()) return;
    await clearPlayQueue();
  } catch {
    // A teardown error after an mpv crash would mask the real test failure.
  }
});
