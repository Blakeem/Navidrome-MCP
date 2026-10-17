/**
 * Navidrome MCP Server - ScrobbleTracker unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

// The tracker's IPC and Subsonic calls are fire-and-forget, so a setImmediate turn settles them.
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
    // The first playlist-pos after attach is mpv's snapshot, which never starts a play. Priming it
    // as idle makes each test's first playlist-pos a real transition.
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
    engine.fire({ kind: 'property', name: 'time-pos', data: 9999 });
    await flush();

    expect(client.subsonicRequest).not.toHaveBeenCalled();
  });

  it('does not submit for tracks shorter than 30 seconds', async () => {
    engine.setPlaylist([{ index: 0, songId: 'short', duration: 25 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();
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

    engine.fire({ kind: 'property', name: 'time-pos', data: 99 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

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
    engine.fire({ kind: 'property', name: 'time-pos', data: 60 });
    await flush();
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();

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
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    // A real engine caches the last time-pos, which the new play must not read.
    engine.setCached('time-pos', 101);
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(client.subsonicRequest.mock.calls[0]?.[1]).toEqual({
      id: 'song-B',
      submission: 'false',
    });
  });

  it('defers submission until duration is known', async () => {
    engine.setPlaylist([{ index: 0, songId: 'song-A' }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'time-pos', data: 150 });
    await flush();
    expect(client.subsonicRequest).not.toHaveBeenCalled();

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

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    expect(client.subsonicRequest).toHaveBeenCalledTimes(2);
    // A failed submission still counts as submitted, so a later tick sends nothing.
    engine.fire({ kind: 'property', name: 'time-pos', data: 120 });
    await flush();
    expect(client.subsonicRequest).toHaveBeenCalledTimes(2);
  });

  it('treats first playlist-pos after attach as initial state (mid-track mpv)', async () => {
    // A fresh tracker skips the prime, so this playlist-pos is the snapshot of a mid-track mpv.
    tracker.detach();
    tracker = new ScrobbleTracker(client, engine);
    tracker.attach();
    engine.setPlaylist([{ index: 0, songId: 'mid-track', duration: 200 }]);
    engine.setCached('duration', 200);
    // The engine forwards mpv's first emits in OBSERVED_PROPERTIES order, time-pos before duration.
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
    // A replace at index 0 swaps the track with no playlist-pos event, so the queue event rereads.
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
    // The first read resolves after the second transition completes, so its result must be dropped.
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
    engine.getQueue = async (): Promise<FakeEntry[]> => {
      callCount++;
      if (callCount === 1) return firstPromise;
      return playlist;
    };

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
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
    tracker.attach();
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    expect(client.subsonicRequest).toHaveBeenCalledTimes(1);
  });
});

describe('ScrobbleTracker ownership election', () => {
  let engine: FakeEngine;
  let client: ReturnType<typeof createFakeClient>;
  let tracker: ScrobbleTracker;

  function startTracker(shouldSubmit: () => Promise<boolean>): void {
    tracker = new ScrobbleTracker(client, engine, shouldSubmit);
    tracker.attach();
    engine.fire({ kind: 'property', name: 'playlist-pos', data: -1 });
  }

  beforeEach(() => {
    engine = createFakeEngine();
    client = createFakeClient();
  });

  afterEach(() => {
    tracker.detach();
  });

  function submittedIds(): string[] {
    return client.subsonicRequest.mock.calls
      .filter((c) => (c[1] as Record<string, string>).submission === 'true')
      .map((c) => (c[1] as Record<string, string>).id);
  }

  it('suppresses submission when a web owner is present at track start', async () => {
    startTracker(() => Promise.resolve(false)); // a web owner owns the port
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual([]);
  });

  it('submits when no web owner is present at track start', async () => {
    startTracker(() => Promise.resolve(true));
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('web appears mid-session: in-flight track still submitted, next track suppressed', async () => {
    const shouldSubmit = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    startTracker(shouldSubmit);
    engine.setPlaylist([
      { index: 0, songId: 'song-A', duration: 200 },
      { index: 1, songId: 'song-B', duration: 200 },
    ]);

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();

    expect(submittedIds()).toEqual(['song-A']);
  });

  it('defers a threshold crossed before the probe resolves, then catches up', async () => {
    let resolveVerdict!: (v: boolean) => void;
    const verdict = new Promise<boolean>((r) => {
      resolveVerdict = r;
    });
    startTracker(() => verdict);
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    client.subsonicRequest.mockClear();

    // An undecided verdict defers without latching `submitted`, so a later verdict can submit.
    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual([]);

    resolveVerdict(true);
    await flush();
    expect(submittedIds()).toEqual(['song-A']);
  });

  it('a deferred verdict of notMine never submits', async () => {
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

  it('a verdict that resolves after a skip does not latch onto the new track', async () => {
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

    engine.fire({ kind: 'property', name: 'playlist-pos', data: 0 });
    await flush();
    engine.fire({ kind: 'property', name: 'playlist-pos', data: 1 });
    await flush();

    // Without the generation guard, A's stale 'notMine' would drop B's scrobble.
    resolveA(false);
    await flush();

    engine.fire({ kind: 'property', name: 'time-pos', data: 101 });
    await flush();
    expect(submittedIds()).toEqual(['song-B']);
  });

  it('a stale mine verdict does not override the new track notMine', async () => {
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

  it('a queue event that orphans an undecided verdict starts a new ownership check', async () => {
    let call = 0;
    startTracker(() => {
      call += 1;
      return call === 1 ? new Promise<boolean>(() => undefined) : Promise.resolve(true);
    });
    engine.setPlaylist([{ index: 0, songId: 'song-A', duration: 200 }]);

    // The flush lets hydrateAndStart track A, so the queue event orphans the probe, not the read.
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

/** The bus delivers every event and broadcast to both trackers in one order, as mpv does. */
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
