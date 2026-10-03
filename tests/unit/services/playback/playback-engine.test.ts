/**
 * Navidrome MCP Server - playback-engine unit tests
 * Copyright (C) 2025
 *
 * Covers behavioral changes from docs/review/02 batch C:
 *   - H3: installObservers ordering — prime cache BEFORE registering the
 *     property-change handler and BEFORE subscribing.
 *   - H4: getQueue filename → songId parsing is cached per session, with
 *     a cheap startsWith() prefilter to avoid `new URL()` for non-HTTP
 *     filenames.
 *   - M3: enqueue('replace') recovers to a clean idle state on partial
 *     failure mid-loadfile-loop instead of leaving the user with a
 *     half-loaded queue.
 *
 * IPC and net are mocked so no real mpv binary is touched. Real-mpv coverage
 * lives in tests/integration/playback/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { StateChangeEvent } from '../../../../src/services/playback/playback-engine.js';
import { MAX_QUEUE_READ_PAGES, QUEUE_READ_PAGE_SIZE } from '../../../../src/constants/defaults.js';
import { withPlatform } from '../../../helpers/platform.js';

interface FakeIpc extends EventEmitter {
  connect: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  observeProperty: ReturnType<typeof vi.fn>;
  onPropertyChange: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
  onDisconnect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  /** Internal: list of registered onPropertyChange handlers, in install order */
  propertyHandlers: Array<(evt: { id: number; name: string; data: unknown }) => void>;
  /** Internal: list of registered onEvent handlers, in install order */
  eventHandlers: Array<(evt: { event: string; [key: string]: unknown }) => void>;
  /** Internal: chronological log of (call_kind, name) tuples for ordering tests */
  callOrder: Array<{ kind: string; name?: string }>;
}

function makeFakeIpc(): FakeIpc {
  const ipc = new EventEmitter() as FakeIpc;
  ipc.propertyHandlers = [];
  ipc.eventHandlers = [];
  ipc.callOrder = [];
  ipc.connect = vi.fn().mockResolvedValue(undefined);
  ipc.isConnected = vi.fn().mockReturnValue(true);
  // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
  ipc.command = vi.fn(async (...args: unknown[]) => {
    const cmd = args[0] as string;
    if (cmd === 'get_property') {
      ipc.callOrder.push({ kind: 'get_property', name: args[1] as string });
      return null;
    }
    ipc.callOrder.push({ kind: cmd });
    return null;
  });
  // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC observeProperty interface
  ipc.observeProperty = vi.fn(async (_id: number, name: string) => {
    ipc.callOrder.push({ kind: 'observe', name });
    return undefined;
  });
  ipc.onPropertyChange = vi.fn((handler: (evt: { id: number; name: string; data: unknown }) => void) => {
    ipc.propertyHandlers.push(handler);
    ipc.callOrder.push({ kind: 'onPropertyChange' });
  });
  ipc.onEvent = vi.fn((handler: (evt: { event: string; [key: string]: unknown }) => void) => {
    ipc.eventHandlers.push(handler);
    ipc.callOrder.push({ kind: 'onEvent' });
  });
  ipc.onDisconnect = vi.fn(() => {
    ipc.callOrder.push({ kind: 'onDisconnect' });
  });
  ipc.close = vi.fn();
  return ipc;
}

const fakeIpcRef = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../../../../src/services/playback/mpv-ipc.js', () => ({
  MpvIpc: vi.fn(() => fakeIpcRef.value),
}));

vi.mock('../../../../src/services/playback/mpv-process.js', () => ({
  getDefaultIpcPath: () => '/tmp/test-fake.sock',
  spawnMpv: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn>; unref: () => void };
    child.kill = vi.fn();
    child.unref = (): void => undefined;
    return child;
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: () => true,
}));

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
}));

