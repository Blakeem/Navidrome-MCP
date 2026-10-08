import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSE_HEARTBEAT_MS, VISUALIZER_FEED_GRACE_MS } from '../../../src/constants/timeouts.js';
import type { LevelRecord } from '../../../src/services/playback/visualizer-log.js';
import { VisualizerHub } from '../../../src/webui/visualizer-hub.js';

interface FakeResponse extends EventEmitter {
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  writableNeedDrain: boolean;
  destroyed: boolean;
  writableEnded: boolean;
}

function fakeResponse(): FakeResponse {
  const res = new EventEmitter() as FakeResponse;
  res.writeHead = vi.fn();
  res.write = vi.fn();
  res.end = vi.fn();
  res.writableNeedDrain = false;
  res.destroyed = false;
  res.writableEnded = false;
  return res;
}

function hubWithFeed(): { hub: VisualizerHub; feed: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }; push: (record: LevelRecord) => void } {
  const feed = { start: vi.fn(), stop: vi.fn() };
  let push: (record: LevelRecord) => void = () => undefined;
  const hub = new VisualizerHub((onRecord) => {
    push = onRecord;
    return feed;
  });
  return { hub, feed, push: (record) => { push(record); } };
}

const RECORD: LevelRecord = { segment: 2, ptsSeconds: 1.2345, levels: [-30, -40] };

function levelWrites(res: FakeResponse): string[] {
  return res.write.mock.calls.map((call) => String(call[0])).filter((chunk) => chunk.startsWith('event: levels'));
}

describe('VisualizerHub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens an event stream and starts the feed for the first viewer', () => {
    const { hub, feed } = hubWithFeed();
    const res = fakeResponse();

    hub.addClient(res as unknown as ServerResponse);

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream; charset=utf-8' }));
    expect(res.write).toHaveBeenCalledWith('retry: 5000\n\n');
    expect(feed.start).toHaveBeenCalledTimes(1);
  });

  it('sends the records of each interval as one levels event', async () => {
    const { hub, push } = hubWithFeed();
    const res = fakeResponse();
    hub.addClient(res as unknown as ServerResponse);

    push(RECORD);
    push({ ...RECORD, ptsSeconds: 1.2577 });
    await vi.advanceTimersByTimeAsync(100);

    expect(levelWrites(res)).toEqual([`event: levels\ndata: ${JSON.stringify({ frames: [[2, 1235, -30, -40], [2, 1258, -30, -40]] })}\n\n`]);
  });

  it('skips a batch for a viewer whose connection is backed up', async () => {
    const { hub, push } = hubWithFeed();
    const slow = fakeResponse();
    const quick = fakeResponse();
    slow.writableNeedDrain = true;
    hub.addClient(slow as unknown as ServerResponse);
    hub.addClient(quick as unknown as ServerResponse);

    push(RECORD);
    await vi.advanceTimersByTimeAsync(100);

    expect(levelWrites(slow)).toHaveLength(0);
    expect(levelWrites(quick)).toHaveLength(1);
  });

  it('stops the feed a grace period after the last viewer leaves, unless one returns', async () => {
    const { hub, feed } = hubWithFeed();
    const first = fakeResponse();
    hub.addClient(first as unknown as ServerResponse);

    first.emit('close');
    await vi.advanceTimersByTimeAsync(VISUALIZER_FEED_GRACE_MS - 1);
    hub.addClient(fakeResponse() as unknown as ServerResponse);
    await vi.advanceTimersByTimeAsync(VISUALIZER_FEED_GRACE_MS * 2);
    expect(feed.stop).not.toHaveBeenCalled();

    const { hub: lonely, feed: lonelyFeed } = hubWithFeed();
    const only = fakeResponse();
    lonely.addClient(only as unknown as ServerResponse);
    only.emit('close');
    await vi.advanceTimersByTimeAsync(VISUALIZER_FEED_GRACE_MS);
    expect(lonelyFeed.stop).toHaveBeenCalledTimes(1);
  });

  it('drops records that arrive while no viewer is open', async () => {
    const { hub, push } = hubWithFeed();
    const first = fakeResponse();
    hub.addClient(first as unknown as ServerResponse);
    first.emit('close');
    push(RECORD);

    const next = fakeResponse();
    hub.addClient(next as unknown as ServerResponse);
    await vi.advanceTimersByTimeAsync(100);

    expect(levelWrites(next)).toHaveLength(0);
  });

  it('writes a heartbeat comment while no levels arrive', async () => {
    const { hub } = hubWithFeed();
    const res = fakeResponse();
    hub.addClient(res as unknown as ServerResponse);

    await vi.advanceTimersByTimeAsync(SSE_HEARTBEAT_MS);

    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('ends every stream and stops the feed on stop, with no timer left behind', async () => {
    const { hub, feed } = hubWithFeed();
    const res = fakeResponse();
    hub.addClient(res as unknown as ServerResponse);

    hub.stop();
    // A real response closes after end().
    res.emit('close');
    await vi.advanceTimersByTimeAsync(VISUALIZER_FEED_GRACE_MS);

    expect(res.end).toHaveBeenCalled();
    expect(feed.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
