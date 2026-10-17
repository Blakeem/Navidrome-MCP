/**
 * Navidrome MCP Server - respawn-on-play dispatch tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Only a playback starter may respawn the web player, and a failed respawn must not fail the play.
 * tests/unit/web/respawn-on-play.test.ts covers ensureWebForPlayback itself.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { createMockClient } from '../../factories/mock-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const { ensureWebForPlaybackMock, playSongsMock, nextMock, pauseMock } = vi.hoisted(() => ({
  ensureWebForPlaybackMock: vi.fn(),
  playSongsMock: vi.fn(),
  nextMock: vi.fn(),
  pauseMock: vi.fn(),
}));

vi.mock('../../../src/web/spawn.js', () => ({
  ensureWebForPlayback: ensureWebForPlaybackMock,
}));

vi.mock('../../../src/tools/playback.js', () => ({
  playSongs: playSongsMock,
  next: nextMock,
  pause: pauseMock,
  // The handler imports every playback tool, so each one gets a stub.
  // Only the three above are asserted.
  resume: vi.fn(),
  setVolume: vi.fn(),
  playbackStatus: vi.fn(),
  playAlbums: vi.fn(),
  playAlbumsSearch: vi.fn(),
  playSongsSearch: vi.fn(),
  playPlaylist: vi.fn(),
  previous: vi.fn(),
  seek: vi.fn(),
  nowPlaying: vi.fn(),
  getPlayQueuePage: vi.fn(),
  clearPlayQueue: vi.fn(),
  shufflePlayQueue: vi.fn(),
  moveInPlayQueue: vi.fn(),
  removeFromPlayQueue: vi.fn(),
  playQueueIndex: vi.fn(),
}));

const { createPlaybackToolCategory } = await import('../../../src/tools/handlers/playback-handlers.js');

describe('respawn-on-play dispatch gate (handleToolCall)', () => {
  const config = makeTestConfig({ features: { playback: true } });
  const client = createMockClient() as unknown as NavidromeClient;
  let category: ReturnType<typeof createPlaybackToolCategory>;

  beforeEach(() => {
    vi.clearAllMocks();
    ensureWebForPlaybackMock.mockResolvedValue('running');
    playSongsMock.mockResolvedValue({ success: true });
    nextMock.mockResolvedValue({ success: true });
    pauseMock.mockResolvedValue({ success: true });
    category = createPlaybackToolCategory(client, config);
  });

  it('play_songs (a starter) triggers exactly one respawn and dispatches the play', async () => {
    await category.handleToolCall('play_songs', { songIds: ['song-1'] });

    expect(ensureWebForPlaybackMock).toHaveBeenCalledTimes(1);
    expect(ensureWebForPlaybackMock).toHaveBeenCalledWith(config);
    expect(playSongsMock).toHaveBeenCalledTimes(1);
  });

  it('next (a queue navigator) does NOT trigger respawn', async () => {
    await category.handleToolCall('next', {});

    expect(ensureWebForPlaybackMock).not.toHaveBeenCalled();
    expect(nextMock).toHaveBeenCalledTimes(1);
  });

  it('pause (a control) does NOT trigger respawn', async () => {
    await category.handleToolCall('pause', {});

    expect(ensureWebForPlaybackMock).not.toHaveBeenCalled();
    expect(pauseMock).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected respawn — the play still proceeds', async () => {
    ensureWebForPlaybackMock.mockRejectedValueOnce(new Error('web player unreachable'));

    await expect(
      category.handleToolCall('play_songs', { songIds: ['song-1'] }),
    ).resolves.toEqual({ success: true });

    expect(ensureWebForPlaybackMock).toHaveBeenCalledTimes(1);
    expect(playSongsMock).toHaveBeenCalledTimes(1);
  });
});
