import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSE_END_FLUSH_GRACE_MS } from '../../../src/webui/http-helpers.js';
import {
  MAX_OPEN_STREAMS,
  STREAM_EVICTED_EVENT,
  STREAMS_PER_ADDRESS,
  STREAMS_PER_SESSION_ROUTE,
  StreamLimiter,
  type StreamRoute,
} from '../../../src/webui/stream-limiter.js';

const EVICTED_FRAME = `event: ${STREAM_EVICTED_EVENT}\ndata: {}\n\n`;

class FakeStream extends EventEmitter {
  destroyed = false;
  ended = false;
  // A backlogged peer never flushes the frames queued before end(), so its stream does not close on its own.
  backlogged = false;
  readonly written: string[] = [];
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
  end(chunk: string): this {
    this.written.push(chunk);
    this.ended = true;
    if (!this.backlogged) this.destroy();
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

function fake(): FakeStream {
  return new FakeStream();
}

function admit(limiter: StreamLimiter, stream: FakeStream, route: StreamRoute, sessionId: string | null, address = '192.168.1.50'): boolean {
  return limiter.admit(stream as unknown as ServerResponse, route, sessionId, address);
}

/** Opens `count` streams and returns them oldest first. */
function openMany(limiter: StreamLimiter, count: number, route: StreamRoute, sessionId: string | null, address?: string): FakeStream[] {
  return Array.from({ length: count }, () => {
    const stream = fake();
    admit(limiter, stream, route, sessionId, address);
    return stream;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('StreamLimiter per-session cap', () => {
  it('closes the oldest stream of the session on the same route when a fourth opens', () => {
    const limiter = new StreamLimiter();
    const streams = openMany(limiter, STREAMS_PER_SESSION_ROUTE + 1, '/api/events', 'ana');

    expect(streams.map((stream) => stream.destroyed)).toEqual([true, false, false, false]);
  });

  it('sends the evicted event before it closes the oldest stream', () => {
    const limiter = new StreamLimiter();
    const streams = openMany(limiter, STREAMS_PER_SESSION_ROUTE + 1, '/api/events', 'ana');

    expect(streams[0]?.written).toEqual([EVICTED_FRAME]);
    expect(streams[1]?.written).toEqual([]);
  });

  it('closes the next oldest stream as each further stream opens', () => {
    const limiter = new StreamLimiter();
    const streams = openMany(limiter, STREAMS_PER_SESSION_ROUTE + 2, '/api/events', 'ana');

    expect(streams.map((stream) => stream.destroyed)).toEqual([true, true, false, false, false]);
  });

  it('counts each route of the session on its own', () => {
    const limiter = new StreamLimiter();
    const events = openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'ana');
    const guestEvents = openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/guest/events', 'ana');
    const visualizer = openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/visualizer', 'ana');

    expect([...events, ...guestEvents, ...visualizer].some((stream) => stream.destroyed)).toBe(false);
  });

  it('leaves another session untouched', () => {
    const limiter = new StreamLimiter();
    const bo = openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'bo');
    openMany(limiter, STREAMS_PER_SESSION_ROUTE + 1, '/api/events', 'ana');

    expect(bo.some((stream) => stream.destroyed)).toBe(false);
  });

  it('does not apply the address cap to a session, whatever its address', () => {
    const limiter = new StreamLimiter();
    const streams = [
      ...openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'ana', '192.168.1.50'),
      ...openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/guest/events', 'bo', '192.168.1.50'),
      ...openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/visualizer', 'cy', '192.168.1.50'),
    ];

    expect(streams.some((stream) => stream.destroyed)).toBe(false);
  });

  it('counts a stream that closed on its own as free capacity', () => {
    const limiter = new StreamLimiter();
    const streams = openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'ana');
    streams[1]?.emit('close');
    const next = openMany(limiter, 1, '/api/events', 'ana');

    expect([...streams, ...next].some((stream) => stream.destroyed)).toBe(false);
  });
});

describe('StreamLimiter per-address cap in mode none', () => {
  it('closes the oldest stream of the peer address across both sessionless routes when a seventh opens', () => {
    const limiter = new StreamLimiter();
    const events = openMany(limiter, 3, '/api/events', null);
    const visualizer = openMany(limiter, STREAMS_PER_ADDRESS - 3, '/api/visualizer', null);
    const seventh = openMany(limiter, 1, '/api/visualizer', null);

    expect(events.map((stream) => stream.destroyed)).toEqual([true, false, false]);
    expect([...visualizer, ...seventh].some((stream) => stream.destroyed)).toBe(false);
  });

  it('sends the evicted event to the oldest stream of a peer address, so its browser stays closed', () => {
    const limiter = new StreamLimiter();
    const streams = openMany(limiter, STREAMS_PER_ADDRESS + 1, '/api/events', null, '127.0.0.1');

    expect(streams[0]?.written).toEqual([EVICTED_FRAME]);
    expect(streams[1]?.written).toEqual([]);
  });

  it('leaves another address untouched', () => {
    const limiter = new StreamLimiter();
    const other = openMany(limiter, STREAMS_PER_ADDRESS, '/api/events', null, '192.168.1.60');
    openMany(limiter, STREAMS_PER_ADDRESS + 1, '/api/events', null, '192.168.1.50');

    expect(other.some((stream) => stream.destroyed)).toBe(false);
  });

  it('keeps two link-local devices of one /64 apart', () => {
    const limiter = new StreamLimiter();
    const first = openMany(limiter, STREAMS_PER_ADDRESS, '/api/events', null, 'fe80::1');
    openMany(limiter, STREAMS_PER_ADDRESS, '/api/events', null, 'fe80::2');

    expect(first.some((stream) => stream.destroyed)).toBe(false);
  });

  it('does not count a session stream toward the address cap', () => {
    const limiter = new StreamLimiter();
    const sessionStreams = openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'ana');
    const open = openMany(limiter, STREAMS_PER_ADDRESS, '/api/events', null);

    expect([...sessionStreams, ...open].some((stream) => stream.destroyed)).toBe(false);
  });
});