interface FakeNetSocket extends EventEmitter {
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

// A null outcome leaves the socket silent, so a test can emit its events by hand.
// Sockets are recorded here, since a fresh engine module gets a fresh createConnection mock.
const netState = vi.hoisted(() => ({
  outcome: null as 'connect' | 'error' | null,
  lastSocket: null as FakeNetSocket | null,
}));

vi.mock('node:net', () => ({
  createConnection: vi.fn(() => {
    const sock = new EventEmitter() as FakeNetSocket;
    sock.end = vi.fn();
    sock.destroy = vi.fn();
    netState.lastSocket = sock;
    const outcome = netState.outcome;
    if (outcome === 'connect') setImmediate(() => sock.emit('connect'));
    if (outcome === 'error') setImmediate(() => sock.emit('error', new Error('ECONNREFUSED')));
    return sock;
  }),
}));

const { playbackEngine } = await import('../../../../src/services/playback/playback-engine.js');
const { MpvIpc } = await import('../../../../src/services/playback/mpv-ipc.js');
const { spawnMpv } = await import('../../../../src/services/playback/mpv-process.js');
const { unlink } = await import('node:fs/promises');

const baseConfig = {
  navidromeUrl: 'http://navidrome.test',
  navidromeUsername: 'user',
  navidromePassword: 'pass',
  mpvPath: '/fake/mpv',
  playbackTranscodeFormat: 'mp3',
  playbackTranscodeBitrate: '192',
} as never;

beforeEach(() => {
  fakeIpcRef.value = makeFakeIpc();
  playbackEngine.configure(baseConfig);
});

afterEach(() => {
  playbackEngine.shutdown();
  netState.outcome = null;
  netState.lastSocket = null;
  vi.clearAllMocks();
});

// ---------- H3: installObservers ordering ----------

describe('installObservers ordering (H3)', () => {
  it('primes the property cache BEFORE registering the change handler and BEFORE subscribing', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;

    // ensureRunning will go through tryAttachExisting (existsSync mocked true)
    await playbackEngine.ensureRunning();

    // Pull just the ordering-relevant calls — get_property, onPropertyChange, observe
    const sequence = ipc.callOrder
      .map((c) => c.kind)
      .filter((k) => k === 'get_property' || k === 'onPropertyChange' || k === 'observe');

    // Find the indices of the marker calls
    const firstGetProp = sequence.indexOf('get_property');
    const onPropChange = sequence.indexOf('onPropertyChange');
    const firstObserve = sequence.indexOf('observe');

    // All three must have happened
    expect(firstGetProp).toBeGreaterThanOrEqual(0);
    expect(onPropChange).toBeGreaterThanOrEqual(0);
    expect(firstObserve).toBeGreaterThanOrEqual(0);

    // The required ordering: every get_property comes before onPropertyChange,
    // and onPropertyChange comes before every observe call.
    expect(firstGetProp).toBeLessThan(onPropChange);
    expect(onPropChange).toBeLessThan(firstObserve);

    // Last get_property is also before onPropertyChange (i.e. priming
    // FULLY completes before the handler is wired).
    const lastGetProp = sequence.lastIndexOf('get_property');
    expect(lastGetProp).toBeLessThan(onPropChange);
  });

  it('emits the attach event before observing, so it precedes the new mpv snapshot', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    playbackEngine.onStateChange((event) => {
      if (event.kind === 'attach') ipc.callOrder.push({ kind: 'attach-event' });
    });

    await playbackEngine.ensureRunning();

    const sequence = ipc.callOrder.map((c) => c.kind);
    expect(sequence.filter((k) => k === 'attach-event')).toHaveLength(1);
    expect(sequence.indexOf('attach-event')).toBeLessThan(sequence.indexOf('observe'));
  });
});

// ---------- client-message broadcast channel ----------

describe('client-message channel', () => {
  it('forwards an mpv client-message as a message state change', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    const events: StateChangeEvent[] = [];
    const unsubscribe = playbackEngine.onStateChange((event) => events.push(event));
    await playbackEngine.ensureRunning();
    events.length = 0;

    for (const handler of ipc.eventHandlers) {
      handler({ event: 'client-message', args: ['topic', 'key', 'claimant'] });
    }
    unsubscribe();

    expect(events).toEqual([{ kind: 'message', args: ['topic', 'key', 'claimant'] }]);
  });

  it('sends a broadcast as script-message', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();

    await playbackEngine.broadcastMessage(['topic', 'key', 'claimant']);

    expect(ipc.command).toHaveBeenCalledWith('script-message', 'topic', 'key', 'claimant');
  });

  it('rejects a broadcast without spawning mpv when none is attached', async () => {
    await expect(playbackEngine.broadcastMessage(['topic'])).rejects.toThrow('mpv IPC is not connected');
    expect(spawnMpv).not.toHaveBeenCalled();
  });
});

// ---------- H4: filename cache + cheap prefilter ----------

describe('getQueue filename caching (H4)', () => {
  it('caches the songId-from-filename parse across calls', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();

    const stableUrl = 'http://navidrome.test/rest/stream?id=song-123&u=x&s=y&t=z';

    // get_property for 'playlist' is what getQueue calls. Make it return
    // the same entry twice across two getQueue invocations.
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === 'get_property' && args[1] === 'playlist') {
        return [{ filename: stableUrl, current: true, playing: true }];
      }
      return null;
    });

    const r1 = await playbackEngine.getQueue();
    const r2 = await playbackEngine.getQueue();

    expect(r1[0]?.songId).toBe('song-123');
    expect(r2[0]?.songId).toBe('song-123');
    // Both reads return the same parsed id — a regression in cache logic
    // would either differ between the two calls (cache returning wrong
    // value) or throw on the second call (cache mishandling).
    expect(r1[0]?.songId).toBe(r2[0]?.songId);
  });

  it('does not re-parse identical filenames across distinct getQueue calls', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();

    const url = 'http://navidrome.test/rest/stream?id=hot-song';
    let callCount = 0;
    // Wrap URL to count constructions for our specific test URL only.
    const realUrl = globalThis.URL;
    let parseCount = 0;
    class CountingUrl extends realUrl {
      constructor(input: string | URL, base?: string | URL) {
        super(input as string, base as string);
        if (typeof input === 'string' && input === url) parseCount++;
      }
    }
    (globalThis as unknown as { URL: typeof URL }).URL = CountingUrl as unknown as typeof URL;

    try {
      // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
      ipc.command.mockImplementation(async (...args: unknown[]) => {
        if (args[0] === 'get_property' && args[1] === 'playlist') {
          callCount++;
          return [{ filename: url, current: true, playing: true }];
        }
        return null;
      });

      await playbackEngine.getQueue();
      const parseCountAfterFirst = parseCount;
      await playbackEngine.getQueue();
      await playbackEngine.getQueue();

      expect(callCount).toBe(3); // 3 IPC reads, since getQueue itself is not cached
      // Only the first call parses. Later calls reuse the songId from the filename cache.
      expect(parseCount).toBe(parseCountAfterFirst);
    } finally {
      (globalThis as unknown as { URL: typeof URL }).URL = realUrl;
    }
  });

  it('skips URL parsing entirely for non-HTTP filenames (cheap prefilter)', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();

    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === 'get_property' && args[1] === 'playlist') {
        return [
          { filename: '/music/rest/stream?id=5', current: false, playing: false },
          { filename: 'rtsp://radio.example/rest/stream?id=5', current: true, playing: true },
        ];
      }
      return null;
    });

    const urlSpy = vi.spyOn(globalThis, 'URL');
    urlSpy.mockClear();

    const result = await playbackEngine.getQueue();

    expect(result).toHaveLength(2);
    expect(result[0]?.songId).toBeNull();
    expect(result[1]?.songId).toBeNull();

    // Neither filename is HTTP, so the prefilter skips `new URL()`.
    expect(urlSpy).not.toHaveBeenCalled();
    await playbackEngine.getQueue();
    expect(urlSpy).not.toHaveBeenCalled();

    urlSpy.mockRestore();
  });

  it('handles malformed http URLs without throwing (cache hits null)', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();

    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === 'get_property' && args[1] === 'playlist') {
        return [{ filename: 'http://[invalid-bracket?id=1', current: true, playing: true }];
      }
      return null;
    });

    const result = await playbackEngine.getQueue();
    expect(result[0]?.songId).toBeNull();

    // Second call hits cache and stays null
    const result2 = await playbackEngine.getQueue();
    expect(result2[0]?.songId).toBeNull();
  });
});

