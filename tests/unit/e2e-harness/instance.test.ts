/**
 * Navidrome MCP Server - e2e instance env unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertPrivatePipe, ipcPathUnder, privateIpcEnv, waitForHealthy } from '../../e2e/harness/instance.js';
import { getDefaultIpcPath } from '../../../src/services/playback/mpv-process.js';

const ENV_KEYS = ['XDG_RUNTIME_DIR', 'PIPEWIRE_RUNTIME_DIR', 'PULSE_RUNTIME_PATH'] as const;
const originalPlatform = process.platform;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  setPlatform(originalPlatform);
  setEnv(Object.fromEntries(originalEnv));
});

describe('privateIpcEnv', () => {
  it('gives the child its own USERNAME on Windows', () => {
    setPlatform('win32');
    expect(privateIpcEnv('C:\\run', 'abcd')).toEqual({ USERNAME: 'ndmcp-e2e-abcd' });
  });

  it('keeps the audio server lookup on the user runtime folder on POSIX', () => {
    setPlatform('linux');
    setEnv({ XDG_RUNTIME_DIR: '/run/user/1000' });
    expect(privateIpcEnv('/tmp/run', 'abcd')).toEqual({
      XDG_RUNTIME_DIR: '/tmp/run',
      PIPEWIRE_RUNTIME_DIR: '/run/user/1000',
      PULSE_RUNTIME_PATH: '/run/user/1000/pulse',
    });
  });

  it('keeps audio paths the parent already sets', () => {
    setPlatform('linux');
    setEnv({ XDG_RUNTIME_DIR: '/run/user/1000', PIPEWIRE_RUNTIME_DIR: '/pw', PULSE_RUNTIME_PATH: '/pulse' });
    expect(privateIpcEnv('/tmp/run', 'abcd')).toMatchObject({ PIPEWIRE_RUNTIME_DIR: '/pw', PULSE_RUNTIME_PATH: '/pulse' });
  });

  it('fails on Linux when the parent has no XDG_RUNTIME_DIR, since the audio lookup would move', () => {
    setPlatform('linux');
    setEnv({});
    expect(() => privateIpcEnv('/tmp/run', 'abcd')).toThrow('XDG_RUNTIME_DIR is not set');
  });

  it('sets only XDG_RUNTIME_DIR on macOS when the parent has none', () => {
    setPlatform('darwin');
    setEnv({});
    expect(privateIpcEnv('/tmp/run', 'abcd')).toEqual({ XDG_RUNTIME_DIR: '/tmp/run' });
  });
});

describe('private pipe', () => {
  it("rejects the default pipe, which the user's mpv listens on", () => {
    expect(() => assertPrivatePipe(getDefaultIpcPath())).toThrow('equals the default pipe');
  });

  it("computes the child's private pipe and leaves the parent env unchanged", () => {
    // A Linux run needs a user runtime folder, which a CI runner may not set.
    setEnv({ XDG_RUNTIME_DIR: '/run/user/1000' });
    const parentEnv = { ...process.env };
    const childEnv = { ...privateIpcEnv('/tmp/ndmcp-e2e-abcd', 'abcd'), NDMCP_E2E_UNSET_KEY: 'set' };

    const childPath = ipcPathUnder(childEnv);

    expect(childPath).toContain('ndmcp-e2e-abcd');
    expect(() => assertPrivatePipe(childPath)).not.toThrow();
    expect({ ...process.env }).toEqual(parentEnv);
  });
});

describe('waitForHealthy', () => {
  const baseUrl = 'http://127.0.0.1:1';
  let logDir: string | null = null;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (logDir !== null) rmSync(logDir, { recursive: true, force: true });
    logDir = null;
  });

  function fakeChild(exitCode: number | null, signalCode: NodeJS.Signals | null): ChildProcess {
    return { exitCode, signalCode } as unknown as ChildProcess;
  }

  it('names the exit code and the last log lines when the child exits during startup', async () => {
    logDir = mkdtempSync(join(tmpdir(), 'ndmcp-e2e-test-'));
    const logPath = join(logDir, 'navidrome-web.log');
    writeFileSync(logPath, `${Array.from({ length: 25 }, (_, i) => `line ${String(i + 1)}`).join('\n')}\n`);
    const lastLines = Array.from({ length: 20 }, (_, i) => `line ${String(i + 6)}`).join('\n');

    await expect(waitForHealthy(baseUrl, fakeChild(3, null), logPath))
      .rejects.toThrow(`exited with code 3 during startup. Log tail:\n${lastLines}`);
  });

  it('names the signal and the missing log when the child is killed during startup', async () => {
    const logPath = join(tmpdir(), 'ndmcp-e2e-no-such-log.log');

    await expect(waitForHealthy(baseUrl, fakeChild(null, 'SIGKILL'), logPath))
      .rejects.toThrow(`exited on signal SIGKILL during startup. Log tail:\n(no log at ${logPath})`);
  });

  it('times out when healthz never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('connection refused'))));

    const failure = expect(waitForHealthy(baseUrl, fakeChild(null, null), join(tmpdir(), 'ndmcp-e2e-no-such-log.log')))
      .rejects.toThrow(`did not answer ${baseUrl}/healthz within`);
    await vi.runAllTimersAsync();

    await failure;
  });

  it('resolves once healthz answers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('ok'))));

    await expect(waitForHealthy(baseUrl, fakeChild(null, null), 'unread.log')).resolves.toBeUndefined();
  });
});
