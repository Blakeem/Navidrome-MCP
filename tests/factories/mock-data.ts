/**
 * Mock Data Factory for Navidrome MCP Server Tests
 * 
 * Provides consistent mock data structures for testing without
 * relying on specific music library content.
 */

import type { SongDTO, AlbumDTO, ArtistDTO, PlaylistDTO } from '../../src/types/index.js';

/**
 * Mock song data following the SongDTO interface structure
 * Used for testing song-related operations without real data dependency
 */
export const mockSong: SongDTO = {
  id: 'mock-song-id-001',
  title: 'Mock Song Title',
  artist: 'Mock Artist Name',
  album: 'Mock Album Name',
  year: 2023,
  genre: 'Test Genre',
  duration: 180,
  track: 1,
  discNumber: 1,
  size: 4567890,
  bitRate: 320,
  path: '/mock/path/to/song.mp3',
  suffix: 'mp3',
  contentType: 'audio/mpeg',
  starred: false,
  playCount: 5,
  rating: 0,
  albumId: 'mock-album-id-001',
  artistId: 'mock-artist-id-001',
};

/**
 * Mock album data following the AlbumDTO interface structure
 */
export const mockAlbum: AlbumDTO = {
  id: 'mock-album-id-001',
  name: 'Mock Album Name',
  artist: 'Mock Artist Name',
  artistId: 'mock-artist-id-001',
  year: 2023,
  genre: 'Test Genre',
  songCount: 10,
  duration: 1800,
  playCount: 25,
  starred: false,
  rating: 0,
  coverArt: 'mock-cover-art-id',
};

/**
 * Mock artist data following the ArtistDTO interface structure  
 */
export const mockArtist: ArtistDTO = {
  id: 'mock-artist-id-001',
  name: 'Mock Artist Name',
  albumCount: 3,
  songCount: 30,
  starred: false,
  rating: 0,
};

/**
 * Mock playlist data following the PlaylistDTO interface structure
 */
export const mockPlaylist: PlaylistDTO = {
  id: 'mock-playlist-id-001',
  name: 'Mock Test Playlist',
  comment: 'A test playlist for unit testing',
  owner: 'test-user',
  public: false,
  songCount: 5,
  duration: 900,
  created: '2023-01-01T12:00:00Z',
  changed: '2023-01-01T12:00:00Z',
};

/**
 * Mock API responses for testing
 */
export const mockResponses = {
  // List operations responses
  listSongs: {
    songs: [mockSong],
    total: 1,
    offset: 0,
    limit: 100,
  },
  
  listAlbums: {
    albums: [mockAlbum],
    total: 1,
    offset: 0,
    limit: 100,
  },
  
  listArtists: {
    artists: [mockArtist],
    total: 1,
    offset: 0,
    limit: 100,
  },
  
  listPlaylists: {
    playlists: [mockPlaylist],
    total: 1,
    offset: 0,
    limit: 100,
  },
  
  // Server info response for test_connection
  serverInfo: {
    serverVersion: '0.52.5',
    apiVersion: '1.16.1',
    features: {
      lastfm: true,
      radioBrowser: true,
      lyrics: true,
    },
    scanStatus: 'IDLE',
    libraryStats: {
      songs: 1000,
      albums: 100,
      artists: 50,
      playlists: 10,
    },
  },
  
  // Connection test response
  connectionTest: {
    status: 'OK',
    message: 'Successfully connected to Navidrome server',
    serverInfo: {
      serverVersion: '0.52.5',
      apiVersion: '1.16.1',
      features: {
        lastfm: true,
        radioBrowser: true,
        lyrics: true,
      },
      scanStatus: 'IDLE',
      libraryStats: {
        songs: 1000,
        albums: 100,
        artists: 50,
        playlists: 10,
      },
    },
  },
};