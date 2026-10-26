// res.write() does not throw for a dead peer, so an exception-only check would let dead responses
// accumulate in the client set. These tests drive the private reaper against fake responses.

import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { StateChangeEvent } from '../../../src/services/playback/playback-engine.js';
import { logger } from '../../../src/utils/logger.js';
import { setTheme, setVisualizer } from '../../../src/web/player-runtime.js';
import { SseBroadcaster } from '../../../src/webui/broadcaster.js';
import { GuestQueue } from '../../../src/webui/jukebox/guest-queue.js';

const playbackReads = vi.hoisted(() => ({
  nowPlaying: vi.fn(),
  getPlayQueueEntries: vi.fn(),
  toPlayQueueResult: (entries: unknown[]) => ({ items: entries, length: entries.length }),
  playbackStatus: vi.fn(),
}));

vi.mock('../../../src/tools/playback.js', () => playbackReads);

interface FakeResOptions {
  destroyed?: boolean;
  writableEnded?: boolean;
  writableNeedDrain?: boolean;
  writableLength?: number;
}

type FakeRes = ServerResponse & {
  destroyCalls: number;
  writes: string[];
  writableNeedDrain: boolean;
};

function fakeRes(opts: FakeResOptions = {}): FakeRes {
  const writes: string[] = [];
  const res = {
    destroyed: opts.destroyed ?? false,
    writableEnded: opts.writableEnded ?? false,
    writableNeedDrain: opts.writableNeedDrain ?? false,
    writableLength: opts.writableLength ?? 0,
    destroyCalls: 0,
    writes,
    // write() always returns false, so a test fails if a false return is read as a dead peer.
    write(chunk: string): boolean {
      writes.push(chunk);
      return false;
    },
    destroy(): void {
      res.destroyCalls += 1;
      res.destroyed = true;
    },
  };
  return res as unknown as FakeRes;
}

// writableLength measured right after res.write() of a 10,000-track queue snapshot to a peer
// that reads normally.
const IN_FLIGHT_SNAPSHOT_BYTES = 1_779_012;

const HOST_VIEW = { kind: 'host' } as const;

interface BroadcasterInternals {
  clients: Map<ServerResponse, unknown>;
  sendHeartbeat: () => void;
  writeToClient: (res: ServerResponse, json: string) => boolean;
  handleDrain: (res: ServerResponse) => void;
  handleEvent: (evt: StateChangeEvent) => void;
  broadcast: () => Promise<void>;
}

function internals(b: SseBroadcaster): BroadcasterInternals {
  return b as unknown as BroadcasterInternals;
}

function newBroadcaster(guests = new GuestQueue()): SseBroadcaster {
  // The mocked playback reads ignore the client, so an empty object stands in.
  return new SseBroadcaster({} as never, guests);
}

describe('SseBroadcaster dead-peer reaping', () => {
  it('sendHeartbeat drops a client whose socket is already destroyed (peer RST)', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const dead = fakeRes({ destroyed: true });
    const live = fakeRes();
    inner.clients.set(dead, HOST_VIEW);
    inner.clients.set(live, HOST_VIEW);

    inner.sendHeartbeat();

    expect(inner.clients.has(dead)).toBe(false);
    expect(inner.clients.has(live)).toBe(true);
  });

  it('sendHeartbeat drops a client whose writable side has ended', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const ended = fakeRes({ writableEnded: true });
    inner.clients.set(ended, HOST_VIEW);

    inner.sendHeartbeat();

    expect(inner.clients.has(ended)).toBe(false);
  });

  it('sendHeartbeat keeps a live client even when write() reports backpressure', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const live = fakeRes();
    inner.clients.set(live, HOST_VIEW);

    inner.sendHeartbeat();

    expect(inner.clients.has(live)).toBe(true);
  });

  it('writeToClient reports failure for a destroyed socket instead of a phantom success', () => {
    const b = newBroadcaster();
    expect(internals(b).writeToClient(fakeRes({ destroyed: true }), '{}')).toBe(false);
  });

  it('writeToClient reports failure for a socket whose writable side has ended', () => {
    const b = newBroadcaster();
    expect(internals(b).writeToClient(fakeRes({ writableEnded: true }), '{}')).toBe(false);
  });

  it('writeToClient reports success for a live socket (backpressure is not death)', () => {
    const b = newBroadcaster();
    expect(internals(b).writeToClient(fakeRes(), '{}')).toBe(true);
  });
});

