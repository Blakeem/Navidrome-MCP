/**
 * Navidrome MCP Server - e2e teardown unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import globalSetup, { teardown } from '../../e2e/harness/global-setup.js';
import { spawnInstance, waitForExit, waitForHealthy } from '../../e2e/harness/instance.js';

const playwrightMock = vi.hoisted(() => ({ newContext: vi.fn() }));
const mpvMock = vi.hoisted(() => ({ ipcPaths: [] as string[], quitError: null as Error | null }));
const storeMock = vi.hoisted(() => ({ runDirs: [] as string[] }));

// The shutdown request goes through this request context, so the test sees whether teardown sends it.
vi.mock('@playwright/test', () => ({ request: { newContext: playwrightMock.newContext } }));
vi.mock('../../e2e/harness/mpv-probe.js', () => ({
  MpvProbe: class {
    constructor(ipcPath: string) {
      mpvMock.ipcPaths.push(ipcPath);
    }

    quitIfRunning(): Promise<void> {
      return mpvMock.quitError === null ? Promise.resolve() : Promise.reject(mpvMock.quitError);
    }
  },
}));
// The real store builder needs an mpv binary and the user's Navidrome login, which CI lacks.
vi.mock('../../e2e/harness/temp-store.js', () => ({
  writeTempStore: ({ runDir }: { runDir: string }) => {
    storeMock.runDirs.push(runDir);
    return join(runDir, 'settings.json');
  },
}));
vi.mock('../../e2e/harness/instance.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../e2e/harness/instance.js')>();
  return {
    ...actual,
    spawnInstance: vi.fn(actual.spawnInstance),
    waitForExit: vi.fn(actual.waitForExit),
    waitForHealthy: vi.fn(actual.waitForHealthy),
  };
});

function spawnIdleChild(): ChildProcess {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

describe('e2e teardown', () => {
  let child: ChildProcess | null = null;

  afterEach(() => {
    child?.kill();
    child = null;
    playwrightMock.newContext.mockReset();
    vi.mocked(spawnInstance).mockReset();
    vi.mocked(waitForExit).mockReset();
    vi.mocked(waitForHealthy).mockReset();
    mpvMock.ipcPaths.length = 0;
    mpvMock.quitError = null;
    storeMock.runDirs.length = 0;
  });

  it('kills the child without a shutdown request when setup failed before the admin login', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'ndmcp-e2e-test-'));
    child = spawnIdleChild();
    const childExit = exited(child);

    await teardown({ runDir, baseUrl: 'http://127.0.0.1:1', ipcPath: 'private', adminStatePath: join(runDir, 'admin-state.json'), child });

    await childExit;
    expect(playwrightMock.newContext).not.toHaveBeenCalled();
    expect(mpvMock.ipcPaths).toEqual(['private']);
    expect(existsSync(runDir)).toBe(false);
  });

  it('leaves mpv alone when setup failed before the pipe passed the private-pipe check', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'ndmcp-e2e-test-'));

    await teardown({ runDir, baseUrl: '', ipcPath: null, adminStatePath: join(runDir, 'admin-state.json'), child: null });

    expect(mpvMock.ipcPaths).toEqual([]);
    expect(existsSync(runDir)).toBe(false);
  });

  it('sends the shutdown request with the saved admin session', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'ndmcp-e2e-test-'));
    const adminStatePath = join(runDir, 'admin-state.json');
    writeFileSync(adminStatePath, '{"cookies":[],"origins":[]}');
    const runningChild = spawnIdleChild();
    child = runningChild;
    const post = vi.fn(() => {
      runningChild.kill();
      return Promise.resolve({ ok: () => true, json: () => Promise.resolve({}) });
    });
    playwrightMock.newContext.mockResolvedValue({
      get: vi.fn(() => Promise.resolve({ ok: () => true, json: () => Promise.resolve({ role: 'admin', csrfToken: 'token' }) })),
      post,
      dispose: vi.fn(() => Promise.resolve()),
    });

    await teardown({ runDir, baseUrl: 'http://127.0.0.1:1', ipcPath: 'private', adminStatePath, child: runningChild });

    expect(playwrightMock.newContext).toHaveBeenCalledWith(expect.objectContaining({ storageState: adminStatePath }));
    expect(post).toHaveBeenCalledWith('/api/shutdown', expect.anything());
    expect(existsSync(runDir)).toBe(false);
  });

  it('runs every later step after a failed shutdown request and a failed mpv quit, then names both', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'ndmcp-e2e-test-'));
    const adminStatePath = join(runDir, 'admin-state.json');
    writeFileSync(adminStatePath, '{"cookies":[],"origins":[]}');
    child = spawnIdleChild();
    const childExit = exited(child);
    playwrightMock.newContext.mockResolvedValue({
      get: vi.fn(() => Promise.reject(new Error('connection refused'))),
      dispose: vi.fn(() => Promise.resolve()),
    });
    vi.mocked(waitForExit).mockResolvedValue(false);
    mpvMock.quitError = new Error('pipe busy');

    await expect(teardown({ runDir, baseUrl: 'http://127.0.0.1:1', ipcPath: 'private', adminStatePath, child }))
      .rejects.toThrow('e2e teardown: shutdown request: connection refused; mpv quit: pipe busy');

    await childExit;
    expect(mpvMock.ipcPaths).toEqual(['private']);
    expect(existsSync(runDir)).toBe(false);
  });
});

describe('e2e globalSetup failure', () => {
  let child: ChildProcess | null = null;

  afterEach(() => {
    child?.kill();
    child = null;
    vi.mocked(spawnInstance).mockReset();
    vi.mocked(waitForHealthy).mockReset();
    mpvMock.ipcPaths.length = 0;
    mpvMock.quitError = null;
    storeMock.runDirs.length = 0;
    vi.unstubAllEnvs();
  });

  function failStartup(reason: string): Promise<void> {
    // Setup refuses to start on Linux without XDG_RUNTIME_DIR, which a CI runner may not set.
    vi.stubEnv('XDG_RUNTIME_DIR', tmpdir());
    child = spawnIdleChild();
    const childExit = exited(child);
    vi.mocked(spawnInstance).mockReturnValue(child);
    vi.mocked(waitForHealthy).mockRejectedValue(new Error(reason));
    return childExit;
  }

  it('cleans up the child, the private mpv and the temp folder, then rethrows the setup error', async () => {
    const childExit = failStartup('e2e: no healthz');

    await expect(globalSetup()).rejects.toThrow(/^e2e: no healthz$/);

    await childExit;
    expect(mpvMock.ipcPaths).toHaveLength(1);
    expect(storeMock.runDirs).toHaveLength(1);
    expect(existsSync(storeMock.runDirs[0] ?? '')).toBe(false);
  });

  it('adds the cleanup problem to the setup error', async () => {
    const childExit = failStartup('e2e: no healthz');
    mpvMock.quitError = new Error('pipe busy');

    await expect(globalSetup()).rejects.toThrow('e2e: no healthz\ne2e teardown: mpv quit: pipe busy');

    await childExit;
    expect(existsSync(storeMock.runDirs[0] ?? '')).toBe(false);
  });
});
