import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISUALIZER_FEED_RETRY_MS } from '../../../src/constants/timeouts.js';
import type { MpvIpc } from '../../../src/services/playback/mpv-ipc.js';
import { VISUALIZER_BAND_COUNT } from '../../../src/services/playback/visualizer-filter.js';
import { VisualizerFeed } from '../../../src/webui/visualizer-feed.js';

interface FakeIpc {
  connect: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onEvent: (handler: (evt: Record<string, unknown>) => void) => void;
  onDisconnect: (handler: () => void) => void;
  emit: (evt: Record<string, unknown>) => void;
  disconnect: () => void;
}

function fakeIpc(connects = true): FakeIpc {
  const events: Array<(evt: Record<string, unknown>) => void> = [];
  const disconnects: Array<() => void> = [];
  return {
    connect: connects ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error('ENOENT')),
    command: vi.fn().mockResolvedValue(null),
    close: vi.fn(),
    onEvent: (handler) => { events.push(handler); },
    onDisconnect: (handler) => { disconnects.push(handler); },
    emit: (evt) => { for (const handler of events) handler(evt); },
    disconnect: () => { for (const handler of disconnects) handler(); },
  };
}

function measurementEvents(): Array<Record<string, unknown>> {
  return [
    { event: 'log-message', prefix: 'ffmpeg', level: 'v', text: 'Parsed_ametadata_40: frame:0    pts:0       pts_time:0\n' },
    ...Array.from({ length: VISUALIZER_BAND_COUNT }, (_, i) => ({
      event: 'log-message', prefix: 'ffmpeg', level: 'v', text: `Parsed_ametadata_40: lavfi.astats.${i + 1}.RMS_level=-30.0\n`,
    })),
  ];
}

describe('VisualizerFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects on its own connection, requests log messages and turns them into records', async () => {
    const ipc = fakeIpc();
    const onRecord = vi.fn();
    const feed = new VisualizerFeed(onRecord, () => ipc as unknown as MpvIpc, '/tmp/mpv.sock');

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    for (const evt of measurementEvents()) ipc.emit(evt);
    ipc.emit({ event: 'start-file' });

    expect(ipc.connect).toHaveBeenCalledWith('/tmp/mpv.sock', 1, 0);
    expect(ipc.command).toHaveBeenCalledWith('request_log_messages', 'v');
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord.mock.calls[0]?.[0]).toMatchObject({ segment: 1, ptsSeconds: 0 });
  });

  it('retries when mpv is not running yet', async () => {
    const missing = fakeIpc(false);
    const ready = fakeIpc();
    const createIpc = vi.fn().mockReturnValueOnce(missing).mockReturnValueOnce(ready);
    const feed = new VisualizerFeed(vi.fn(), createIpc as unknown as () => MpvIpc, '/tmp/mpv.sock');

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(missing.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(VISUALIZER_FEED_RETRY_MS);

    expect(createIpc).toHaveBeenCalledTimes(2);
    expect(ready.command).toHaveBeenCalledWith('request_log_messages', 'v');
  });

  it('reconnects after mpv drops the connection, and stops retrying once stopped', async () => {
    const first = fakeIpc();
    const second = fakeIpc();
    const createIpc = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const feed = new VisualizerFeed(vi.fn(), createIpc as unknown as () => MpvIpc, '/tmp/mpv.sock');

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    first.disconnect();
    await vi.advanceTimersByTimeAsync(VISUALIZER_FEED_RETRY_MS);
    expect(createIpc).toHaveBeenCalledTimes(2);

    feed.stop();
    second.disconnect();
    await vi.advanceTimersByTimeAsync(VISUALIZER_FEED_RETRY_MS * 3);

    expect(second.close).toHaveBeenCalled();
    expect(createIpc).toHaveBeenCalledTimes(2);
  });

  it('closes a connection that finishes opening after stop', async () => {
    const ipc = fakeIpc();
    let finishConnect: () => void = () => undefined;
    ipc.connect.mockReturnValue(new Promise<void>((resolve) => { finishConnect = resolve; }));
    const feed = new VisualizerFeed(vi.fn(), () => ipc as unknown as MpvIpc, '/tmp/mpv.sock');

    feed.start();
    feed.stop();
    finishConnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(ipc.close).toHaveBeenCalled();
  });
});
