/**
 * Mock Data Factory for Navidrome MCP Server Tests
 * 
 * Provides consistent mock data structures for testing without
 * relying on specific music library content.
 */

import type { PlaylistDTO } from '../../src/types/index.js';

/**
 * Mock playlist data following the PlaylistDTO interface structure
 */
export const mockPlaylist: PlaylistDTO = {
  playlistId: 'mock-playlist-id-001',
  name: 'Mock Test Playlist',
  comment: 'A test playlist for unit testing',
  owner: 'test-user',
  public: false,
  songCount: 5,
  duration: 900,
  created: '2023-01-01T12:00:00Z',
  changed: '2023-01-01T12:00:00Z',
};