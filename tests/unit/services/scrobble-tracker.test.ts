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
  entryId?: number;
  isCurrent?: boolean;
  duration?: number;
}

interface FakeEngine extends ScrobbleEngine {
  fire(event: StateChangeEvent): void;
  setPlaylist(entries: FakeEntry[]): void;
  setCached(name: string, value: unknown): void;
  /** Every claim broadcast, in send order. */
  broadcasts: string[][];
  /** mpv echoes a broadcast to its sender. Off lets a test order the echoes itself. */
  autoEcho: boolean;
}

function createFakeEngine(): FakeEngine {
  let handler: ((event: StateChangeEvent) => void) | null = null;
  let playlist: FakeEntry[] = [];
  const cache = new Map<string, unknown>();
  const engine: FakeEngine = {
    broadcasts: [],
    autoEcho: true,
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async ScrobbleEngine.broadcastMessage interface
    async broadcastMessage(args): Promise<void> {
      engine.broadcasts.push(args);
      if (engine.autoEcho) queueMicrotask(() => handler?.({ kind: 'message', args }));
    },
    onStateChange(h): () => void {
      handler = h;
      return () => {
        if (handler === h) handler = null;
      };
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async ScrobbleEngine.getQueue interface
    async getQueue(): Promise<FakeEntry[]> {
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
  return engine;
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
    // A Date.now spy, not fake timers, because flush() relies on a real setImmediate.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    // Below threshold — nothing yet.
    engine.fire({ kind: 'property', name: 'time-pos', data: 99 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

    // Crosses 50% of 200 = 100s.
    nowSpy.mockReturnValue(1_100_000);
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    const call = client.subsonicRequest.mock.calls[0];
    expect(call?.[0]).toBe('/scrobble');
    expect(call?.[1]).toMatchObject({ id: 'song-A', submission: 'true' });
    // The timestamp is the track start, not the threshold crossing.
    expect(call?.[1]?.time).toBe('1000000');
    expect(call?.[2]).toEqual({ retryPolicy: 'never' });
    nowSpy.mockRestore();
  });

  it('keeps the current play when the playlist read after a queue event fails', async () => {
    const playlist = [{ index: 0, songId: 'song-A', duration: 200 }];
    engine.setPlaylist(playlist);
    engine.setCached('playlist-pos', 0);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    engine.getQueue = vi.fn<() => Promise<FakeEntry[]>>()
      .mockRejectedValueOnce(new Error('ipc'))
      .mockResolvedValue(playlist);
    engine.fire({ kind: 'queue' });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
    expect(params.filter((p) => p.submission === 'true').map((p) => p.id)).toEqual(['song-A']);
  });

  it('resets on a failed playlist read at a track change, then tracks the next one', async () => {
    const playlist = [
      { index: 0, songId: 'song-A', duration: 200 },
      { index: 1, songId: 'song-B', duration: 200 },
    ];
    engine.setPlaylist(playlist);
    engine.getQueue = vi.fn<() => Promise<FakeEntry[]>>()
      .mockRejectedValueOnce(new Error('ipc'))
      .mockResolvedValue(playlist);

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest).toHaveBeenCalledWith('/scrobble', { id: 'song-B', submission: 'false' });
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
    // Same playlist-pos value emitted again (e.g. jumpToQueueEntry to
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

  it.each([
    [
      'mpv entry ids',
      [
        { index: 0, songId: 'X', entryId: 1, duration: 200 },
        { index: 1, songId: 'A', entryId: 2, duration: 200 },
      ],
      [{ index: 0, songId: 'A', entryId: 2, duration: 200 }],
    ],
    [
      'the songId fallback',
      [
        { index: 0, songId: 'X', duration: 200 },
        { index: 1, songId: 'A', duration: 200 },
      ],
      [{ index: 0, songId: 'A', duration: 200 }],
    ],
  ])('submits a play once when a queue edit shifts its index after submission (%s)', async (_label, before, after) => {
    engine.setPlaylist(before);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    // Removing the entry before the playing one moves it from index 1 to 0.
    engine.setPlaylist(after);
    engine.setCached('playlist-pos', 0);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    engine.fire({ kind: 'queue' });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 102 });
    await flush();

    const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
    expect(params.filter((p) => p.submission === 'true')).toHaveLength(1);
    expect(params.filter((p) => p.submission === 'false')).toHaveLength(1);
  });

  it('submits a play once when the queue event for an index shift lands before playlist-pos', async () => {
    engine.setPlaylist([
      { index: 0, songId: 'X', entryId: 1, duration: 200 },
      { index: 1, songId: 'A', entryId: 2, duration: 200, isCurrent: true },
      { index: 2, songId: 'B', entryId: 3, duration: 200 },
    ]);
    engine.setCached('playlist-pos', 1);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    // The playlist-pos cache still names index 1 when the queue event fires.
    engine.setPlaylist([
      { index: 0, songId: 'A', entryId: 2, duration: 200, isCurrent: true },
      { index: 1, songId: 'B', entryId: 3, duration: 200 },
    ]);
    engine.fire({ kind: 'queue' });
    await flush();
    engine.setCached('playlist-pos', 0);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 102 });
    await flush();

    const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
    expect(params.filter((p) => p.submission === 'true')).toHaveLength(1);
    expect(params.filter((p) => p.submission === 'false').map((p) => p.id)).toEqual(['A']);
  });

  it('counts a new mpv entry of the same song as a new play', async () => {
    engine.setPlaylist([{ index: 0, songId: 'A', entryId: 1, duration: 200 }]);
    engine.setCached('playlist-pos', 0);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    // A replace-enqueue of the same song keeps index 0 but creates a new mpv entry.
    engine.setPlaylist([{ index: 0, songId: 'A', entryId: 5, duration: 200 }]);
    engine.fire({ kind: 'queue' });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
    expect(params.filter((p) => p.submission === 'true')).toHaveLength(2);
  });

  it('a re-attach to a new mpv at a different index counts neither play, then tracks the next one', async () => {
    engine.setPlaylist([
      { index: 0, songId: 'X', entryId: 1, duration: 200 },
      { index: 1, songId: 'Y', entryId: 2, duration: 200 },
      { index: 2, songId: 'A', entryId: 3, duration: 200 },
    ]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 2 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 20 });
    await flush();
    client.subsonicRequest.mockClear();

    // The previous mpv exited and another process started a new one playing B.
    engine.setPlaylist([
      { index: 0, songId: 'B', entryId: 1, duration: 200 },
      { index: 1, songId: 'C', entryId: 2, duration: 200 },
    ]);
    engine.fire({ kind: 'attach' });
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    engine.fire({ kind: 'property', name: 'time-pos', data: 150 });
    engine.fire({ kind: 'property', name: 'duration', data: 200 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
    expect(params.map((p) => [p.id, p.submission])).toEqual([['C', 'false'], ['C', 'true']]);
  });

  it('a re-attach to a new mpv at the same index does not submit the previous mpv\'s song', async () => {
    engine.setPlaylist([{ index: 0, songId: 'A', entryId: 1, duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 20 });
    await flush();
    client.subsonicRequest.mockClear();

    // Entry ids restart per mpv instance, so the new song B reuses entry id 1.
    engine.setPlaylist([{ index: 0, songId: 'B', entryId: 1, duration: 200 }]);
    engine.fire({ kind: 'attach' });
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    engine.fire({ kind: 'property', name: 'duration', data: 200 });
    engine.fire({ kind: 'property', name: 'time-pos', data: 150 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('a playlist read begun before a re-attach does not start tracking after it', async () => {
    let resolveRead!: (entries: FakeEntry[]) => void;
    engine.getQueue = (): Promise<FakeEntry[]> => new Promise((res) => { resolveRead = res; });
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    engine.fire({ kind: 'attach' });
    resolveRead([{ index: 0, songId: 'A', entryId: 1, duration: 200 }]);
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 150 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  describe('in-flight play adopted at attach', () => {
    const inFlight = { index: 0, songId: 'T', entryId: 7, isCurrent: true, duration: 300 };

    beforeEach(async () => {
      engine.setPlaylist([inFlight]);
      engine.setCached('playlist-pos', 0);
      engine.setCached('path', 'http://nd/rest/stream?id=T');
      engine.fire({ kind: 'attach' });
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
      await flush();
    });

    it('a queue event does not count the adopted play again', async () => {
      engine.fire({ kind: 'queue' });
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 250 });
      await flush();

      expect(client.subsonicRequest).not.toHaveBeenCalled();
    });

    it('an index shift does not count the adopted play again', async () => {
      engine.setPlaylist([
        { index: 0, songId: 'X', entryId: 9 },
        { ...inFlight, index: 1 },
      ]);
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 250 });
      await flush();

      expect(client.subsonicRequest).not.toHaveBeenCalled();
    });

    it('a natural advance to a new entry still starts and submits the new play', async () => {
      engine.setPlaylist([
        { ...inFlight, isCurrent: false },
        { index: 1, songId: 'U', entryId: 8, isCurrent: true, duration: 200 },
      ]);
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
      await flush();

      const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
      expect(params.map((p) => [p.id, p.submission])).toEqual([['U', 'false'], ['U', 'true']]);
    });
  });

  describe('in-flight adoption when the attach is lazy', () => {
    const urlT = 'http://nd/rest/stream?id=T&s=1';
    const urlU = 'http://nd/rest/stream?id=U&s=2';

    // The engine writes its cache before it emits the event.
    function firePath(path: string): void {
      engine.setCached('path', path);
      engine.fire({ kind: 'property', name: 'path', data: path });
    }

    beforeEach(() => {
      engine.setCached('path', urlT);
    });

    it('a move that shifts the playing entry does not count the adopted play again', async () => {
      // Every read answers after the move that triggered the attach, so T already sits at index 1.
      engine.setPlaylist([
        { index: 0, songId: 'B', entryId: 2 },
        { index: 1, songId: 'T', entryId: 7, isCurrent: true, duration: 300 },
        { index: 2, songId: 'A', entryId: 1 },
      ]);
      engine.setCached('playlist-pos', 1);
      engine.fire({ kind: 'attach' });
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 2 });
      firePath(urlT);
      engine.fire({ kind: 'queue' });
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 250 });
      await flush();

      expect(client.subsonicRequest).not.toHaveBeenCalled();
    });

    it('a next starts and submits the new play once the inherited file stops', async () => {
      // The adoption read answers after the next, so the new entry U is already current.
      engine.setPlaylist([
        { index: 0, songId: 'T', entryId: 7, duration: 300 },
        { index: 1, songId: 'U', entryId: 8, isCurrent: true, duration: 300 },
      ]);
      engine.setCached('playlist-pos', 1);
      engine.fire({ kind: 'attach' });
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
      firePath(urlT);
      await flush();
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
      await flush();
      firePath(urlU);
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 200 });
      await flush();

      const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
      expect(params.map((p) => [p.id, p.submission])).toEqual([['U', 'false'], ['U', 'true']]);
    });

    it('starts the new file when its path change lands before the adoption read resolves', async () => {
      const songU = { index: 0, songId: 'U', entryId: 8, isCurrent: true, duration: 300 };
      const pendingReads: Array<(entries: FakeEntry[]) => void> = [];
      engine.getQueue = (): Promise<FakeEntry[]> => new Promise((res) => { pendingReads.push(res); });
      engine.setCached('playlist-pos', 0);
      engine.fire({ kind: 'attach' });
      firePath(urlT);
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
      firePath(urlU);
      // Both reads answer after the same-index replace, so each shows U current.
      pendingReads[0]?.([songU]);
      await flush();
      pendingReads[1]?.([songU]);
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 200 });
      await flush();

      expect(pendingReads).toHaveLength(2);
      const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
      expect(params.map((p) => [p.id, p.submission])).toEqual([['U', 'false'], ['U', 'true']]);
    });
  });

  describe('path change with no playlist-pos change', () => {
    const songA = { index: 0, songId: 'A', entryId: 1, isCurrent: true, duration: 600 };
    const songB = { index: 0, songId: 'B', entryId: 2, isCurrent: true, duration: 200 };

    beforeEach(async () => {
      engine.fire({ kind: 'property', name: 'path', data: 'http://nd/rest/stream?id=A' });
      engine.setPlaylist([songA]);
      engine.setCached('playlist-pos', 0);
      engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 180 });
      await flush();
    });

    it('does not submit the displaced play when the new file reports its duration first', async () => {
      let resolveRead!: (entries: FakeEntry[]) => void;
      engine.getQueue = (): Promise<FakeEntry[]> => new Promise((res) => { resolveRead = res; });

      engine.fire({ kind: 'property', name: 'path', data: 'http://nd/rest/stream?id=B' });
      engine.fire({ kind: 'property', name: 'duration', data: 200 });
      await flush();
      resolveRead([songB]);
      await flush();

      const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
      expect(params.filter((p) => p.submission === 'true')).toEqual([]);
    });

    it('tracks the new file and submits it, never the displaced one', async () => {
      engine.setPlaylist([songB]);
      engine.fire({ kind: 'property', name: 'path', data: 'http://nd/rest/stream?id=B' });
      await flush();
      engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
      await flush();

      const params = client.subsonicRequest.mock.calls.map((c) => c[1] as Record<string, string>);
      expect(params.map((p) => [p.id, p.submission])).toEqual([['A', 'false'], ['B', 'false'], ['B', 'true']]);
    });

    it('treats the first path event after an attach as the snapshot', async () => {
      engine.fire({ kind: 'attach' });
      client.subsonicRequest.mockClear();
      engine.setPlaylist([songB]);
      engine.fire({ kind: 'property', name: 'path', data: 'http://nd/rest/stream?id=B' });
      await flush();

      expect(client.subsonicRequest).not.toHaveBeenCalled();
    });
  });

  it('does not corrupt state when playlist reads resolve out of order', async () => {
    // Two rapid playlist-pos transitions. The first getQueue resolves
    // AFTER the second has already completed. The stale resolution must
    // not overwrite state. The generation token catches it.
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
    // Override getQueue to defer the first call only.
    engine.getQueue = async (): Promise<FakeEntry[]> => {
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

/**
 * Per-track ownership verdict. The injected `shouldSubmit` decides, once at each
 * track's start, whether THIS process may claim the play. In MCP it defers to an
 * older web owner that submits without claiming. These tests pin the latch,
 * deferral and race-guard behavior without real sockets.
 */
describe('ScrobbleTracker ownership election', () => {
  let engine: FakeEngine;
  let client: ReturnType<typeof createFakeClient>;
  let tracker: ScrobbleTracker;

  function startTracker(shouldSubmit: () => Promise<boolean>): void {
    tracker = new ScrobbleTracker(client, engine, shouldSubmit);
    tracker.attach();
    // Prime the attach sentinel (idle initial state), as the engine would.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: -1 });
  }

  beforeEach(() => {
    engine = createFakeEngine();
    client = createFakeClient();
  });

  afterEach(() => {
    tracker.detach();
  });

  // Helper: did any call submit (submission=true) for the given song id?
  function submittedIds(): string[] {
    return client.subsonicRequest.mock.calls
      .filter((c) => (c[1] as Record<string, string>).submission === 'true')
      .map((c) => (c[1] as Record<string, string>).id);
  }

  it('(a) suppresses submission when a web owner is present at track start', async () => {
    startTracker(() => Promise.resolve(false)); // a web owner owns the port
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear(); // drop the now-playing ping

    // Cross 50% — but ownership is 'notMine', so nothing should submit.
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual([]);
  });

  it('(b) submits when no web owner is present at track start', async () => {
    startTracker(() => Promise.resolve(true)); // MCP-only: nobody else
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('(c) web appears mid-session: in-flight track still submitted, next track suppressed', async () => {
    // First track resolves 'mine' (no web yet); a web appears, so the second
    // track's probe resolves 'notMine'.
    const shouldSubmit = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    startTracker(shouldSubmit);
    engine.setPlaylist([
      { index: 0, songId: 'song-A', duration: 200 },
      { index: 1, songId: 'song-B', duration: 200 },
    ]);

    // Track A — MCP owns it, submits.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    // Track B — web is now up, MCP defers.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    expect(submittedIds()).toEqual(['song-A']);
  });

  it('(d) defers a threshold crossed before the probe resolves, then catches up', async () => {
    let resolveVerdict!: (v: boolean) => void;
    const verdict = new Promise<boolean>((r) => {
      resolveVerdict = r;
    });
    startTracker(() => verdict);
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    // Threshold crosses while the verdict is still 'undecided' — must defer
    // (no submit, and the `submitted` latch must NOT be set).
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual([]);

    // Verdict lands as 'mine' — resolveOwnership catches up.
    resolveVerdict(true);
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('(d2) a deferred verdict of notMine never submits', async () => {
    let resolveVerdict!: (v: boolean) => void;
    const verdict = new Promise<boolean>((r) => {
      resolveVerdict = r;
    });
    startTracker(() => verdict);
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    resolveVerdict(false);
    await flush();
    expect(submittedIds()).toEqual([]);
  });

  it('(e) a verdict that resolves after a skip does not latch onto the new track', async () => {
    // Track A's probe is deferred; track B's resolves immediately to 'mine'.
    let resolveA!: (v: boolean) => void;
    const pA = new Promise<boolean>((r) => {
      resolveA = r;
    });
    let call = 0;
    startTracker(() => {
      call += 1;
      return call === 1 ? pA : Promise.resolve(true);
    });
    engine.setPlaylist([
      { index: 0, songId: 'song-A', duration: 200 },
      { index: 1, songId: 'song-B', duration: 200 },
    ]);

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 }); // A — verdict pending
    await flush();
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 }); // skip to B — verdict 'mine'
    await flush();

    // A's stale verdict disagrees with B's. Without the generation guard it would
    // set 'notMine' and silently drop B's scrobble.
    resolveA(false);
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-B']);
  });

  it('(e2) a stale mine verdict does not override the new track notMine', async () => {
    let resolveA!: (v: boolean) => void;
    const pA = new Promise<boolean>((r) => {
      resolveA = r;
    });
    let call = 0;
    startTracker(() => {
      call += 1;
      return call === 1 ? pA : Promise.resolve(false);
    });
    engine.setPlaylist([
      { index: 0, songId: 'song-A', duration: 200 },
      { index: 1, songId: 'song-B', duration: 200 },
    ]);

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();

    // Without the generation guard, A's stale 'mine' would double-count B against the web owner.
    resolveA(true);
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual([]);
  });

  it('(f) a queue event that orphans an undecided verdict starts a new ownership check', async () => {
    let call = 0;
    startTracker(() => {
      call += 1;
      return call === 1 ? new Promise<boolean>(() => undefined) : Promise.resolve(true);
    });
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);

    // The flush lets hydrateAndStart track A, so the queue event orphans the probe, not the hydrate.
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.setCached('playlist-pos', 0);
    engine.fire({ kind: 'queue' });
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('(g) a rejected ownership probe defaults to submitting', async () => {
    startTracker(() => Promise.reject(new Error('probe')));
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });
});

/**
 * The claim channel. mpv echoes every script-message to every client in one
 * order, so the first claim for a play wins and exactly one process submits it.
 */
describe('ScrobbleTracker claim channel', () => {
  const CLAIM = 'navidrome-mcp-scrobble-claim';
  let engine: FakeEngine;
  let client: ReturnType<typeof createFakeClient>;
  let tracker: ScrobbleTracker;

  beforeEach(() => {
    engine = createFakeEngine();
    client = createFakeClient();
    tracker = new ScrobbleTracker(client, engine);
    tracker.attach();
    engine.fire({ kind: 'property', name: 'playlist-pos', data: -1 });
  });

  afterEach(() => {
    tracker.detach();
    vi.useRealTimers();
  });

  function submittedIds(c = client): string[] {
    return c.subsonicRequest.mock.calls
      .filter((call) => (call[1] as Record<string, string>).submission === 'true')
      .map((call) => (call[1] as Record<string, string>).id);
  }

  async function startSong(songId: string, entryId: number, index = 0): Promise<void> {
    engine.setPlaylist([{ index, songId, entryId, duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: index });
    await flush();
  }

  function claim(key: string, claimant: string): void {
    engine.fire({ kind: 'message', args: [CLAIM, key, claimant] });
  }

  it('broadcasts one claim keyed by entry id and song at the threshold', async () => {
    await startSong('song-A', 7);
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    engine.fire({ kind: 'property', name: 'time-pos', data: 102 });
    await flush();

    expect(engine.broadcasts).toHaveLength(1);
    expect(engine.broadcasts[0]?.slice(0, 2)).toEqual([CLAIM, '7:song-A']);
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('a foreign claim seen before the threshold means no claim and no submit', async () => {
    await startSong('song-A', 7);
    claim('7:song-A', 'other-process');
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    expect(engine.broadcasts).toHaveLength(0);
    expect(submittedIds()).toEqual([]);
  });

  it('a foreign claim ordered before the own echo means no submit', async () => {
    engine.autoEcho = false;
    await startSong('song-A', 7);
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    const own = engine.broadcasts[0];
    expect(own).toBeDefined();

    claim('7:song-A', 'other-process');
    engine.fire({ kind: 'message', args: own ?? [] });
    await flush();
    expect(submittedIds()).toEqual([]);
  });

  it('the own echo ordered before a foreign claim submits exactly once', async () => {
    engine.autoEcho = false;
    await startSong('song-A', 7);
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    engine.fire({ kind: 'message', args: engine.broadcasts[0] ?? [] });
    claim('7:song-A', 'other-process');
    engine.fire({ kind: 'property', name: 'time-pos', data: 150 });
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('ignores a claim for another play and other message topics', async () => {
    await startSong('song-A', 7);
    claim('6:song-A', 'other-process');
    engine.fire({ kind: 'message', args: ['some-other-topic', '7:song-A', 'other-process'] });
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('submits when mpv never echoes the claim', async () => {
    vi.useFakeTimers();
    engine.autoEcho = false;
    engine.setPlaylist([{ index: 0, songId: 'song-A', entryId: 7, duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await vi.advanceTimersByTimeAsync(0);
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    expect(submittedIds()).toEqual([]);

    await vi.advanceTimersByTimeAsync(5000);
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('submits when the claim broadcast fails', async () => {
    engine.broadcastMessage = (): Promise<void> => Promise.reject(new Error('mpv IPC is not connected'));
    await startSong('song-A', 7);
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('a stale echo after a skip does not submit the next play early', async () => {
    engine.autoEcho = false;
    await startSong('song-A', 7);
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    const staleClaim = engine.broadcasts[0] ?? [];

    await startSong('song-B', 8, 1);
    engine.fire({ kind: 'message', args: staleClaim });
    engine.fire({ kind: 'property', name: 'time-pos', data: 5 });
    await flush();
    expect(submittedIds()).toEqual([]);
  });

  it('an adopted play never claims', async () => {
    const adopting = createFakeEngine();
    const adoptingClient = createFakeClient();
    const adopter = new ScrobbleTracker(adoptingClient, adopting);
    adopter.attach();
    adopting.setCached('path', 'http://navidrome/stream?id=song-A');
    adopting.setPlaylist([{ index: 0, songId: 'song-A', entryId: 7, isCurrent: true, duration: 200 }]);
    adopting.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    adopting.fire({ kind: 'property', name: 'time-pos', data: 150 });
    await flush();
    expect(adopting.broadcasts).toHaveLength(0);
    expect(submittedIds(adoptingClient)).toEqual([]);
    adopter.detach();
  });
});

/**
 * Two processes attached to one mpv. The bus delivers every property event and
 * every broadcast to both trackers in one order, as mpv does.
 */
describe('ScrobbleTracker claim channel across two processes', () => {
  interface Bus {
    engineFor(slot: number): ScrobbleEngine;
    fire(event: StateChangeEvent): void;
    fireTo(slot: number, event: StateChangeEvent): void;
    setPlaylist(entries: FakeEntry[]): void;
    setCached(name: string, value: unknown): void;
  }

  function createBus(): Bus {
    const handlers = new Map<number, (event: StateChangeEvent) => void>();
    let playlist: FakeEntry[] = [];
    const cache = new Map<string, unknown>();
    const fire = (event: StateChangeEvent): void => {
      for (const handler of [...handlers.values()]) handler(event);
    };
    return {
      engineFor: (slot): ScrobbleEngine => ({
        onStateChange(h): () => void {
          handlers.set(slot, h);
          return () => handlers.delete(slot);
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async ScrobbleEngine.getQueue interface
        async getQueue(): Promise<FakeEntry[]> {
          return playlist;
        },
        getCachedProperty: (name): unknown => cache.get(name),
        // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async ScrobbleEngine.broadcastMessage interface
        async broadcastMessage(args): Promise<void> {
          queueMicrotask(() => fire({ kind: 'message', args }));
        },
      }),
      fire,
      fireTo: (slot, event): void => handlers.get(slot)?.(event),
      setPlaylist: (entries): void => {
        playlist = entries;
      },
      setCached: (name, value): void => {
        cache.set(name, value);
      },
    };
  }

  function submissions(c: ReturnType<typeof createFakeClient>): number {
    return c.subsonicRequest.mock.calls.filter(
      (call) => (call[1] as Record<string, string>).submission === 'true',
    ).length;
  }

  const trackers: ScrobbleTracker[] = [];
  afterEach(() => {
    for (const t of trackers.splice(0)) t.detach();
  });

  function startTracker(bus: Bus, slot: number, client: ReturnType<typeof createFakeClient>): void {
    const tracker = new ScrobbleTracker(client, bus.engineFor(slot));
    tracker.attach();
    trackers.push(tracker);
  }

  it('two trackers that both counted a play submit it exactly once', async () => {
    const bus = createBus();
    const first = createFakeClient();
    const second = createFakeClient();
    startTracker(bus, 0, first);
    startTracker(bus, 1, second);
    bus.fire({ kind: 'property', name: 'playlist-pos', data: -1 });

    bus.setPlaylist([{ index: 0, songId: 'song-A', entryId: 3, duration: 200 }]);
    bus.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    bus.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    expect(submissions(first) + submissions(second)).toBe(1);
  });

  it('a play one tracker adopted is submitted by the tracker that counted it', async () => {
    const bus = createBus();
    const counting = createFakeClient();
    const adopting = createFakeClient();
    startTracker(bus, 0, counting);
    bus.fireTo(0, { kind: 'property', name: 'playlist-pos', data: -1 });
    bus.setPlaylist([{ index: 0, songId: 'song-A', entryId: 3, isCurrent: true, duration: 200 }]);
    bus.setCached('path', 'http://navidrome/stream?id=song-A');
    bus.fireTo(0, { kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    // The second process attaches mid-play, so its first playlist-pos is the snapshot it adopts.
    startTracker(bus, 1, adopting);
    bus.fireTo(1, { kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    bus.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    expect(submissions(counting)).toBe(1);
    expect(submissions(adopting)).toBe(0);
  });
});