describe('StreamLimiter eviction of a backlogged stream', () => {
  it('ends the stream with the evicted event and leaves it open for its queued frames to flush', () => {
    vi.useFakeTimers();
    const limiter = new StreamLimiter();
    const oldest = fake();
    oldest.backlogged = true;
    admit(limiter, oldest, '/api/events', 'ana');
    openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'ana');

    expect(oldest.ended).toBe(true);
    expect(oldest.written).toEqual([EVICTED_FRAME]);
    expect(oldest.destroyed).toBe(false);
  });

  it('destroys a stream that never flushes after the grace period', () => {
    vi.useFakeTimers();
    const limiter = new StreamLimiter();
    const oldest = fake();
    oldest.backlogged = true;
    admit(limiter, oldest, '/api/events', 'ana');
    openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'ana');
    vi.advanceTimersByTime(SSE_END_FLUSH_GRACE_MS);

    expect(oldest.destroyed).toBe(true);
  });

  it('frees the scope slot at once, so the next stream evicts only one more stream', () => {
    const limiter = new StreamLimiter();
    const oldest = fake();
    oldest.backlogged = true;
    admit(limiter, oldest, '/api/events', 'ana');
    const rest = openMany(limiter, STREAMS_PER_SESSION_ROUTE + 1, '/api/events', 'ana');

    expect(rest.map((stream) => stream.ended)).toEqual([true, false, false, false]);
    expect(oldest.written).toEqual([EVICTED_FRAME]);
  });
});

describe('StreamLimiter server-wide cap', () => {
  function fillServer(limiter: StreamLimiter): FakeStream[] {
    return Array.from({ length: MAX_OPEN_STREAMS }, (_, i) => {
      const stream = fake();
      admit(limiter, stream, '/api/events', `session-${String(i)}`);
      return stream;
    });
  }

  it('refuses a stream over the cap and closes nothing', () => {
    const limiter = new StreamLimiter();
    const open = fillServer(limiter);
    const refused = fake();

    expect(admit(limiter, refused, '/api/events', 'newcomer')).toBe(false);
    expect(open.some((stream) => stream.destroyed)).toBe(false);
    expect(refused.listenerCount('close')).toBe(0);
  });

  it('admits a stream again once an open one closes', () => {
    const limiter = new StreamLimiter();
    const open = fillServer(limiter);
    open[0]?.emit('close');

    expect(admit(limiter, fake(), '/api/events', 'newcomer')).toBe(true);
  });

  it('admits a stream at the cap that replaces the oldest stream of its own scope', () => {
    const limiter = new StreamLimiter();
    const scoped = openMany(limiter, STREAMS_PER_SESSION_ROUTE, '/api/events', 'ana');
    for (let i = 0; i < MAX_OPEN_STREAMS - STREAMS_PER_SESSION_ROUTE; i += 1) {
      admit(limiter, fake(), '/api/events', `session-${String(i)}`);
    }

    expect(admit(limiter, fake(), '/api/events', 'ana')).toBe(true);
    expect(scoped.map((stream) => stream.destroyed)).toEqual([true, false, false]);
  });
});
