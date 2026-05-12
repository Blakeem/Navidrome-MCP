/**
 * Navidrome MCP Server - mpv-ipc unit tests
 * Copyright (C) 2025
 *
 * Covers the production-hardening changes from docs/review/02 ship-blockers
 * C1 (per-command timeout) and C2 (settled-sentinel + safe-write). Mocks
 * `node:net` so the IPC client talks to a controllable in-memory socket;
 * the real mpv binary is exercised by tests/integration/playback/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared state between the vi.mock factory and tests. vi.hoisted ensures
// this runs before the mock factory.
const state = vi.hoisted(() => ({
  sockets: [] as FakeSocket[],
}));

interface WriteCall {
  data: string;
  cb: ((err?: Error) => void) | undefined;
}

interface FakeSocket {
  emit(event: string, ...args: unknown[]): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
  setEncoding: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  writeCalls: WriteCall[];
  writeImpl?: (data: string, cb?: (err?: Error) => void) => boolean;
}

vi.mock('node:net', async () => {
  const events = await import('node:events');
  return {
    createConnection: vi.fn(() => {
      const sock = new events.EventEmitter() as unknown as FakeSocket;
      sock.writeCalls = [];
      sock.setEncoding = vi.fn();
      sock.end = vi.fn();
      sock.destroy = vi.fn();
      sock.write = vi.fn((data: string, cb?: (err?: Error) => void) => {
        if (sock.writeImpl !== undefined) return sock.writeImpl(data, cb);
        sock.writeCalls.push({ data, cb });
        return true;
      });
      state.sockets.push(sock);
      return sock;
    }),
  };
});

// Import AFTER the mock is registered.
const { MpvIpc } = await import('../../../../src/services/playback/mpv-ipc.js');

function latestSocket(): FakeSocket {
  const s = state.sockets.at(-1);
  if (s === undefined) throw new Error('no fake socket created');
  return s;
}

async function connectedIpc(): Promise<InstanceType<typeof MpvIpc>> {
  const ipc = new MpvIpc();
  // Single attempt + zero delay so a successful connect doesn't queue a
  // timer the fake clock would have to drain.
  const promise = ipc.connect('/fake', 1, 0);
  // Yield once so vi.mock's createConnection ran and pushed the socket.
  await Promise.resolve();
  latestSocket().emit('connect');
  await promise;
  return ipc;
}

function emitResponse(sock: FakeSocket, requestId: number, data: unknown = null): void {
  const payload = JSON.stringify({ request_id: requestId, error: 'success', data });
  sock.emit('data', `${payload}\n`);
}

describe('MpvIpc', () => {
  beforeEach(() => {
    state.sockets.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('command() resolves on matching response', async () => {
    const ipc = await connectedIpc();
    const sock = latestSocket();

    const promise = ipc.command('get_property', 'pause');
    expect(sock.write).toHaveBeenCalledTimes(1);
    emitResponse(sock, 1, false);

    await expect(promise).resolves.toBe(false);
  });

  it('rejects with timeout when no response arrives (QUICK tier 2s)', async () => {
    const ipc = await connectedIpc();

    const promise = ipc.command('pause');
    vi.advanceTimersByTime(2001);

    await expect(promise).rejects.toThrow(/mpv command timeout \(2000ms\): pause/);
  });

  it('loadfile uses the LOAD tier (5s) and survives 2s', async () => {
    const ipc = await connectedIpc();

    const promise = ipc.command('loadfile', 'http://x/y', 'replace');
    vi.advanceTimersByTime(2500);
    // Should NOT have rejected yet — promise is still pending.
    let settled = false;
    promise.catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    vi.advanceTimersByTime(2600); // total 5100ms
    await expect(promise).rejects.toThrow(/mpv command timeout \(5000ms\): loadfile/);
  });

  it('command timeout tears down the IPC connection and fires disconnect', async () => {
    const ipc = await connectedIpc();
    const onDisconnect = vi.fn();
    ipc.onDisconnect(onDisconnect);

    const promise = ipc.command('pause');
    vi.advanceTimersByTime(2001);

    await expect(promise).rejects.toThrow(/timeout/);
    expect(ipc.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('a late response arriving after timeout is silently ignored', async () => {
    const ipc = await connectedIpc();
    const sock = latestSocket();

    const promise = ipc.command('pause');
    vi.advanceTimersByTime(2001);
    await expect(promise).rejects.toThrow(/timeout/);

    // The original socket listeners are still attached; emitting data after
    // the tear-down should NOT throw and should NOT re-resolve the promise.
    expect(() => emitResponse(sock, 1, false)).not.toThrow();
  });

  it('write callback firing after close does not double-reject', async () => {
    const ipc = await connectedIpc();
    const sock = latestSocket();

    const promise = ipc.command('pause');
    expect(sock.writeCalls.length).toBe(1);
    const writeCall = sock.writeCalls[0]!;

    // Peer drops the socket BEFORE the write callback fires.
    sock.emit('close');
    await expect(promise).rejects.toThrow(/closed unexpectedly/);

    // Now the write callback fires with an error — must not throw or
    // double-reject.
    expect(() => writeCall.cb?.(new Error('EPIPE'))).not.toThrow();
  });

  it('synchronous write() throw is converted to a Promise rejection', async () => {
    const ipc = await connectedIpc();
    const sock = latestSocket();

    sock.writeImpl = () => { throw new Error('ERR_STREAM_DESTROYED'); };

    await expect(ipc.command('pause')).rejects.toThrow(/ERR_STREAM_DESTROYED/);
  });

  it('close() while a command is pending rejects the command', async () => {
    const ipc = await connectedIpc();

    const promise = ipc.command('pause');
    ipc.close();

    await expect(promise).rejects.toThrow(/mpv IPC socket closed/);
    expect(ipc.isConnected()).toBe(false);
  });

  it('caps the IPC framing buffer at 16MB and tears down on overflow (M6)', async () => {
    const ipc = await connectedIpc();
    const sock = latestSocket();
    const onDisconnect = vi.fn();
    ipc.onDisconnect(onDisconnect);

    // Emit a single chunk >16MB with no newline. The IPC parser cannot frame
    // it as a complete response and is supposed to drop the buffer + tear
    // down the connection (next ensureRunning() will re-attach). The cap was
    // raised from 64KB to 16MB to accommodate large-playlist `get_property`
    // responses (~400 bytes/entry × queue length), which can legitimately be
    // hundreds of KB on a 500+-track queue.
    sock.emit('data', 'a'.repeat(16 * 1024 * 1024 + 1024));

    expect(ipc.isConnected()).toBe(false);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('IPC buffer overflow rejects pending commands', async () => {
    const ipc = await connectedIpc();
    const sock = latestSocket();

    const promise = ipc.command('pause');
    sock.emit('data', 'a'.repeat(16 * 1024 * 1024 + 1024));

    // Regex is intentionally loose on the byte count so future cap tweaks
    // don't require test updates — the assertion is "we surface a frame-
    // -size violation," not "the cap is exactly N."
    await expect(promise).rejects.toThrow(/exceeded \d+ bytes/);
  });

  it('timeout-then-close does not double-fire disconnect handlers', async () => {
    const ipc = await connectedIpc();
    const onDisconnect = vi.fn();
    ipc.onDisconnect(onDisconnect);

    const promise = ipc.command('pause');
    vi.advanceTimersByTime(2001);
    await expect(promise).rejects.toThrow(/timeout/);

    // Explicit close() after the timeout already tore the IPC down — must
    // be a no-op (no extra disconnect-handler invocation, no throw).
    expect(() => ipc.close()).not.toThrow();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
