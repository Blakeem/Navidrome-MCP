/**
 * Pins the SSE dead-peer reaping. res.write() does NOT throw synchronously
 * when a peer's socket is gone (Node reports it via res.destroyed /
 * res.writableEnded), so the reaper must inspect those flags — an
 * exception-only check would let dead ServerResponse objects accumulate in the
 * client set for the process lifetime. These tests exercise the private
 * sendHeartbeat / writeToClient logic directly against fake responses.
 */

import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { SseBroadcaster } from '../../../src/webui/broadcaster.js';

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

/** Minimal ServerResponse stand-in: only the fields the reaper touches. */
function fakeRes(opts: FakeResOptions = {}): FakeRes {
  const writes: string[] = [];
  const res = {
    destroyed: opts.destroyed ?? false,
    writableEnded: opts.writableEnded ?? false,
    writableNeedDrain: opts.writableNeedDrain ?? false,
    writableLength: opts.writableLength ?? 0,
    destroyCalls: 0,
    writes,
    // res.write() returning false is backpressure, not death, so the reaper must
    // not treat it as a dead pipe. Returning false here pins that distinction.
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

// writableLength measured right after res.write() of a 10,000-track queue snapshot to a peer that reads normally.
const IN_FLIGHT_SNAPSHOT_BYTES = 1_779_012;

/** Reach the private members the reaping logic operates on. */
interface BroadcasterInternals {
  clients: Set<ServerResponse>;
  sendHeartbeat: () => void;
  writeToClient: (res: ServerResponse, json: string) => boolean;
  handleDrain: (res: ServerResponse) => void;
}

function internals(b: SseBroadcaster): BroadcasterInternals {
  return b as unknown as BroadcasterInternals;
}

function newBroadcaster(): SseBroadcaster {
  // The constructor only stashes the client; nothing here touches it.
  return new SseBroadcaster({} as never);
}

describe('SseBroadcaster dead-peer reaping', () => {
  it('sendHeartbeat drops a client whose socket is already destroyed (peer RST)', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const dead = fakeRes({ destroyed: true });
    const live = fakeRes();
    inner.clients.add(dead);
    inner.clients.add(live);

    inner.sendHeartbeat();

    expect(inner.clients.has(dead)).toBe(false);
    expect(inner.clients.has(live)).toBe(true);
  });

  it('sendHeartbeat drops a client whose writable side has ended', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const ended = fakeRes({ writableEnded: true });
    inner.clients.add(ended);

    inner.sendHeartbeat();

    expect(inner.clients.has(ended)).toBe(false);
  });

  it('sendHeartbeat keeps a live client even when write() reports backpressure', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const live = fakeRes();
    inner.clients.add(live);

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
    inner.clients.add(inFlight);

    inner.sendHeartbeat();

    expect(inner.clients.has(inFlight)).toBe(true);
    expect(inFlight.destroyCalls).toBe(0);
  });

  it('a drain sends only the newest held snapshot, once', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const res = fakeRes({ writableNeedDrain: true });
    inner.clients.add(res);
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
    inner.clients.add(stalled);

    inner.sendHeartbeat();
    inner.sendHeartbeat();

    expect(inner.clients.has(stalled)).toBe(false);
    expect(stalled.destroyCalls).toBe(1);
  });

  it('sendHeartbeat keeps a backlogged client that drained between heartbeats', () => {
    const b = newBroadcaster();
    const inner = internals(b);
    const slow = fakeRes({ writableNeedDrain: true });
    inner.clients.add(slow);

    inner.sendHeartbeat();
    inner.handleDrain(slow);
    inner.sendHeartbeat();

    expect(inner.clients.has(slow)).toBe(true);
    expect(slow.destroyCalls).toBe(0);
  });
});