// ---------- M3: enqueue('replace') rollback on partial failure ----------

describe("enqueue('replace') atomic recovery (M3)", () => {
  it('recovers to clean idle state when a mid-sequence loadfile fails', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    const events: StateChangeEvent[] = [];
    playbackEngine.onStateChange((e) => events.push(e));

    // Reset the call recorder so we only see commands from the test below
    ipc.command.mockReset();
    let loadfileCount = 0;
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === 'loadfile') {
        loadfileCount++;
        if (loadfileCount === 2) {
          throw new Error('mpv command error: file not found');
        }
        return null;
      }
      return null;
    });

    await expect(
      playbackEngine.enqueue(['song-1', 'song-2', 'song-3'], 'replace'),
    ).rejects.toThrow(/queue was cleared and is now empty/);

    // The failure path clears and stops after the failing loadfile, so mpv holds no half-loaded queue.
    const commands = ipc.command.mock.calls.map((c) => c[0] as string);
    expect(commands.slice(commands.lastIndexOf('loadfile') + 1)).toEqual(['playlist-clear', 'stop']);
    expect(playbackEngine.getCachedProperty('playlist-count')).toBe(0);
    expect(playbackEngine.getCachedProperty('playlist-pos')).toBeNull();
    expect(events).toContainEqual({ kind: 'queue' });
  });

  it('passes through the underlying error message in the wrapper', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockReset();
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'loadfile') throw new Error('network blip during stream open');
      return null;
    });

    await expect(playbackEngine.enqueue(['song-1'], 'replace')).rejects.toThrow(
      /network blip during stream open/,
    );
  });

  it('does not call stop when the entire sequence succeeds', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockReset();
    ipc.command.mockResolvedValue(null);

    await playbackEngine.enqueue(['song-1', 'song-2'], 'replace');

    const commands = ipc.command.mock.calls.map((c) => c[0] as string);
    expect(commands).toContain('playlist-clear');
    expect(commands).toContain('loadfile');
    expect(commands).not.toContain('stop');
  });
});

// ---------- radio → append demotion ----------

describe("enqueue('append') radio demotion", () => {
  it("demotes append to replace when the queue holds a radio stream", async () => {
    const ipc = fakeIpcRef.value as FakeIpc;

    // hasRadioStream() reads the live playlist. A single non-HTTP entry parses
    // to songId null, so the queue is seen as holding a radio stream.
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === 'get_property' && args[1] === 'playlist-count') return 1;
      if (cmd === 'get_property' && args[1] === 'playlist') {
        return [{ filename: 'rtsp://radio.example/stream', current: true, playing: true }];
      }
      return null;
    });

    await playbackEngine.ensureRunning();

    const result = await playbackEngine.enqueue(['song-1', 'song-2'], 'append');

    // The append was demoted to replace because a radio stream was present.
    expect(result).toEqual({ demoted: true });

    // Observe the effective mode the way the other tests do — via the issued
    // IPC commands. Replace-mode issues an explicit `playlist-clear`; a true
    // append never clears the playlist. So the presence of playlist-clear is
    // proof the effective mode became 'replace'.
    const commands = ipc.command.mock.calls.map((c) => c[0] as string);
    expect(commands).toContain('playlist-clear');
  });

  it("does NOT demote append when the queue holds only real songs", async () => {
    const ipc = fakeIpcRef.value as FakeIpc;

    // Every entry parses to a real songId (HTTP stream URL the engine built),
    // so hasRadioStream() returns false and append stays append.
    const songUrl = 'http://navidrome.test/rest/stream?id=song-existing&u=x&s=y&t=z';
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === 'get_property' && args[1] === 'playlist-count') return 1;
      if (cmd === 'get_property' && args[1] === 'playlist') {
        return [{ filename: songUrl, current: true, playing: true }];
      }
      return null;
    });

    await playbackEngine.ensureRunning();

    const result = await playbackEngine.enqueue(['song-1'], 'append');

    expect(result).toEqual({ demoted: false });
    // A genuine append never clears the playlist.
    const commands = ipc.command.mock.calls.map((c) => c[0] as string);
    expect(commands).not.toContain('playlist-clear');
  });

  it('demotes append onto radio before the cached playlist-count catches up', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {
      playlist: [{ filename: 'http://radio.example/live', current: true, playing: true }],
    });
    expect(playbackEngine.getCachedProperty('playlist-count')).toBeNull();

    const result = await playbackEngine.enqueue(['song-1'], 'append');

    expect(result).toEqual({ demoted: true });
  });
});