describe('SseBroadcaster backlogged peers', () => {
  it('writeToClient holds a snapshot while one above 1 MiB is still in flight, and keeps the client', () => {
    const b = newBroadcaster();
    const inFlight = fakeRes({ writableNeedDrain: true, writableLength: IN_FLIGHT_SNAPSHOT_BYTES });

    expect(internals(b).writeToClient(inFlight, '{}')).toBe(true);
    expect(inFlight.writes).toEqual([]);
    expect(inFlight.destroyCalls).toBe(0);
  });

  it('sendHeartbeat keeps a client whose one snapshot above 1 MiB is still in flight', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const inFlight = fakeRes({ writableNeedDrain: true, writableLength: IN_FLIGHT_SNAPSHOT_BYTES });
    inner.clients.set(inFlight, HOST_VIEW);

    inner.sendHeartbeat();

    expect(inner.clients.has(inFlight)).toBe(true);
    expect(inFlight.destroyCalls).toBe(0);
  });

  it('a drain sends only the newest held snapshot, once', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const res = fakeRes({ writableNeedDrain: true });
    inner.clients.set(res, HOST_VIEW);
    inner.writeToClient(res, '{"v":1}');
    inner.writeToClient(res, '{"v":2}');

    res.writableNeedDrain = false;
    inner.handleDrain(res);
    inner.handleDrain(res);

    expect(res.writes).toEqual(['event: snapshot\ndata: {"v":2}\n\n']);
  });

  it('sendHeartbeat destroys and drops a client still backlogged with no drain since the previous heartbeat', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const stalled = fakeRes({ writableNeedDrain: true });
    inner.clients.set(stalled, HOST_VIEW);

    inner.sendHeartbeat();
    inner.sendHeartbeat();

    expect(inner.clients.has(stalled)).toBe(false);
    expect(stalled.destroyCalls).toBe(1);
  });

  it('sendHeartbeat keeps a backlogged client that drained between heartbeats', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const slow = fakeRes({ writableNeedDrain: true });
    inner.clients.set(slow, HOST_VIEW);

    inner.sendHeartbeat();
    inner.handleDrain(slow);
    inner.sendHeartbeat();

    expect(inner.clients.has(slow)).toBe(true);
    expect(slow.destroyCalls).toBe(0);
  });
});

describe('SseBroadcaster heartbeat tasks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs every task on each beat, and a throwing task stops neither the others nor the reaper', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const counted = vi.fn();
    b.addHeartbeatTask(() => { throw new Error('sweep failed'); });
    b.addHeartbeatTask(counted);
    const dead = fakeRes({ destroyed: true });
    inner.clients.set(dead, HOST_VIEW);

    inner.sendHeartbeat();
    inner.sendHeartbeat();

    expect(counted).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('webui: heartbeat task failed:', expect.objectContaining({ message: 'sweep failed' }));
    expect(inner.clients.has(dead)).toBe(false);
  });
});

