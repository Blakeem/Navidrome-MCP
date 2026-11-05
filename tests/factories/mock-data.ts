import type { PlaylistDTO } from '../../src/types/index.js';

export const mockPlaylist: PlaylistDTO = {
  id: 'mock-playlist-id-001',
  name: 'Mock Test Playlist',
  comment: 'A test playlist for unit testing',
  owner: 'test-user',
  public: false,
  songCount: 5,
  duration: 900,
  durationFormatted: '15:00',
  createdAt: '2023-01-01T12:00:00Z',
  updatedAt: '2023-01-01T12:00:00Z',
};