// ---------- Issue #4: moveQueueEntry never hijacks the play head ----------

describe('moveQueueEntry play-head preservation (Issue #4)', () => {
  it('issues only playlist-move — never set_property playlist-pos — for a from:0 move', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockClear();

    await playbackEngine.moveQueueEntry(0, 4);

    const moveCalls = ipc.command.mock.calls.filter((c) => c[0] === 'playlist-move');
    expect(moveCalls).toEqual([['playlist-move', 0, 4]]);

    // The bug was an explicit `set_property playlist-pos 0` that overrode mpv's
    // native play-head bookkeeping whenever index 0 was involved. mpv already
    // keeps the playing entry current across a move, so the override is gone.
    const posResets = ipc.command.mock.calls.filter(
      (c) => c[0] === 'set_property' && c[1] === 'playlist-pos',
    );
    expect(posResets).toHaveLength(0);
  });

  it('also leaves the play head alone for a to:0 move', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockClear();

    await playbackEngine.moveQueueEntry(3, 0);

    expect(ipc.command.mock.calls.filter((c) => c[0] === 'playlist-move')).toEqual([
      ['playlist-move', 3, 0],
    ]);
    const posResets = ipc.command.mock.calls.filter(
      (c) => c[0] === 'set_property' && c[1] === 'playlist-pos',
    );
    expect(posResets).toHaveLength(0);
  });
});

// ---------- Issue #5: shuffleQueue keeps the current track playing ----------

describe('shuffleQueue play-head preservation (Issue #5)', () => {
  it('lifts the post-shuffle current track to index 0 via playlist-move, not a playlist-pos reset', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    // After the shuffle, mpv reports the current track landed at index 3.
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'get_property' && args[1] === 'playlist-pos') return 3;
      return null;
    });

    await playbackEngine.shuffleQueue();

    const kinds = ipc.command.mock.calls.map((c) => c[0]);
    expect(kinds).toContain('playlist-shuffle');
    // Current track lifted to the top WITHOUT restarting playback.
    expect(ipc.command.mock.calls.filter((c) => c[0] === 'playlist-move')).toEqual([
      ['playlist-move', 3, 0],
    ]);
    // The old restart-the-head bug must be gone.
    const posResets = ipc.command.mock.calls.filter(
      (c) => c[0] === 'set_property' && c[1] === 'playlist-pos',
    );
    expect(posResets).toHaveLength(0);
  });

  it('does not move when the current track already shuffled to index 0', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'get_property' && args[1] === 'playlist-pos') return 0;
      return null;
    });

    await playbackEngine.shuffleQueue();

    expect(ipc.command.mock.calls.filter((c) => c[0] === 'playlist-move')).toHaveLength(0);
  });
});

/** Forget startup calls, then answer `get_property` from a fixed map and every other command with null. */
function answerProperties(ipc: FakeIpc, props: Record<string, unknown>): void {
  ipc.command.mockClear();
  // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
  ipc.command.mockImplementation(async (...args: unknown[]) => {
    if (args[0] === 'get_property') return props[args[1] as string] ?? null;
    return null;
  });
}

/** The issued IPC commands minus reads, with `set_property` folded to "set <name> <value>". */
function mutatingCommands(ipc: FakeIpc): string[] {
  return ipc.command.mock.calls
    .filter((c) => c[0] !== 'get_property')
    .map((c) => (c[0] === 'set_property' ? `set ${String(c[1])} ${String(c[2])}` : String(c[0])));
}

// ---------- append into a queue with no current track ----------

describe("enqueue('append') selects a first track when none is current", () => {
  it('selects index 0 paused when appending into an empty queue', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-pos': -1, 'playlist-count': 0 });

    await playbackEngine.enqueue(['song-1', 'song-2'], 'append');

    expect(mutatingCommands(ipc)).toEqual([
      'loadfile',
      'loadfile',
      'set pause true',
      'set playlist-pos 0',
    ]);
  });

  it('selects the first appended index when appending into a finished queue', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-pos': -1, 'playlist-count': 3 });

    await playbackEngine.enqueue(['song-4'], 'append');

    expect(mutatingCommands(ipc)).toEqual(['loadfile', 'set pause true', 'set playlist-pos 3']);
  });

  it('leaves pause and the play head alone when a track is current', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-pos': 1, 'playlist-count': 3 });

    await playbackEngine.enqueue(['song-4'], 'append');

    expect(mutatingCommands(ipc)).toEqual(['loadfile']);
  });
});

// ---------- shuffleQueueFromTop restarts the queue from the new top track ----------

