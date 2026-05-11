/**
 * Navidrome MCP Server - playback-engine signal handler tests
 * Copyright (C) 2025
 *
 * Covers H6 from docs/review/02-playback-deep-review.md:
 *   - SIGINT/SIGTERM signal handler must NOT call process.exit() (which
 *     truncates MCP stdio output and loses the final logger lines).
 *   - Instead, set process.exitCode and let the loop drain naturally.
 *
 * The handler is registered lazily on the first ensureRunning() AND only
 * once per engine instance (singleton + signalsRegistered guard). We snapshot
 * the original listener set, call ensureRunning to install, and verify the
 * new listeners do the right thing without calling process.exit.
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

describe('PlaybackEngine signal handlers (H6)', () => {
  let installedSigintListeners: NodeJS.SignalsListener[] = [];
  let installedSigtermListeners: NodeJS.SignalsListener[] = [];
  let originalExitCode: number | string | undefined;
  let installedIpc: FakeIpc;

  beforeAll(async () => {
    originalExitCode = process.exitCode;
    const beforeInt = new Set(process.listeners('SIGINT'));
    const beforeTerm = new Set(process.listeners('SIGTERM'));

    installedIpc = makeFakeIpc();
    fakeIpcRef.value = installedIpc;
    playbackEngine.configure({
      navidromeUrl: 'http://test',
      navidromeUsername: 'u',
      navidromePassword: 'p',
      mpvPath: '/fake/mpv',
    } as never);
    await playbackEngine.ensureRunning();

    installedSigintListeners = process
      .listeners('SIGINT')
      .filter((ln) => !beforeInt.has(ln)) as NodeJS.SignalsListener[];
    installedSigtermListeners = process
      .listeners('SIGTERM')
      .filter((ln) => !beforeTerm.has(ln)) as NodeJS.SignalsListener[];
  });

  afterAll(async () => {
    process.exitCode = originalExitCode;
    for (const ln of installedSigintListeners) process.removeListener('SIGINT', ln);
    for (const ln of installedSigtermListeners) process.removeListener('SIGTERM', ln);
    await playbackEngine.shutdown();
    vi.restoreAllMocks();
  });

  it('registered SIGINT and SIGTERM listeners exactly once', () => {
    expect(installedSigintListeners.length).toBe(1);
    expect(installedSigtermListeners.length).toBe(1);
  });

  it('SIGINT does NOT call process.exit (H6 regression sentinel)', () => {
    process.exitCode = undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit was called — H6 regression');
    }) as never);

    for (const ln of installedSigintListeners) ln('SIGINT', 0);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(130);
    exitSpy.mockRestore();
  });

  it('SIGTERM sets exitCode=143 and does not call process.exit', () => {
    process.exitCode = undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit was called — H6 regression');
    }) as never);

    for (const ln of installedSigtermListeners) ln('SIGTERM', 0);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(143);
    exitSpy.mockRestore();
  });

  it('signal handler closes the IPC socket on first invocation', () => {
    // Sanity: the first signal already fired in earlier test, so close()
    // has been invoked at least once. Verify the spy recorded the call.
    expect(installedIpc.close).toHaveBeenCalled();
  });
});
