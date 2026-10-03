/**
 * Navidrome MCP Server - Startup failure fallback tests
 * Copyright (C) 2025
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setDebug: vi.fn(), setSink: vi.fn() },
}));

vi.mock('../../../src/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config.js')>()),
  resolveConfigState: mocks.resolveConfigState,
}));
vi.mock('../../../src/bootstrap.js', () => ({ createRuntime: mocks.createRuntime }));
vi.mock('../../../src/config-app/server.js', () => ({ startConfigServer: mocks.startConfigServer }));
vi.mock('../../../src/config-app/degraded-tools.js', () => ({ registerDegradedTools: mocks.registerDegradedTools }));
vi.mock('../../../src/utils/open-browser.js', () => ({ openBrowser: vi.fn() }));
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
const PROCESS_EVENTS = ['SIGINT', 'SIGTERM', 'unhandledRejection'];
const processEvents = process as unknown as NodeJS.EventEmitter;
let listenersBefore = new Map<string, unknown[]>();

/** src/index.ts runs main() on import, so each scenario imports a fresh copy. */
async function startServer(transportType: 'stdio' | 'http'): Promise<void> {
  const config = makeTestConfig({ transport: { type: transportType, host: '127.0.0.1', port: 3000, expose: false } });
  mocks.resolveConfigState.mockResolvedValue({ configured: true, config });
  vi.resetModules();
  await import('../../../src/index.js');
}

beforeEach(() => {
  mocks.createRuntime.mockRejectedValue(new Error(FAILURE));
  mocks.startConfigServer.mockResolvedValue({ url: SETTINGS_URL, close: vi.fn() });
  listenersBefore = new Map(PROCESS_EVENTS.map((event) => [event, processEvents.listeners(event)]));
});

afterEach(() => {
  // index.ts installs process-wide handlers, which must not outlive the scenario in this worker.
  for (const event of PROCESS_EVENTS) {
    for (const listener of processEvents.listeners(event)) {
      if (listenersBefore.get(event)?.includes(listener) === true) continue;
      processEvents.removeListener(event, listener as (...args: unknown[]) => void);
    }
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('startup failure fallback', () => {
  it('opens setup mode with the failure reason on stdio', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await startServer('stdio');

    await vi.waitFor(() => {
      expect(mocks.registerDegradedTools).toHaveBeenCalledWith(expect.anything(), SETTINGS_URL, FAILURE);
    });
    expect(exit).not.toHaveBeenCalled();
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
});
