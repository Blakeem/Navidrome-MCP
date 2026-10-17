// The queue, transport controls, now-playing card and lyrics overlay share this current-track rule,
// so an idle mpv must never read as playing.

import { describe, expect, it } from 'vitest';
import { playingIndex } from '../../../src/webui/public/snapshot.js';

describe('playingIndex', () => {
  it('returns the queue index while a track is loaded', () => {
    expect(playingIndex({ engineRunning: true, paused: false, queueIndex: 0 })).toBe(0);
    expect(playingIndex({ engineRunning: true, paused: true, queueIndex: 3 })).toBe(3);
  });

  it('returns null for an idle engine after a clear or the end of the queue', () => {
    expect(playingIndex({ engineRunning: true, paused: false, queueIndex: -1 })).toBeNull();
  });

  it('returns null with no snapshot, a stopped engine or no queue index', () => {
    expect(playingIndex(null)).toBeNull();
    expect(playingIndex({ engineRunning: false, queueIndex: 2 })).toBeNull();
    expect(playingIndex({ engineRunning: true, paused: false })).toBeNull();
  });
});
