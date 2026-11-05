/**
 * Navidrome MCP Server - Startup failure fallback tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A stdio client sees a startup exit only as a generic disconnect, so a failed
 * createRuntime() on stdio must open setup mode with the reason. HTTP still exits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestConfig } from '../../helpers/test-config.js';

const mocks = vi.hoisted(() => ({
  resolveConfigState: vi.fn(),
  createRuntime: vi.fn(),
  startConfigServer: vi.fn(),
  registerDegradedTools: vi.fn(),
  openBrowser: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setDebug: vi.fn(), setSink: vi.fn() },
}));

vi.mock('../../../src/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config.js')>()),
  resolveConfigState: mocks.resolveConfigState,
}));
vi.mock('../../../src/bootstrap.js', () => ({ createRuntime: mocks.createRuntime }));
vi.mock('../../../src/config-app/server.js', () => ({ startConfigServer: mocks.startConfigServer }));
vi.mock('../../../src/config-app/degraded-tools.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config-app/degraded-tools.js')>()),
  registerDegradedTools: mocks.registerDegradedTools,
}));
vi.mock('../../../src/utils/open-browser.js', () => ({ openBrowser: mocks.openBrowser }));
vi.mock('../../../src/utils/logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/utils/logger.js')>()),
  logger: mocks.logger,
}));
// The real transport would read this test worker's stdin.
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    start(): Promise<void> {
      return Promise.resolve();
    }
    send(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

const SETTINGS_URL = 'http://127.0.0.1:5000/';
const FAILURE = 'Authentication failed: 401 Unauthorized';
const PROCESS_EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'unhandledRejection'];
const STDIN_EVENTS = ['end', 'close'];
// Each scenario imports src/index.ts afresh, and the first cold import can pass the 10 s default under full-suite load.
const STARTUP_TEST_TIMEOUT_MS = 30_000;
const processEvents = process as unknown as NodeJS.EventEmitter;
let listenersBefore = new Map<string, unknown[]>();
let stdinListenersBefore = new Map<string, unknown[]>();

/** src/index.ts runs main() on import, so each scenario imports a fresh copy. */
async function startServer(transportType: 'stdio' | 'http', source: 'store' | 'env' = 'store'): Promise<void> {
  const config = makeTestConfig({ transport: { type: transportType, host: '127.0.0.1', port: 3000, expose: false } });
  mocks.resolveConfigState.mockResolvedValue({ configured: true, config, source });
  vi.resetModules();
  await import('../../../src/index.js');
}

beforeEach(() => {
  mocks.createRuntime.mockRejectedValue(new Error(FAILURE));
  mocks.startConfigServer.mockResolvedValue({ url: SETTINGS_URL, close: vi.fn() });
  listenersBefore = new Map(PROCESS_EVENTS.map((event) => [event, processEvents.listeners(event)]));
  stdinListenersBefore = new Map(STDIN_EVENTS.map((event) => [event, process.stdin.listeners(event)]));
});

afterEach(() => {
  // index.ts installs process-wide handlers, which must not outlive the scenario in this worker.
  for (const event of PROCESS_EVENTS) {
    for (const listener of processEvents.listeners(event)) {
      if (listenersBefore.get(event)?.includes(listener) === true) continue;
      processEvents.removeListener(event, listener as (...args: unknown[]) => void);
    }
  }
  for (const event of STDIN_EVENTS) {
    for (const listener of process.stdin.listeners(event)) {
      if (stdinListenersBefore.get(event)?.includes(listener) === true) continue;
      process.stdin.removeListener(event, listener as (...args: unknown[]) => void);
    }
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('startup failure fallback', { timeout: STARTUP_TEST_TIMEOUT_MS }, () => {
  it('opens setup mode with the failure reason on stdio', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await startServer('stdio');

    await vi.waitFor(() => {
      expect(mocks.registerDegradedTools).toHaveBeenCalledWith(
        expect.anything(),
        SETTINGS_URL,
        { reason: FAILURE, unreachable: false, source: 'store' },
      );
    });
    expect(mocks.openBrowser).toHaveBeenCalledWith(SETTINGS_URL);
    expect(exit).not.toHaveBeenCalled();
  });

  it('enters degraded mode without opening the settings page when Navidrome is unreachable', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:4533'), { code: 'ECONNREFUSED' });
    const fetchFailed = new TypeError('fetch failed', { cause: refused });
    mocks.createRuntime.mockRejectedValue(
      new Error('Navidrome /auth/login failed: connect ECONNREFUSED 10.0.0.5:4533', { cause: fetchFailed }),
    );

    await startServer('stdio');

    await vi.waitFor(() => {
      expect(mocks.registerDegradedTools).toHaveBeenCalledWith(
        expect.anything(),
        SETTINGS_URL,
        { reason: 'Navidrome /auth/login failed: connect ECONNREFUSED 10.0.0.5:4533', unreachable: true, source: 'store' },
      );
    });
    expect(mocks.openBrowser).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('passes a rejected config to setup mode, so the notice names its cause instead of a first run', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const failure = { reason: 'The environment-derived config is invalid: x', unreachable: false, source: 'env' };
    mocks.resolveConfigState.mockResolvedValue({ configured: false, failure });
    vi.resetModules();

    await import('../../../src/index.js');

    await vi.waitFor(() => {
      expect(mocks.registerDegradedTools).toHaveBeenCalledWith(expect.anything(), SETTINGS_URL, failure);
    });
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });

  // A detached container's stdin is at EOF, so stdio setup mode there would exit 0 and never restart.
  it('exits 1 with the reason instead of serving setup mode when MCP_TRANSPORT=http', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.stubEnv('MCP_TRANSPORT', 'http');
    const failure = { reason: 'settings.json is not valid JSON (/config/settings.json)', unreachable: false, source: 'store' };
    mocks.resolveConfigState.mockResolvedValue({ configured: false, failure });
    vi.resetModules();

    try {
      await import('../../../src/index.js');
      await vi.waitFor(() => {
        expect(exit).toHaveBeenCalledWith(1);
      });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(mocks.startConfigServer).not.toHaveBeenCalled();
    expect(mocks.registerDegradedTools).not.toHaveBeenCalled();
    const fatal = mocks.logger.error.mock.calls.find((call) => call[0] === 'Failed to start server:');
    const message = (fatal?.[1] as Error).message;
    expect(message).toContain(failure.reason);
    expect(message).toContain('make sure this server\'s user can read it');
  });

  it('still exits on HTTP, with a fatal log line that names navidrome-config', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await startServer('http');

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(mocks.startConfigServer).not.toHaveBeenCalled();
    const fatal = mocks.logger.error.mock.calls.find((call) => call[0] === 'Failed to start server:');
    expect(fatal?.[1]).toBeInstanceOf(Error);
    expect((fatal?.[1] as Error).message).toContain('navidrome-config');
  });

  // navidrome-config binds loopback only, so a container that runs from env vars cannot use it.
  it('names the environment variables instead of navidrome-config when HTTP runs from env', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await startServer('http', 'env');

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    const fatal = mocks.logger.error.mock.calls.find((call) => call[0] === 'Failed to start server:');
    const message = (fatal?.[1] as Error).message;
    expect(message).toContain('fix the environment variable that holds the named setting, then restart');
    expect(message).not.toContain('navidrome-config');
  });
});
