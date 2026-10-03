/**
 * Navidrome MCP Server - media library tool tests
 * Copyright (C) 2025
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getSongPlaylists } from '../../../src/tools/media-library.js';
import { NavidromeNotFoundError, type NavidromeClient } from '../../../src/client/navidrome-client.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

describe('getSongPlaylists', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('lists the playlists without a second read', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([{ id: 'pl-1', name: 'Road Trip', songCount: 3, duration: 600 }]);

    const result = await getSongPlaylists(mockClient as unknown as NavidromeClient, { songId: 'song-1' });

    expect(result.playlists.map((playlist) => playlist.id)).toEqual(['pl-1']);
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it('returns no playlists for a known song in none', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);
    mockClient.request.mockResolvedValue({ id: 'song-1' });

    const result = await getSongPlaylists(mockClient as unknown as NavidromeClient, { songId: 'song-1' });

    expect(result).toEqual({ playlists: [] });
    expect(mockClient.request).toHaveBeenCalledWith('/song/song-1');
  });

  it('reports an unknown song instead of an empty list, since Navidrome answers both the same', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);
    mockClient.request.mockRejectedValue(new NavidromeNotFoundError('Navidrome GET /song/gone', '/song/gone'));

    await expect(getSongPlaylists(mockClient as unknown as NavidromeClient, { songId: 'gone' }))
      .rejects.toThrow("Tool 'get_song_playlists' failed: Song not found: gone");
  });
});