describe('SseBroadcaster event throttle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function spyBroadcast(b: SseBroadcaster): MockInstance<() => Promise<void>> {
    return vi.spyOn(b as unknown as { broadcast: () => Promise<void> }, 'broadcast').mockResolvedValue(undefined);
  }

  it('sends a property event inside the window as one trailing broadcast', () => {
    vi.useFakeTimers();
    const b = newBroadcaster();
    const broadcast = spyBroadcast(b);

    internals(b).handleEvent({ kind: 'property', name: 'time-pos', data: 1 });
    expect(broadcast).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);
    internals(b).handleEvent({ kind: 'property', name: 'pause', data: true });
    expect(broadcast).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(700);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('broadcasts a queue event at once and cancels the pending trailing broadcast', () => {
    vi.useFakeTimers();
    const b = newBroadcaster();
    const broadcast = spyBroadcast(b);

    internals(b).handleEvent({ kind: 'property', name: 'time-pos', data: 1 });
    internals(b).handleEvent({ kind: 'property', name: 'time-pos', data: 2 });
    internals(b).handleEvent({ kind: 'queue' });
    expect(broadcast).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('broadcasts nothing for an attach event', () => {
    const b = newBroadcaster();
    const broadcast = spyBroadcast(b);

    internals(b).handleEvent({ kind: 'attach' });

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('broadcasts nothing for an mpv client message', () => {
    const b = newBroadcaster();
    const broadcast = spyBroadcast(b);

    internals(b).handleEvent({ kind: 'message', args: ['navidrome-mcp-scrobble-claim', '1:song', 'id'] });

    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('SseBroadcaster snapshot reads', () => {
  it('skips the write when every read fails and ships nulls when only some fail', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const res = fakeRes();
    inner.clients.set(res, HOST_VIEW);
    playbackReads.nowPlaying.mockRejectedValue(new Error('mpv unreachable'));
    playbackReads.getPlayQueueEntries.mockRejectedValue(new Error('mpv unreachable'));
    playbackReads.playbackStatus.mockRejectedValue(new Error('mpv unreachable'));

    await inner.broadcast();
    expect(res.writes).toEqual([]);

    playbackReads.nowPlaying.mockResolvedValue({ title: 't' });
    await inner.broadcast();
    expect(res.writes).toHaveLength(1);
    expect(res.writes[0]).toContain('"queue":null');
    expect(res.writes[0]).toContain('"status":null');
  });

  it('sends status without mpvPath, mpvVersion or the audio device and keeps the fields the browser reads', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const res = fakeRes();
    inner.clients.set(res, HOST_VIEW);
    playbackReads.nowPlaying.mockResolvedValue({ title: 't' });
    playbackReads.getPlayQueueEntries.mockResolvedValue([]);
    playbackReads.playbackStatus.mockResolvedValue({
      engineRunning: true,
      mpvPath: 'C:\\Users\\alice\\mpv\\mpv.exe',
      mpvVersion: 'mpv 0.38.0',
      volume: 70,
      idle: false,
      audioDevice: { id: 'wasapi/{speaker}', name: 'Speakers', connected: true },
      audioOutputLost: false,
    });

    await inner.broadcast();

    expect(res.writes).toHaveLength(1);
    expect(res.writes[0]).not.toContain('mpvPath');
    expect(res.writes[0]).not.toContain('mpvVersion');
    expect(res.writes[0]).not.toContain('alice');
    expect(res.writes[0]).not.toContain('audioDevice');
    expect(res.writes[0]).not.toContain('wasapi/{speaker}');
    expect(res.writes[0]).not.toContain('Speakers');
    expect(res.writes[0]).toContain('"status":{"engineRunning":true,"volume":70,"idle":false,"audioOutputLost":false}');
  });
});

describe('SseBroadcaster build ordering', () => {
  it('runs one build at a time and coalesces requests during it into one newer rebuild', async () => {
    const b = newBroadcaster();
    const res = fakeRes();
    internals(b).clients.set(res, HOST_VIEW);
    let releaseFirstBuild: (value: unknown) => void = () => undefined;
    playbackReads.nowPlaying.mockReset();
    playbackReads.nowPlaying
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirstBuild = resolve; }))
      .mockResolvedValueOnce({ title: 'after clear' });
    playbackReads.getPlayQueueEntries.mockResolvedValue([]);
    playbackReads.playbackStatus.mockResolvedValue({ engineRunning: true });

    b.broadcastNow();
    b.broadcastNow();
    b.broadcastNow();
    releaseFirstBuild({ title: 'before clear' });

    await vi.waitFor(() => { expect(res.writes).toHaveLength(2); });
    expect(playbackReads.nowPlaying).toHaveBeenCalledTimes(2);
    expect(res.writes[0]).toContain('before clear');
    expect(res.writes[1]).toContain('after clear');
  });
});

describe('SseBroadcaster guest clients', () => {
  const JUKEBOX = { label: 'Guest 1', nickname: 'Ana', expiresAt: 1_800_000_000_000, joinedAt: 1_700_000_000_000 };

  function primeReads(): void {
    playbackReads.nowPlaying.mockResolvedValue({
      engineRunning: true, queueIndex: 0, queueLength: 1, paused: false, position: 12, duration: 200,
      songId: 'so-1', title: 'T', artist: 'A', album: 'Al', radioStation: { name: 'never sent' },
    });
    playbackReads.getPlayQueueEntries.mockResolvedValue([
      { index: 0, entryId: 7, songId: 'so-1', title: 'T', artist: 'A', album: 'Al', duration: 200, isCurrent: true, isPlaying: true },
    ]);
    playbackReads.playbackStatus.mockResolvedValue({ engineRunning: true, volume: 70, idle: false, audioOutputLost: false });
  }

  function snapshotOf(res: FakeRes): Record<string, unknown> {
    const frame = res.writes.find((chunk) => chunk.startsWith('event: snapshot'));
    if (frame === undefined) throw new Error('no snapshot written');
    return JSON.parse(frame.slice(frame.indexOf('data: ') + 6)) as Record<string, unknown>;
  }

  it('sends a guest the reduced snapshot with its own jukebox field, and the host the full one', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const host = fakeRes();
    const guest = fakeRes();
    inner.clients.set(host, HOST_VIEW);
    inner.clients.set(guest, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    primeReads();

    await inner.broadcast();

    expect(snapshotOf(guest)).toEqual({
      nowPlaying: {
        engineRunning: true, queueIndex: 0, queueLength: 1, paused: false, position: 12, duration: 200,
        songId: 'so-1', title: 'T', artist: 'A', album: 'Al',
      },
      queue: { items: [{ index: 0, entryId: 7, songId: 'so-1', title: 'T', artist: 'A', duration: 200, isCurrent: true, mine: false }], length: 1 },
      visualizer: true,
      theme: null,
      jukebox: { ...JUKEBOX, limit: 3, remaining: 3 },
    });
    expect(snapshotOf(host)).toMatchObject({ status: { volume: 70 }, queue: { length: 1 } });
    expect(snapshotOf(host)).toHaveProperty('player');
  });

  it('gives each guest its own jukebox field on one shared reduced snapshot', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const first = fakeRes();
    const second = fakeRes();
    const secondJukebox = { label: 'Guest 2', nickname: null, expiresAt: 1_800_000_000_000, joinedAt: 1_700_000_000_500 };
    inner.clients.set(first, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    inner.clients.set(second, { kind: 'guest', sessionId: 'session-1', jukebox: () => secondJukebox });
    primeReads();

    await inner.broadcast();

    const { jukebox: firstSeen, ...firstBase } = snapshotOf(first);
    const { jukebox: secondSeen, ...secondBase } = snapshotOf(second);
    expect(firstSeen).toEqual({ ...JUKEBOX, limit: 3, remaining: 3 });
    expect(secondSeen).toEqual({ ...secondJukebox, limit: 3, remaining: 3 });
    expect(secondBase).toEqual(firstBase);
  });

  it("marks only a guest's own unplayed songs, counts its slots, and names the guest on the host queue", async () => {
    const guests = new GuestQueue({ isRunning: () => true } as never, () => 2);
    guests.ledger.record(8, { sessionId: 'session-1', song: { songId: 'so-2' }, guestLabel: 'Ana', addedAt: 0 });
    const b = newBroadcaster(guests);
    const inner = internals(b);
    const host = fakeRes();
    const owner = fakeRes();
    const other = fakeRes();
    inner.clients.set(host, HOST_VIEW);
    inner.clients.set(owner, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    inner.clients.set(other, { kind: 'guest', sessionId: 'session-2', jukebox: () => JUKEBOX });
    primeReads();
    playbackReads.getPlayQueueEntries.mockResolvedValue([
      { index: 0, entryId: 7, songId: 'so-1', isCurrent: true, isPlaying: true },
      { index: 1, entryId: 8, songId: 'so-2', isCurrent: false, isPlaying: false },
    ]);

    await inner.broadcast();

    expect(snapshotOf(owner)).toMatchObject({
      queue: { items: [{ entryId: 7, mine: false }, { entryId: 8, mine: true }] },
      jukebox: { limit: 2, remaining: 1 },
    });
    expect(snapshotOf(other)).toMatchObject({
      queue: { items: [{ entryId: 7, mine: false }, { entryId: 8, mine: false }] },
      jukebox: { limit: 2, remaining: 2 },
    });
    const hostItems = (snapshotOf(host)['queue'] as { items: Array<Record<string, unknown>> }).items;
    expect(hostItems[0]).toMatchObject({ entryId: 7 });
    expect(hostItems[0]).not.toHaveProperty('guestLabel');
    expect(hostItems[0]).not.toHaveProperty('guestWaiting');
    expect(hostItems[1]).toMatchObject({ entryId: 8, guestLabel: 'Ana', guestWaiting: true });
    for (const guestView of [owner, other]) {
      const guestItems = (snapshotOf(guestView)['queue'] as { items: Array<Record<string, unknown>> }).items;
      for (const item of guestItems) {
        expect(item).not.toHaveProperty('guestLabel');
        expect(item).not.toHaveProperty('guestWaiting');
      }
    }
  });

  it('names the guest of a started song on the host queue but no longer counts it as waiting', async () => {
    const guests = new GuestQueue({ isRunning: () => true } as never);
    guests.ledger.record(7, { sessionId: 'session-1', song: { songId: 'so-1' }, guestLabel: 'Ana', addedAt: 0 });
    guests.ledger.reconcile([{ index: 0, entryId: 7, songId: 'so-1', isCurrent: true, isPlaying: true }], false, 1, {
      generation: 0,
      pending: false,
      generationBeforeRead: 0,
    });
    const b = newBroadcaster(guests);
    const inner = internals(b);
    const host = fakeRes();
    inner.clients.set(host, HOST_VIEW);
    primeReads();
    playbackReads.getPlayQueueEntries.mockResolvedValue([{ index: 0, entryId: 7, songId: 'so-1', isCurrent: true, isPlaying: true }]);

    await inner.broadcast();

    const [item] = (snapshotOf(host)['queue'] as { items: Array<Record<string, unknown>> }).items;
    expect(item).toMatchObject({ entryId: 7, guestLabel: 'Ana' });
    expect(item).not.toHaveProperty('guestWaiting');
  });

  it("resends the queue to a guest whose own songs changed while the queue stayed the same", async () => {
    const guests = new GuestQueue({ isRunning: () => true } as never);
    const b = newBroadcaster(guests);
    const inner = internals(b);
    const owner = fakeRes();
    const other = fakeRes();
    inner.clients.set(owner, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    inner.clients.set(other, { kind: 'guest', sessionId: 'session-2', jukebox: () => JUKEBOX });
    primeReads();

    await inner.broadcast();
    guests.ledger.record(7, { sessionId: 'session-1', song: { songId: 'so-1' }, guestLabel: 'Ana', addedAt: 0 });
    await inner.broadcast();

    expect(snapshotsOf(owner)[1]).toHaveProperty('queue.items.0.mine', true);
    expect(snapshotsOf(other)[1]).not.toHaveProperty('queue');
  });

  it('tells a guest the visualizer is off when the host turned it off', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const guest = fakeRes();
    inner.clients.set(guest, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    primeReads();
    setVisualizer(false);

    try {
      await inner.broadcast();
    } finally {
      setVisualizer(true);
    }

    expect(snapshotOf(guest)).toMatchObject({ visualizer: false });
  });

  it('sends a guest the host forced theme', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const guest = fakeRes();
    inner.clients.set(guest, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    primeReads();
    setTheme('light');

    try {
      await inner.broadcast();
    } finally {
      setTheme(null);
    }

    expect(snapshotOf(guest)).toMatchObject({ theme: 'light' });
  });

  function snapshotsOf(res: FakeRes): Array<Record<string, unknown>> {
    return res.writes
      .filter((chunk) => chunk.startsWith('event: snapshot'))
      .map((chunk) => JSON.parse(chunk.slice(chunk.indexOf('data: ') + 6)) as Record<string, unknown>);
  }

  it('sends a guest the queue only when it differs from the last queue that guest received', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const guest = fakeRes();
    inner.clients.set(guest, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    primeReads();

    await inner.broadcast();
    await inner.broadcast();
    playbackReads.getPlayQueueEntries.mockResolvedValue([]);
    await inner.broadcast();
    const late = fakeRes();
    inner.clients.set(late, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    await inner.broadcast();

    const frames = snapshotsOf(guest);
    expect(frames[0]).toHaveProperty('queue.length', 1);
    expect(frames[1]).not.toHaveProperty('queue');
    expect(frames[1]).toHaveProperty('nowPlaying.position', 12);
    expect(frames[2]).toHaveProperty('queue', { items: [], length: 0 });
    expect(frames[3]).not.toHaveProperty('queue');
    expect(snapshotsOf(late)[0]).toHaveProperty('queue', { items: [], length: 0 });
  });

  it('keeps a queue change for a backlogged guest when a newer frame replaces the held one', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const guest = fakeRes();
    inner.clients.set(guest, { kind: 'guest', sessionId: 'session-1', jukebox: () => JUKEBOX });
    primeReads();
    await inner.broadcast();

    guest.writableNeedDrain = true;
    playbackReads.getPlayQueueEntries.mockResolvedValue([]);
    await inner.broadcast();
    await inner.broadcast();
    guest.writableNeedDrain = false;
    inner.handleDrain(guest);
    await inner.broadcast();

    const frames = snapshotsOf(guest);
    expect(frames).toHaveLength(3);
    expect(frames[1]).toHaveProperty('queue', { items: [], length: 0 });
    expect(frames[2]).not.toHaveProperty('queue');
  });

  it('drops and destroys a guest client whose session ended', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const guest = fakeRes();
    inner.clients.set(guest, { kind: 'guest', sessionId: 'session-1', jukebox: () => null });
    primeReads();

    await inner.broadcast();

    expect(guest.writes.some((chunk) => chunk.startsWith('event: snapshot'))).toBe(false);
    expect(guest.destroyCalls).toBe(1);
    expect(inner.clients.has(guest)).toBe(false);
  });

  it('drops a guest stream ended with a last event without destroying it, so its ended frame still flushes', async () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const ended = fakeRes({ writableEnded: true, writableNeedDrain: true });
    inner.clients.set(ended, { kind: 'guest', sessionId: 'session-1', jukebox: () => null });
    primeReads();

    await inner.broadcast();

    expect(ended.writes).toHaveLength(0);
    expect(ended.destroyCalls).toBe(0);
    expect(inner.clients.has(ended)).toBe(false);
  });
});
