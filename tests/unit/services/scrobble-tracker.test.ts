/**
 * Navidrome MCP Server - ScrobbleTracker unit tests
 * Copyright (C) 2025
 *
 * Covers the Last.fm-style scrobble rules wired into the playback engine:
 *   - submission=false on track-start (now-playing notification)
 *   - submission=true once per play, after the user listens past 50% of
 *     the duration OR 4 minutes (whichever first); only for tracks >= 30s
 *   - Radio streams (songId === null) never scrobble
 *   - MCP restart mid-track does not scrobble the in-progress track
 *
 * The tracker depends only on the narrow ScrobbleEngine / ScrobbleClient
 * shapes, so tests use a hand-rolled fake engine + the standard
 * createMockClient() factory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ScrobbleClient,
  ScrobbleEngine,
} from '../../../src/services/playback/scrobble-tracker.js';
import { ScrobbleTracker } from '../../../src/services/playback/scrobble-tracker.js';
import type { StateChangeEvent } from '../../../src/services/playback/playback-engine.js';

interface FakeEntry {
  index: number;
  songId: string | null;
  duration?: number;
}

interface FakeEngine extends ScrobbleEngine {
  fire(event: StateChangeEvent): void;
  setPlaylist(entries: FakeEntry[]): void;
  setCached(name: string, value: unknown): void;
}

function createFakeEngine(): FakeEngine {
  let handler: ((event: StateChangeEvent) => void) | null = null;
  let playlist: FakeEntry[] = [];
  const cache = new Map<string, unknown>();
  return {
    onStateChange(h): () => void {
      handler = h;
      return () => {
        if (handler === h) handler = null;
      };
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async ScrobbleEngine.getPlaylist interface
    async getPlaylist(): Promise<FakeEntry[]> {
      return playlist;
    },
    getCachedProperty(name): unknown {
      return cache.get(name);
    },
    fire(event): void {
      handler?.(event);
    },
    setPlaylist(entries): void {
      playlist = entries;
    },
    setCached(name, value): void {
      cache.set(name, value);
    },
  };
}

function createFakeClient(): ScrobbleClient & {
  subsonicRequest: ReturnType<typeof vi.fn>;
} {
  return {
    subsonicRequest: vi.fn().mockResolvedValue({ status: 'ok' }),
  };
}

// Wait one microtask + one macrotask cycle so any fire-and-forget promise
// chains in the tracker resolve (subsonicRequest is awaited internally via
// .then/.catch). vi.waitFor would also work but this is cheaper.
async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

describe('ScrobbleTracker', () => {
  let engine: FakeEngine;
  let client: ReturnType<typeof createFakeClient>;
  let tracker: ScrobbleTracker;

  beforeEach(() => {
    engine = createFakeEngine();
    client = createFakeClient();
    tracker = new ScrobbleTracker(client, engine);
    tracker.attach();
    // Simulate mpv's observe-emitted initial-state snapshot of an idle
    // engine. The tracker treats the FIRST playlist-pos event after
    // attach as initial state (not a real transition) to avoid double-
    // scrobbling on attach to a mid-track mpv. Tests that exercise the
    // attach-from-scratch path explicitly bypass this by re-creating the
    // tracker.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: -1 });
  });

  afterEach(() => {
    tracker.detach();
  });

  it('sends submission=false on track-start', async () => {
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest).toHaveBeenCalledWith(
      '/scrobble',
      { id: 'song-A', submission: 'false' },
      { method: 'POST' },
    );
  });

  it('does not scrobble radio entries (songId null)', async () => {
    engine.setPlaylist([{ index: 0, songId: null }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    // Even after threshold-crossing time-pos ticks, nothing fires.
    engine.fire({ kind: 'property', name: 'time-pos', data: 9999 });
    await flush();

    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('does not submit for tracks shorter than 30 seconds', async () => {
    engine.setPlaylist([{ index: 0, songId: 'short', duration: 25 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();
    // Cross 50% of the (too-short) duration.
    engine.fire({ kind: 'property', name: 'time-pos', data: 20 });
    await flush();

    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('submits at 50% of duration (one call only)', async () => {
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    // Below threshold — nothing yet.
    engine.fire({ kind: 'property', name: 'time-pos', data: 99 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

    // Crosses 50% of 200 = 100s.
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    const call = client.subsonicRequest.mock.calls[0];
    expect(call?.[0]).toBe('/scrobble');
    expect(call?.[1]).toMatchObject({ id: 'song-A', submission: 'true' });
    expect(typeof call?.[1]?.time).toBe('string');
    expect(Number(call?.[1]?.time)).toBeGreaterThan(0);
    expect(call?.[2]).toEqual({ method: 'POST' });
  });

  it('submits at 4 minutes for long tracks (cap)', async () => {
    engine.setPlaylist([{ index: 0, songId: 'long', duration: 600 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'time-pos', data: 239 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

    engine.fire({ kind: 'property', name: 'time-pos', data: 241 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest.mock.calls[0]?.[1]).toMatchObject({
      id: 'long',
      submission: 'true',
    });
  });

  it('submits only once across many ticks past threshold', async () => {
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    for (const t of [101, 120, 150, 180, 199]) {
      engine.fire({ kind: 'property', name: 'time-pos', data: t });
    }
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
  });

  it('does not submit a track that was skipped before threshold', async () => {
    engine.setPlaylist([
      { index: 0, songId: 'song-A', duration: 200 },
      { index: 1, songId: 'song-B', duration: 200 },
    ]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    // Listen to 30% then skip.
    engine.fire({ kind: 'property', name: 'time-pos', data: 60 });
    await flush();
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();

    // Only the now-playing for song-B should fire, never a submission=true
    // for song-A.
    const calls = client.subsonicRequest.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({ id: 'song-B', submission: 'false' });
  });

  it('does not carry stale time-pos from previous track into new play', async () => {
    engine.setPlaylist([
      { index: 0, songId: 'song-A', duration: 200 },
      { index: 1, songId: 'song-B', duration: 200 },
    ]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    // Song A reaches past threshold and scrobbles.
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    // Engine's cached time-pos is now 101 (real engine would update its
    // cache here). Simulate that.
    engine.setCached('time-pos', 101);
    client.subsonicRequest.mockClear();

    // Skip to song B. The new play must NOT inherit the 101 time-pos.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    // After hydration only now-playing for song B should have fired —
    // no submission=true should be triggered by the stale cached value.
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest.mock.calls[0]?.[1]).toEqual({
      id: 'song-B',
      submission: 'false',
    });
  });

  it('defers submission until duration is known', async () => {
    engine.setPlaylist([{ index: 0, songId: 'song-A' }]); // no duration in entry
    // No cached duration either.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    // time-pos crosses what WOULD be threshold for a 200s track, but
    // duration is still unknown.
    engine.fire({ kind: 'property', name: 'time-pos', data: 150 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

    // duration arrives.
    engine.fire({ kind: 'property', name: 'duration', data: 200 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest.mock.calls[0]?.[1]).toMatchObject({
      id: 'song-A',
      submission: 'true',
    });
  });

  it('logs and continues when subsonicRequest rejects', async () => {
    client.subsonicRequest.mockRejectedValue(new Error('network down'));
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    // No throw escaped; internal state is intact so threshold logic still
    // marks the play as submitted on the next tick.
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    expect(client.subsonicRequest).toHaveBeenCalledTimes(2);
    // Another tick past threshold should NOT trigger a second submission
    // (the failure didn't reset the `submitted` flag).
    engine.fire({ kind: 'property', name: 'time-pos', data: 120 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(2);
  });

  it('treats first playlist-pos after attach as initial state (mid-track mpv)', async () => {
    // Skip the beforeEach prime — this test exercises the genuine attach
    // path where mpv's observe-emitted initial events ARE the first thing
    // the tracker sees, including a `playlist-pos` for an already-playing
    // mid-track file.
    tracker.detach();
    tracker = new ScrobbleTracker(client, engine);
    tracker.attach();
    engine.setPlaylist([{ index: 0, songId: 'mid-track', duration: 200 }]);
    engine.setCached('duration', 200);
    // mpv emits observed property values immediately after subscribe; the
    // engine forwards them through onStateChange in OBSERVED_PROPERTIES
    // order (playlist-pos, ..., time-pos, duration).
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    engine.fire({ kind: 'property', name: 'time-pos', data: 180 });
    engine.fire({ kind: 'property', name: 'duration', data: 200 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('scrobbles on a real playlist-pos transition after the initial attach event', async () => {
    engine.setPlaylist([
      { index: 0, songId: 'A', duration: 200 },
      { index: 1, songId: 'B', duration: 200 },
    ]);
    // Transition from the prime's -1 to 1 (covers EOF→next-track after
    // attach to an idle queue scenario).
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest.mock.calls[0]?.[1]).toEqual({
      id: 'B',
      submission: 'false',
    });
  });

  it('does not re-fire on same-value playlist-pos repeat', async () => {
    engine.setPlaylist([{ index: 0, songId: 'A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();
    // Same playlist-pos value emitted again (e.g. jumpToPlaylistEntry to
    // the current index, or mpv re-emit). Must NOT fire another now-playing.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('re-hydrates on queue mutation when playlist-pos is unchanged', async () => {
    engine.setPlaylist([{ index: 0, songId: 'A', duration: 200 }]);
    engine.setCached('playlist-pos', 0);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();
    // enqueue('replace') while at index 0: the playlist content changes but
    // mpv does NOT emit a playlist-pos change event (same numeric value).
    // The engine still fires a `kind: 'queue'` signal, which the tracker
    // must use as a fallback "track may have changed" trigger.
    engine.setPlaylist([{ index: 0, songId: 'B', duration: 200 }]);
    engine.fire({ kind: 'queue' });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest.mock.calls[0]?.[1]).toEqual({
      id: 'B',
      submission: 'false',
    });
  });

  it('queue mutation that leaves the current track in place does not re-fire now-playing', async () => {
    engine.setPlaylist([{ index: 0, songId: 'A', duration: 200 }]);
    engine.setCached('playlist-pos', 0);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();
    // Simulate a shuffle/move/remove that didn't displace the current
    // track (entry at index 0 is still song A).
    engine.fire({ kind: 'queue' });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('does not corrupt state when playlist reads resolve out of order', async () => {
    // Two rapid playlist-pos transitions; the first getPlaylist resolves
    // AFTER the second has already completed. The stale resolution must
    // not overwrite state — the generation token catches it.
    let resolveFirst!: (entries: FakeEntry[]) => void;
    const firstPromise = new Promise<FakeEntry[]>((res) => {
      resolveFirst = res;
    });
    let callCount = 0;
    const playlist: FakeEntry[] = [
      { index: 0, songId: 'A', duration: 200 },
      { index: 1, songId: 'B', duration: 200 },
    ];
    engine.setPlaylist(playlist);
    // Override getPlaylist to defer the first call only.
    engine.getPlaylist = async (): Promise<FakeEntry[]> => {
      callCount++;
      if (callCount === 1) return firstPromise;
      return playlist;
    };

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 }); // suspends
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 }); // overtakes
    await flush();
    // Resolve the stale first read. If the generation guard works, this
    // must not produce a now-playing for A.
    resolveFirst(playlist);
    await flush();
    const ids = client.subsonicRequest.mock.calls.map(
      (c) => (c[1] as Record<string, string>).id,
    );
    expect(ids).toEqual(['B']);
  });

  it('ignores volume/pause/eof events', async () => {
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'volume', data: 80 });
    engine.fire({ kind: 'property', name: 'pause', data: true });
    engine.fire({ kind: 'property', name: 'eof-reached', data: true });
    engine.fire({ kind: 'queue' });
    await flush();

    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('ignores playlist-pos events with non-numeric data (idle)', async () => {
    engine.fire({ kind: 'property', name: 'playlist-pos', data: null });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('uses cached duration when playlist entry lacks one', async () => {
    engine.setPlaylist([{ index: 0, songId: 'song-A' }]);
    engine.setCached('duration', 200);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest.mock.calls[0]?.[1]).toMatchObject({
      id: 'song-A',
      submission: 'true',
    });
  });

  it('attach is idempotent', async () => {
    tracker.attach(); // second call — should not double-subscribe
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    // If a double-subscribe happened, we'd see 2 calls.
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
  });
});
