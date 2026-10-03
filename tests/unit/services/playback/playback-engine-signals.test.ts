/**
 * Navidrome MCP Server - playback-engine signal ownership tests
 * Copyright (C) 2025
 *
 * The entry points own process shutdown, so starting the engine must add no
 * SIGINT or SIGTERM listener that could swallow a second Ctrl+C.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const fakeIpcRef = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('../../../../src/services/playback/mpv-ipc.js', () => ({
  MpvIpc: vi.fn(() => fakeIpcRef.value),
}));

vi.mock('../../../../src/services/playback/mpv-process.js', () => ({
  getDefaultIpcPath: () => '/tmp/test-fake-signals.sock',
  detectMpvBinary: () => '/fake/mpv',
  spawnMpv: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn>; unref: () => void };
    child.kill = vi.fn();
    child.unref = (): void => undefined;
    return child;
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: () => true, // hit tryAttachExisting
}));

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:net', () => ({
  createConnection: vi.fn(() => {
    const sock = new EventEmitter() as EventEmitter & { destroy: () => void };
    sock.destroy = (): void => undefined;
    return sock;
  }),
}));

const { playbackEngine } = await import('../../../../src/services/playback/playback-engine.js');

interface FakeIpc {
  connect: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  observeProperty: ReturnType<typeof vi.fn>;
  onPropertyChange: ReturnType<typeof vi.fn>;
  onEvent: ReturnType<typeof vi.fn>;
  onDisconnect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeFakeIpc(): FakeIpc {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    command: vi.fn().mockResolvedValue(null),
    observeProperty: vi.fn().mockResolvedValue(undefined),
    onPropertyChange: vi.fn(),
    onEvent: vi.fn(),
    onDisconnect: vi.fn(),
    close: vi.fn(),
  };
}

describe('PlaybackEngine signal ownership', () => {
  let sigintCountBefore = 0;
  let sigtermCountBefore = 0;

  beforeAll(async () => {
    sigintCountBefore = process.listenerCount('SIGINT');
    sigtermCountBefore = process.listenerCount('SIGTERM');

    fakeIpcRef.value = makeFakeIpc();
    playbackEngine.configure({
      navidromeUrl: 'http://test',
      navidromeUsername: 'u',
      navidromePassword: 'p',
      mpvPath: '/fake/mpv',
    } as never);
    await playbackEngine.ensureRunning();
  });

  afterAll(() => {
    playbackEngine.shutdown();
    vi.restoreAllMocks();
  });

  it('registers no SIGINT or SIGTERM listener when the engine starts', () => {
    expect(playbackEngine.isRunning()).toBe(true);
    expect(process.listenerCount('SIGINT')).toBe(sigintCountBefore);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermCountBefore);
  });

  it('shutdown() drops subscribers and the engine starts again afterward', async () => {
    let notified = false;
    const unsubscribe = playbackEngine.onStateChange(() => {
      notified = true;
    });

    playbackEngine.shutdown();
    expect(playbackEngine.isRunning()).toBe(false);

    const restartIpc = makeFakeIpc();
    fakeIpcRef.value = restartIpc;
    await playbackEngine.ensureRunning();
    expect(playbackEngine.isRunning()).toBe(true);

    const propertyHandler = restartIpc.onPropertyChange.mock.calls[0]?.[0] as
      | ((evt: { id: number; name: string; data: unknown }) => void)
      | undefined;
    expect(propertyHandler).toBeTypeOf('function');
    propertyHandler?.({ id: 3, name: 'pause', data: true });
    expect(notified).toBe(false);
    expect(() => unsubscribe()).not.toThrow();
  });
});
