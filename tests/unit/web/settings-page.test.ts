/**
 * Navidrome MCP Server - Settings page holder unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startConfigServer } from '../../../src/config-app/server.js';
import { SETTINGS_PAGE_IDLE_TIMEOUT_MS } from '../../../src/constants/timeouts.js';
import { logger } from '../../../src/utils/logger.js';
import { createSettingsPageHolder } from '../../../src/web/settings-page.js';

type StartOptions = Parameters<typeof startConfigServer>[0];

interface FakeServer {
  url: string;
  close: ReturnType<typeof vi.fn>;
}

/** Each start answers a new URL, so a test can tell a reused server from a new one. */
function fakeStart(): { start: ReturnType<typeof vi.fn>; servers: FakeServer[]; options: StartOptions[] } {
  const servers: FakeServer[] = [];
  const options: StartOptions[] = [];
  const start = vi.fn((startOptions: StartOptions) => {
    const server = { url: `http://127.0.0.1:${String(5000 + servers.length)}/`, close: vi.fn(() => Promise.resolve()) };
    servers.push(server);
    options.push(startOptions);
    return Promise.resolve(server);
  });
  return { start, servers, options };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSettingsPageHolder', () => {
  it('starts the settings server with the settings page idle timeout', async () => {
    const { start, options } = fakeStart();

    await createSettingsPageHolder(start).open();

    expect(options[0]?.idleTimeoutMs).toBe(SETTINGS_PAGE_IDLE_TIMEOUT_MS);
  });

  it('starts one server for concurrent opens and answers each with its URL', async () => {
    const { start } = fakeStart();
    const holder = createSettingsPageHolder(start);

    const urls = await Promise.all([holder.open(), holder.open()]);
    const later = await holder.open();

    expect(urls).toEqual(['http://127.0.0.1:5000/', 'http://127.0.0.1:5000/']);
    expect(later).toBe('http://127.0.0.1:5000/');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts a new server after the idle timeout closed the last one', async () => {
    const { start, options } = fakeStart();
    const holder = createSettingsPageHolder(start);
    await holder.open();

    options[0]?.onIdleTimeout?.();

    expect(await holder.open()).toBe('http://127.0.0.1:5001/');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('closes the running server on close, and the next open starts a new one', async () => {
    const { start, servers } = fakeStart();
    const holder = createSettingsPageHolder(start);
    await holder.open();

    await holder.close();

    expect(servers[0]?.close).toHaveBeenCalledTimes(1);
    expect(await holder.open()).toBe('http://127.0.0.1:5001/');
  });

  it('closes nothing when no server ever started', async () => {
    const { start } = fakeStart();

    await createSettingsPageHolder(start).close();

    expect(start).not.toHaveBeenCalled();
  });

  it('keeps the newer server when an older server reports idle after a close', async () => {
    const { start, options } = fakeStart();
    const holder = createSettingsPageHolder(start);
    await holder.open();
    await holder.close();
    await holder.open();

    options[0]?.onIdleTimeout?.();

    expect(await holder.open()).toBe('http://127.0.0.1:5001/');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('rejects with the start failure, and the next open tries again', async () => {
    const { start: succeed } = fakeStart();
    const start = vi.fn()
      .mockRejectedValueOnce(new Error('listen EACCES 127.0.0.1'))
      .mockImplementation(succeed);
    const holder = createSettingsPageHolder(start);

    await expect(holder.open()).rejects.toThrow('listen EACCES 127.0.0.1');
    expect(await holder.open()).toBe('http://127.0.0.1:5000/');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('closes a real settings server when idle, and the next open serves a new one', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    let idleCloses = 0;
    const holder = createSettingsPageHolder((options) =>
      startConfigServer({
        ...options,
        idleTimeoutMs: 50,
        onIdleTimeout: () => {
          idleCloses += 1;
          options?.onIdleTimeout?.();
        },
      }),
    );
    try {
      const first = await holder.open();
      expect((await fetch(first)).status).toBe(200);

      await vi.waitFor(() => expect(idleCloses).toBe(1));
      await expect(fetch(first)).rejects.toThrow();

      const second = await holder.open();
      expect(second).not.toBe(first);
      expect((await fetch(second)).status).toBe(200);
    } finally {
      await holder.close();
    }
  });
});