describe('shuffleQueueFromTop', () => {
  it('shuffles and selects index 0 without touching pause while playing', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-count': 5, 'playlist-pos': 2, pause: false });
    const generationBefore = playbackEngine.getQueueGeneration();

    await playbackEngine.shuffleQueueFromTop();

    expect(mutatingCommands(ipc)).toEqual(['playlist-shuffle', 'set playlist-pos 0']);
    expect(playbackEngine.getQueueGeneration()).toBe(generationBefore + 1);
  });

  it('pauses before selecting index 0 while paused', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-count': 5, 'playlist-pos': 2, pause: true });

    await playbackEngine.shuffleQueueFromTop();

    expect(mutatingCommands(ipc)).toEqual(['playlist-shuffle', 'set pause true', 'set playlist-pos 0']);
  });

  it('pauses before selecting index 0 when no track is current', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-count': 3, 'playlist-pos': -1, pause: false });

    await playbackEngine.shuffleQueueFromTop();

    expect(mutatingCommands(ipc)).toEqual(['playlist-shuffle', 'set pause true', 'set playlist-pos 0']);
  });

  it('sends nothing for an empty queue', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-count': 0, 'playlist-pos': -1, pause: false });
    const generationBefore = playbackEngine.getQueueGeneration();

    await playbackEngine.shuffleQueueFromTop();

    expect(mutatingCommands(ipc)).toEqual([]);
    expect(playbackEngine.getQueueGeneration()).toBe(generationBefore);
  });
});

describe('clearQueue', () => {
  it('stops playback and raises the queue generation by one', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {});
    const generationBefore = playbackEngine.getQueueGeneration();

    await playbackEngine.clearQueue();

    expect(mutatingCommands(ipc)).toEqual(['stop']);
    expect(playbackEngine.getQueueGeneration()).toBe(generationBefore + 1);
  });
});

// ---------- setVolume clamps out-of-range levels to [0, 100] ----------

describe('setVolume clamps to [0, 100]', () => {
  it('clamps a level above 100 down to 100 and issues set_property volume 100', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockClear();

    const applied = await playbackEngine.setVolume(150);

    expect(applied).toBe(100);
    expect(ipc.command.mock.calls).toContainEqual(['set_property', 'volume', 100]);
  });

  it('clamps a negative level up to 0 and issues set_property volume 0', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockClear();

    const applied = await playbackEngine.setVolume(-5);

    expect(applied).toBe(0);
    expect(ipc.command.mock.calls).toContainEqual(['set_property', 'volume', 0]);
  });

  it('passes an in-range level through unchanged', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockClear();

    const applied = await playbackEngine.setVolume(42);

    expect(applied).toBe(42);
    expect(ipc.command.mock.calls).toContainEqual(['set_property', 'volume', 42]);
  });
});

// ---------- mpv-reconnect: ensureRunning re-attaches after an unexpected IPC drop ----------

describe('ensureRunning reconnect after unexpected disconnect (mpv-reconnect)', () => {
  it('re-attaches on the FIRST control call after an in-process IPC drop', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;

    // First start: engine attaches to the (fake) mpv IPC.
    await playbackEngine.ensureRunning();
    expect(playbackEngine.isRunning()).toBe(true);

    // Fire the disconnect handler the engine registered via installObservers
    // to simulate mpv dropping the IPC socket unexpectedly. That handler
    // clears the engine's ipc handle (this.ipc = null) without touching
    // startPromise.
    const disconnectHandler = ipc.onDisconnect.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(disconnectHandler).toBeTypeOf('function');
    disconnectHandler?.();

    // Engine now reports not-running (ipc handle gone).
    expect(playbackEngine.isRunning()).toBe(false);

    // The FIRST mutating control after the disconnect must transparently
    // re-attach. The bug left a stale settled startPromise, so this first
    // ensureRunning() no-op'd and requireIpc() threw "mpv IPC is not
    // connected"; only the second call reconnected. With the fix (finally
    // clears startPromise unconditionally), the first call reconnects.
    await expect(playbackEngine.pause()).resolves.toBeUndefined();
    expect(playbackEngine.isRunning()).toBe(true);
  });
});

// ---------- previous() on the first entry restarts instead of stopping ----------

describe('previous', () => {
  it('restarts the current track with an absolute seek on the first entry', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-pos': 0 });

    await playbackEngine.previous();

    expect(mutatingCommands(ipc)).toEqual(['seek']);
    expect(ipc.command.mock.calls).toContainEqual(['seek', 0, 'absolute']);
  });

  it('sends playlist-prev without force past the first entry', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-pos': 2 });

    await playbackEngine.previous();

    expect(ipc.command.mock.calls.filter((c) => c[0] === 'playlist-prev')).toEqual([['playlist-prev']]);
  });

  it('sends nothing when no entry is current', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-pos': -1 });

    await playbackEngine.previous();

    expect(mutatingCommands(ipc)).toEqual([]);
  });
});

// ---------- concurrent attaches share one connection ----------

describe('ensureAttached coalescing', () => {
  it('opens one connection for two concurrent ensureAttached calls', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;

    await Promise.all([playbackEngine.ensureAttached(), playbackEngine.ensureAttached()]);

    expect(playbackEngine.isRunning()).toBe(true);
    expect(ipc.connect).toHaveBeenCalledTimes(1);
    expect(ipc.onPropertyChange).toHaveBeenCalledTimes(1);
  });
});

// ---------- song ids come only from Subsonic stream URLs ----------

describe('getQueue song-id parsing', () => {
  it('yields songId null for a non-stream URL that carries an id parameter', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {
      playlist: [{ filename: 'http://radio.example/listen?id=42', current: true, playing: true }],
    });

    const entries = await playbackEngine.getQueue();

    expect(entries[0]?.songId).toBeNull();
    expect(entries[0]).not.toHaveProperty('filename');
  });
});

