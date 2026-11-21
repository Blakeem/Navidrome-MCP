/**
 * Navidrome MCP Server - Browser launcher tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The spawn is a stub, so no test opens a browser.

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const { openBrowser } = await import('../../../src/utils/open-browser.js');
const { logger } = await import('../../../src/utils/logger.js');

const KEYED_URL = `http://127.0.0.1:8808/admin?launch=${'k'.repeat(43)}`;

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe('openBrowser', () => {
  it('passes the entire address, launch key included, to the launcher', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawnMock.mockReturnValue(child);

    openBrowser(KEYED_URL);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[1]).toContain(KEYED_URL);
  });

  it('logs a launch that throws without the query, so no log line holds the launch key', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    spawnMock.mockImplementation(() => {
      throw new Error('no GUI');
    });

    openBrowser(KEYED_URL);

    expect(debug).toHaveBeenCalledWith('openBrowser: spawn threw for http://127.0.0.1:8808/admin (no GUI?)');
  });

  it('logs a launch that fails later without the query', () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawnMock.mockReturnValue(child);

    openBrowser(KEYED_URL);
    child.emit('error', new Error('ENOENT'));

    expect(debug).toHaveBeenCalledWith('openBrowser: could not launch a browser for http://127.0.0.1:8808/admin (no GUI?)');
  });
});
