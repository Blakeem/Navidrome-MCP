/**
 * Navidrome MCP Server - respawn-on-play dispatch tests
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Covers the respawn-on-play GATE at the dispatch level — the logic inside
 * `createPlaybackToolCategory(...).handleToolCall` (playback-handlers.ts). The
 * companion suite tests/unit/web/respawn-on-play.test.ts exercises only
 * `ensureWebForPlayback` itself; this suite pins the surrounding contract:
 *   (1) a PLAYBACK_STARTER (e.g. play_songs) triggers exactly one respawn;
 *   (2) a queue navigator (next) / a control (pause) does NOT trigger it;
 *   (3) a rejected respawn is SWALLOWED — the play still proceeds.
 * A silent regression here (catch dropped, starter set drifting) would turn a
 * best-effort UX nicety into a hard failure of every play, which no other test
 * would catch. Both collaborators are mocked so no sockets/child processes or
 * real playback engine are touched.
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
  // Remaining exports stubbed so the destructuring import in the handler never
  // binds undefined (defense-in-depth; only the three above are asserted).
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
