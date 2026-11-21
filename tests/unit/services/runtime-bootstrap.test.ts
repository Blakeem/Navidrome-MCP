/**
 * Navidrome MCP Server - Shared runtime bootstrap tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The Jukebox Remote's setup mode builds a new runtime after a failed start, so the second runtime
 * must load the libraries and filter values of its own settings.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestConfig } from '../../helpers/test-config.js';

const mocks = vi.hoisted(() => ({
  libraryReset: vi.fn(),
  libraryInitialize: vi.fn(() => Promise.resolve()),
  filterReset: vi.fn(),
  filterInitialize: vi.fn(() => Promise.resolve()),
  engineConfigure: vi.fn(),
}));

vi.mock('../../../src/client/navidrome-client.js', () => ({
  NavidromeClient: class {
    initialize(): Promise<void> {
      return Promise.resolve();
    }
  },
}));
vi.mock('../../../src/services/library-manager.js', () => ({
  libraryManager: { reset: mocks.libraryReset, initialize: mocks.libraryInitialize },
}));
vi.mock('../../../src/services/filter-cache-manager.js', () => ({
  filterCacheManager: { reset: mocks.filterReset, initialize: mocks.filterInitialize },
}));
vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: { configure: mocks.engineConfigure, setVisualizerSource: vi.fn(), setAudioDeviceSource: vi.fn() },
}));

const { createRuntime } = await import('../../../src/bootstrap.js');

describe('createRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops the library and filter caches of an earlier runtime before each load', async () => {
    const first = makeTestConfig({ features: { playback: false } });
    const second = makeTestConfig({ features: { playback: false }, defaultLibraryIds: [2] });

    await createRuntime(first);
    await createRuntime(second);

    expect(mocks.libraryReset).toHaveBeenCalledTimes(2);
    expect(mocks.filterReset).toHaveBeenCalledTimes(2);
    expect(mocks.libraryInitialize).toHaveBeenLastCalledWith(expect.anything(), second);
    expect(mocks.filterInitialize).toHaveBeenLastCalledWith(expect.anything(), second);
    expect(mocks.libraryReset.mock.invocationCallOrder[1]).toBeLessThan(mocks.libraryInitialize.mock.invocationCallOrder[1] ?? 0);
    expect(mocks.filterReset.mock.invocationCallOrder[1]).toBeLessThan(mocks.filterInitialize.mock.invocationCallOrder[1] ?? 0);
  });

  it('clears the playback config an earlier runtime set when the new settings turn playback off', async () => {
    const withPlayback = makeTestConfig({ features: { playback: true } });

    await createRuntime(withPlayback);
    await createRuntime(makeTestConfig({ features: { playback: false } }));

    expect(mocks.engineConfigure.mock.calls).toEqual([[withPlayback], [null]]);
  });
});