// ---------- stream URLs round-trip through getQueue ----------

describe('stream URL round trip', () => {
  function firstLoadfileUrl(ipc: FakeIpc): URL {
    const call = ipc.command.mock.calls.find((c) => c[0] === 'loadfile');
    return new URL(String(call?.[1]));
  }

  it('builds a transcode URL that getQueue parses back to the song id', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {});

    await playbackEngine.enqueue(['s1'], 'replace');
    const url = firstLoadfileUrl(ipc);

    expect(url.pathname).toBe('/rest/stream');
    expect(url.searchParams.get('id')).toBe('s1');
    expect(url.searchParams.get('format')).toBe('mp3');
    expect(url.searchParams.get('maxBitRate')).toBe('192');
    expect(url.searchParams.has('p')).toBe(false);
    answerProperties(ipc, { playlist: [{ filename: url.toString(), current: true, playing: true }] });
    expect((await playbackEngine.getQueue())[0]?.songId).toBe('s1');
  });

  it('builds a raw URL without maxBitRate', async () => {
    playbackEngine.configure({ ...(baseConfig as object), playbackTranscodeFormat: 'raw' } as never);
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {});

    await playbackEngine.enqueue(['s1'], 'replace');
    const url = firstLoadfileUrl(ipc);

    expect(url.searchParams.get('format')).toBe('raw');
    expect(url.searchParams.has('maxBitRate')).toBe(false);
    answerProperties(ipc, { playlist: [{ filename: url.toString(), current: true, playing: true }] });
    expect((await playbackEngine.getQueue())[0]?.songId).toBe('s1');
  });
});

// ---------- seek retries only the transient transcode rejection ----------

describe('seek retry', () => {
  const retryable = 'mpv command error: error running command';

  function failSeeks(ipc: FakeIpc, failures: number, message: string): () => number {
    let seekCalls = 0;
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      if (args[0] !== 'seek') return null;
      seekCalls++;
      if (seekCalls <= failures) throw new Error(message);
      return null;
    });
    return () => seekCalls;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient rejection until mpv accepts the seek', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    vi.useFakeTimers();
    const seekCalls = failSeeks(ipc, 2, retryable);

    const promise = playbackEngine.seek(10, 'absolute');
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBeUndefined();
    expect(seekCalls()).toBe(3);
  });

  it('rethrows any other error at once', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    vi.useFakeTimers();
    const seekCalls = failSeeks(ipc, Infinity, 'mpv command error: invalid parameter');

    await expect(playbackEngine.seek(10, 'absolute')).rejects.toThrow(/invalid parameter/);
    expect(seekCalls()).toBe(1);
  });

  it('gives up after four attempts', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    vi.useFakeTimers();
    const seekCalls = failSeeks(ipc, Infinity, retryable);

    const promise = playbackEngine.seek(10, 'absolute');
    const assertion = expect(promise).rejects.toThrow(/error running command/);
    await vi.advanceTimersByTimeAsync(750);

    await assertion;
    expect(seekCalls()).toBe(4);
  });
});

// ---------- the mutation lock serializes queue operations ----------

describe('mutation lock', () => {
  it('runs a radio load only after a concurrent replace finishes', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    ipc.command.mockClear();
    ipc.command.mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return null;
    });

    await Promise.all([
      playbackEngine.enqueue(['a', 'b', 'c'], 'replace'),
      playbackEngine.enqueueRadio('http://radio/x'),
    ]);

    const loadfiles = ipc.command.mock.calls.filter((c) => c[0] === 'loadfile').map((c) => c[1]);
    expect(loadfiles).toHaveLength(4);
    expect(loadfiles.at(-1)).toBe('http://radio/x');
  });

  it('keeps serving mutations after one fails', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    let loadfileCount = 0;
    // eslint-disable-next-line @typescript-eslint/require-await -- mock must match async IPC command interface
    ipc.command.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === 'loadfile' && ++loadfileCount === 2) throw new Error('mpv command error: file not found');
      return null;
    });
    await expect(playbackEngine.enqueue(['a', 'b'], 'replace')).rejects.toThrow(/file not found/);

    answerProperties(ipc, {});
    await expect(playbackEngine.clearQueue()).resolves.toBeUndefined();
    expect(mutatingCommands(ipc)).toEqual(['stop']);
  });
});

// ---------- getQueue merges mpv titles with enqueue metadata ----------

describe('getQueue metadata merge', () => {
  it('prefers the mpv title, fills the rest from the cache, and drops it on a replace', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {});
    const s1 = 'http://navidrome.test/rest/stream?id=s1';
    const s2 = 'http://navidrome.test/rest/stream?id=s2';

    await playbackEngine.enqueue(['s1', 's2'], 'replace', [
      { songId: 's1', title: 'T1', artist: 'A', album: 'B', duration: 200 },
      { songId: 's2', title: 'T2', duration: 0 },
    ]);
    answerProperties(ipc, {
      playlist: [
        { filename: s1, title: 'ICY', current: true, playing: true },
        { filename: s2, current: false, playing: false },
      ],
    });
    const [first, second] = await playbackEngine.getQueue();

    expect(first).toMatchObject({ title: 'ICY', artist: 'A', album: 'B', duration: 200 });
    expect(second?.title).toBe('T2');
    expect(second).not.toHaveProperty('duration');

    await playbackEngine.enqueue(['s1'], 'replace');
    answerProperties(ipc, { playlist: [{ filename: s1, current: true, playing: true }] });
    const [afterReplace] = await playbackEngine.getQueue();

    expect(afterReplace).not.toHaveProperty('artist');
  });
});

// ---------- caches hold a live queue longer than their cap ----------

describe('queue caches past the cap', () => {
  const cap = MAX_QUEUE_READ_PAGES * QUEUE_READ_PAGE_SIZE;
  const songIds = Array.from({ length: cap + 5 }, (_, i) => `s${i}`);
  const playlist = songIds.map((id, i) => ({
    filename: `http://navidrome.test/rest/stream?id=${id}`,
    current: i === 0,
    playing: i === 0,
  }));

  it('keeps back-filled metadata for every live entry', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { playlist });
    playbackEngine.ingestQueueMetadata(songIds.slice(0, cap).map((songId) => ({ songId, artist: 'A' })));

    const missing = (await playbackEngine.getQueue()).filter((e) => e.artist === undefined);
    playbackEngine.ingestQueueMetadata(missing.map((e) => ({ songId: e.songId ?? '', artist: 'A' })));
    const missingAfterBackFill = (await playbackEngine.getQueue()).filter((e) => e.artist === undefined);

    expect(missing).toHaveLength(5);
    expect(missingAfterBackFill).toHaveLength(0);
  });

  it('parses each live filename once', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { playlist });
    await playbackEngine.getQueue();
    const urlSpy = vi.spyOn(globalThis, 'URL');

    try {
      await playbackEngine.getQueue();
      expect(urlSpy).not.toHaveBeenCalled();
    } finally {
      urlSpy.mockRestore();
    }
  });
});

// ---------- spawn fallback when no mpv can be attached ----------

/** Queue one attach that fails and one spawn connect, so ensureRunning takes the spawn path. */
function queueSpawnPath(spawnConnects: boolean): { spawnFake: FakeIpc } {
  const attachFake = makeFakeIpc();
  attachFake.connect.mockRejectedValue(new Error('ENOENT'));
  const spawnFake = makeFakeIpc();
  if (!spawnConnects) spawnFake.connect.mockRejectedValue(new Error('spawn connect failed'));
  vi.mocked(MpvIpc)
    .mockImplementationOnce(() => attachFake as never)
    .mockImplementationOnce(() => spawnFake as never);
  return { spawnFake };
}

describe('spawn fallback', () => {
  it('kills the spawned mpv and resets state when its connect fails', async () => {
    netState.outcome = 'error';
    const { spawnFake } = queueSpawnPath(false);

    await expect(playbackEngine.ensureRunning()).rejects.toThrow(/spawn connect failed/);

    expect(spawnMpv).toHaveBeenCalledTimes(1);
    const child = vi.mocked(spawnMpv).mock.results[0]?.value;
    expect(child?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnFake.close).toHaveBeenCalled();
    expect(playbackEngine.isRunning()).toBe(false);
    expect(playbackEngine.getStatus().mpvVersion).toBeNull();
  });

  it('spawns mpv when nothing can be attached', async () => {
    netState.outcome = 'error';
    queueSpawnPath(true);

    await expect(playbackEngine.ensureRunning()).resolves.toBeUndefined();

    expect(spawnMpv).toHaveBeenCalledTimes(1);
    expect(playbackEngine.isRunning()).toBe(true);
  });
});

// ---------- the stale-socket probe guards the spawn ----------

describe('stale socket probe', () => {
  it('fails the start and keeps the socket when a live mpv answers the probe', async () => {
    const attachFake = makeFakeIpc();
    attachFake.connect.mockRejectedValue(new Error('mpv command timeout'));
    vi.mocked(MpvIpc).mockImplementationOnce(() => attachFake as never);
    netState.outcome = 'connect';

    await withPlatform('linux', async () => {
      await expect(playbackEngine.ensureRunning()).rejects.toThrow(/did not respond to IPC/);
    });

    expect(unlink).not.toHaveBeenCalled();
    expect(spawnMpv).not.toHaveBeenCalled();
  });

  it('unlinks a stale socket file before spawning', async () => {
    netState.outcome = 'error';
    queueSpawnPath(true);

    await withPlatform('linux', () => playbackEngine.ensureRunning());

    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith('/tmp/test-fake.sock');
  });
});

// ---------- state-change dispatch ----------

describe('onStateChange', () => {
  it('a throwing subscriber does not block later subscribers', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {});
    const events: StateChangeEvent[] = [];
    playbackEngine.onStateChange(() => {
      throw new Error('dead client');
    });
    playbackEngine.onStateChange((e) => events.push(e));

    await expect(playbackEngine.clearQueue()).resolves.toBeUndefined();

    expect(events).toContainEqual({ kind: 'queue' });
  });
});

// ---------- queue generation ----------

describe('queue generation', () => {
  it('rises by one on a replace', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {});
    const before = playbackEngine.getQueueGeneration();

    await playbackEngine.enqueue(['s'], 'replace');

    expect(playbackEngine.getQueueGeneration()).toBe(before + 1);
  });

  it('rises by one on a radio load', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, {});
    const before = playbackEngine.getQueueGeneration();

    await playbackEngine.enqueueRadio('http://r/x');

    expect(playbackEngine.getQueueGeneration()).toBe(before + 1);
  });

  it('stays the same on an append', async () => {
    const ipc = fakeIpcRef.value as FakeIpc;
    await playbackEngine.ensureRunning();
    answerProperties(ipc, { 'playlist-pos': 0, 'playlist-count': 1 });
    const before = playbackEngine.getQueueGeneration();

    await playbackEngine.enqueue(['s'], 'append');

    expect(playbackEngine.getQueueGeneration()).toBe(before);
  });
});

// ---------- quitMpv is bounded and best effort ----------

describe('quitMpv', () => {
  let engine: typeof playbackEngine;

  async function quitSocket(): Promise<FakeNetSocket> {
    for (let i = 0; i < 10 && netState.lastSocket === null; i++) await Promise.resolve();
    const sock = netState.lastSocket;
    if (sock === null) throw new Error('quitMpv opened no socket');
    return sock;
  }

  beforeEach(async () => {
    ({ engine } = await loadFreshEngine());
  });

  afterEach(() => {
    vi.useRealTimers();
    engine.shutdown();
  });

  it('sends quit on connect and resolves on close', async () => {
    const promise = engine.quitMpv();
    const sock = await quitSocket();

    sock.emit('connect');
    expect(sock.end).toHaveBeenCalledWith('{ "command": ["quit"] }\n');
    sock.emit('close');

    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves when nothing is listening', async () => {
    const promise = engine.quitMpv();
    const sock = await quitSocket();

    sock.emit('error', new Error('ENOENT'));

    await expect(promise).resolves.toBeUndefined();
  });

  it('gives up on a peer that never answers', async () => {
    vi.useFakeTimers();
    const promise = engine.quitMpv();
    const sock = await quitSocket();

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBeUndefined();
    expect(sock.destroy).toHaveBeenCalled();
  });
});

// ---------- hasControlledMpv gates the MCP exit quit ----------

describe('hasControlledMpv', () => {
  it('stays false through an attach and a read, then turns true on the first control call', async () => {
    // The flag is never cleared, so a fresh module gives a fresh singleton.
    vi.resetModules();
    const { playbackEngine: freshEngine } = await import('../../../../src/services/playback/playback-engine.js');
    freshEngine.configure(baseConfig);

    try {
      await freshEngine.ensureAttached();
      await freshEngine.getQueue();
      expect(freshEngine.isRunning()).toBe(true);
      expect(freshEngine.hasControlledMpv()).toBe(false);

      await freshEngine.pause();
      expect(freshEngine.hasControlledMpv()).toBe(true);
    } finally {
      freshEngine.shutdown();
    }
  });
});

// ---------- quitMpv during an in-flight start ----------

/** quitMpv latches its quit for the life of the engine, so a test that calls it needs a fresh singleton. */
async function loadFreshEngine(): Promise<{
  engine: typeof playbackEngine;
  freshMpvIpc: typeof MpvIpc;
  freshSpawnMpv: typeof spawnMpv;
}> {
  vi.resetModules();
  const { playbackEngine: engine } = await import('../../../../src/services/playback/playback-engine.js');
  const { MpvIpc: freshMpvIpc } = await import('../../../../src/services/playback/mpv-ipc.js');
  const { spawnMpv: freshSpawnMpv } = await import('../../../../src/services/playback/mpv-process.js');
  engine.configure(baseConfig);
  return { engine, freshMpvIpc, freshSpawnMpv };
}

describe('quitMpv during a start', () => {
  it('counts a spawn still connecting as control and kills it on quit', async () => {
    const { engine, freshMpvIpc, freshSpawnMpv } = await loadFreshEngine();
    const attachFake = makeFakeIpc();
    attachFake.connect.mockRejectedValue(new Error('ENOENT'));
    const spawnFake = makeFakeIpc();
    let failSpawnConnect: (err: Error) => void = () => undefined;
    spawnFake.connect.mockReturnValue(new Promise<void>((_resolve, reject) => { failSpawnConnect = reject; }));
    vi.mocked(freshMpvIpc)
      .mockImplementationOnce(() => attachFake as never)
      .mockImplementationOnce(() => spawnFake as never);
    netState.outcome = 'error';

    try {
      const start = engine.ensureRunning();
      await vi.waitFor(() => { expect(freshSpawnMpv).toHaveBeenCalledTimes(1); });
      const child = vi.mocked(freshSpawnMpv).mock.results[0]?.value;
      expect(engine.hasControlledMpv()).toBe(true);

      const quit = engine.quitMpv();
      expect(child?.kill).toHaveBeenCalledWith('SIGTERM');
      failSpawnConnect(new Error('mpv exited'));

      await expect(start).rejects.toThrow(/mpv exited/);
      await expect(quit).resolves.toBeUndefined();
      expect(engine.hasControlledMpv()).toBe(false);
    } finally {
      engine.shutdown();
    }
  });

  it('refuses to spawn once quit has begun', async () => {
    const { engine, freshMpvIpc, freshSpawnMpv } = await loadFreshEngine();
    const attachFake = makeFakeIpc();
    let failAttach: (err: Error) => void = () => undefined;
    attachFake.connect.mockReturnValue(new Promise<void>((_resolve, reject) => { failAttach = reject; }));
    vi.mocked(freshMpvIpc).mockImplementationOnce(() => attachFake as never);
    netState.outcome = 'error';

    try {
      const start = engine.ensureRunning();
      await vi.waitFor(() => { expect(attachFake.connect).toHaveBeenCalled(); });
      await engine.quitMpv();
      failAttach(new Error('ENOENT'));

      await expect(start).rejects.toThrow(/playback engine is quitting/);
      expect(freshSpawnMpv).not.toHaveBeenCalled();
    } finally {
      engine.shutdown();
    }
  });
});
