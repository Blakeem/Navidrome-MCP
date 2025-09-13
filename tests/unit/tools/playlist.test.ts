/**
 * Unit Tests for Playlist Operations
 * 
 * Following UNIT-TEST-STRATEGY.md - Tier 1 Critical Tests
 * Combines live read operations with mocked write operations for comprehensive coverage.
 * 
 * HIGHEST RISK: Playlist operations modify server data - extensive mocking required for safety.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { getSharedLiveClient, createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { mockPlaylist, mockSong, mockResponses } from '../../factories/mock-data.js';
import { describeLive, shouldSkipLiveTests, getSkipReason } from '../../helpers/env-detection.js';

// Import playlist management functions
import {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  getPlaylistTracks,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistTrack,
} from '../../../src/tools/playlist-management.js';

describe('Playlist Operations - Tier 1 Critical Tests', () => {
  let liveClient: NavidromeClient;

  beforeAll(async () => {
    if (shouldSkipLiveTests()) {
      console.log(`Skipping live tests: ${getSkipReason()}`);
      return;
    }
    // Use shared client for read operations testing (avoids rate limiting)
    liveClient = await getSharedLiveClient();
  });

  describeLive('Live Read Operations - API Compatibility', () => {
    describe('listPlaylists', () => {
      it('should return valid playlist structure from live server', async () => {
        // Test with minimal parameters to avoid large responses
        const result = await listPlaylists(liveClient, { limit: 1 });

        // Validate response structure (not specific content)
        expect(result).toHaveProperty('playlists');
        expect(result).toHaveProperty('total');
        expect(result).toHaveProperty('offset');
        expect(result).toHaveProperty('limit');

        // Ensure correct types
        expect(Array.isArray(result.playlists)).toBe(true);
        expect(typeof result.total).toBe('number');
        expect(typeof result.offset).toBe('number');
        expect(typeof result.limit).toBe('number');

        // If playlists exist, verify structure
        if (result.playlists.length > 0) {
          const playlist = result.playlists[0];
          
          // Required fields from PlaylistDTO
          expect(playlist).toHaveProperty('id');
          expect(playlist).toHaveProperty('name');
          expect(playlist).toHaveProperty('owner');
          expect(playlist).toHaveProperty('public');
          expect(playlist).toHaveProperty('songCount');
          
          // Verify field types
          expect(typeof playlist.id).toBe('string');
          expect(typeof playlist.name).toBe('string');
          expect(typeof playlist.owner).toBe('string');
          expect(typeof playlist.public).toBe('boolean');
          expect(typeof playlist.songCount).toBe('number');
        }
      });

      it('should handle pagination parameters correctly', async () => {
        const result = await listPlaylists(liveClient, { 
          limit: 5, 
          offset: 0,
          sort: 'name',
          order: 'ASC' 
        });

        expect(result.limit).toBe(5);
        expect(result.offset).toBe(0);
        
        // Should not return more than requested
        expect(result.playlists.length).toBeLessThanOrEqual(5);
      });
    });

    describe('getPlaylist', () => {
      it('should return detailed playlist info when playlist exists', async () => {
        // First get a playlist ID from list
        const listResult = await listPlaylists(liveClient, { limit: 1 });
        
        if (listResult.playlists.length > 0) {
          const playlistId = listResult.playlists[0].id;
          const result = await getPlaylist(liveClient, { id: playlistId });

          // Validate detailed playlist structure
          expect(result).toHaveProperty('id');
          expect(result).toHaveProperty('name');
          expect(result).toHaveProperty('owner');
          expect(result).toHaveProperty('public');
          expect(result).toHaveProperty('songCount');
          expect(result).toHaveProperty('durationFormatted');
          
          expect(result.id).toBe(playlistId);
        }
      });
    });

    describe('getPlaylistTracks', () => {
      it('should return valid track structure for existing playlists', async () => {
        // Get a playlist with tracks
        const listResult = await listPlaylists(liveClient, { limit: 10 });
        const playlistWithTracks = listResult.playlists.find(p => p.songCount > 0);
        
        if (playlistWithTracks) {
          const result = await getPlaylistTracks(liveClient, { 
            playlistId: playlistWithTracks.id,
            limit: 1 
          });

          expect(result).toHaveProperty('tracks');
          expect(result).toHaveProperty('total');
          expect(Array.isArray(result.tracks)).toBe(true);

          if (result.tracks.length > 0) {
            const track = result.tracks[0];
            
            // Required PlaylistTrackDTO fields
            expect(track).toHaveProperty('id');
            expect(track).toHaveProperty('mediaFileId');
            expect(track).toHaveProperty('playlistId');
            expect(track).toHaveProperty('title');
            expect(track).toHaveProperty('artist');
            
            expect(track.playlistId).toBe(playlistWithTracks.id);
          }
        }
      });
    });
  });

  describe('Mocked Write Operations - Business Logic Safety', () => {
    let mockClient: MockNavidromeClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    describe('createPlaylist', () => {
      it('should create playlist with correct API call structure', async () => {
        const mockResponse = { 
          id: 'new-playlist-123', 
          name: 'Test Playlist',
          owner: 'test-user',
          public: false,
          songCount: 0,
          duration: 0,
          created: '2023-01-01T12:00:00Z',
          changed: '2023-01-01T12:00:00Z'
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        const result = await createPlaylist(mockClient, { 
          name: 'Test Playlist',
          comment: 'A test playlist',
          public: false 
        });

        // Verify correct API call was made
        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('Test Playlist')
          })
        );

        // Verify response structure
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('name');
        expect(result.name).toBe('Test Playlist');
      });

      it('should handle minimal playlist creation', async () => {
        const mockResponse = { 
          id: 'minimal-playlist-456',
          name: 'Minimal Playlist',
          owner: 'test-user',
          public: false,
          songCount: 0,
          duration: 0,
          created: '2023-01-01T12:00:00Z',
          changed: '2023-01-01T12:00:00Z'
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        await createPlaylist(mockClient, { name: 'Minimal Playlist' });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('Minimal Playlist')
          })
        );
      });
    });

    describe('updatePlaylist', () => {
      it('should update playlist metadata with correct parameters', async () => {
        const mockResponse = { 
          ...mockPlaylist,
          name: 'Updated Playlist Name',
          comment: 'Updated description',
          public: true
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        const result = await updatePlaylist(mockClient, { 
          id: 'playlist-123',
          name: 'Updated Playlist Name',
          comment: 'Updated description',
          public: true
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123',
          expect.objectContaining({
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('Updated Playlist Name')
          })
        );

        expect(result.name).toBe('Updated Playlist Name');
      });
    });

    describe('deletePlaylist', () => {
      it('should delete playlist with correct ID parameter', async () => {
        mockClient.request.mockResolvedValue({ success: true });
        
        const result = await deletePlaylist(mockClient, { id: 'playlist-to-delete' });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-to-delete',
          expect.objectContaining({
            method: 'DELETE'
          })
        );

        expect(result).toHaveProperty('success');
        expect(result.success).toBe(true);
      });
    });

    describe('addTracksToPlaylist', () => {
      it('should add individual song IDs to playlist', async () => {
        const mockResponse = { 
          added: 2,
          message: '2 tracks added successfully',
          success: true
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        const result = await addTracksToPlaylist(mockClient, {
          playlistId: 'playlist-123',
          songIds: ['song-1', 'song-2']
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123/tracks',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('song-1')
          })
        );

        expect(result.added).toBe(2);
      });

      it('should add entire albums to playlist', async () => {
        const mockResponse = { 
          added: 12,
          message: '12 tracks added from albums',
          success: true
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        await addTracksToPlaylist(mockClient, { 
          playlistId: 'playlist-123',
          albumIds: ['album-1', 'album-2']
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123/tracks',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('album-1')
          })
        );
      });

      it('should add artist discographies to playlist', async () => {
        const mockResponse = { 
          added: 50,
          message: '50 tracks added from artists',
          success: true
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        await addTracksToPlaylist(mockClient, { 
          playlistId: 'playlist-123',
          artistIds: ['artist-1']
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123/tracks',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('artist-1')
          })
        );
      });

      it('should add specific disc tracks to playlist', async () => {
        const mockResponse = { 
          added: 8,
          message: '8 tracks added from disc',
          success: true
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        await addTracksToPlaylist(mockClient, { 
          playlistId: 'playlist-123',
          discs: [{ albumId: 'album-1', discNumber: 2 }]
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123/tracks',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('album-1')
          })
        );
      });
    });

    describe('addTracksToPlaylist with multiple content types', () => {
      it('should handle multiple content types in single efficient operation', async () => {
        const mockAddResponse = {
          added: 15,
          message: 'Successfully added 15 tracks to playlist',
          success: true
        };

        mockClient.request.mockResolvedValue(mockAddResponse);

        const result = await addTracksToPlaylist(mockClient, {
          playlistId: 'playlist-123',
          songIds: ['song-1', 'song-2', 'song-3'],
          albumIds: ['album-1', 'album-2'],
          artistIds: ['artist-1']
        });

        // Should make efficient API calls
        expect(mockClient.request).toHaveBeenCalledTimes(3); // Before count, adding tracks, after count
        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123/tracks',
          expect.objectContaining({
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('album-1')
          })
        );

        // Verify return structure matches enhanced capability
        expect(result).toHaveProperty('added');
        expect(result).toHaveProperty('message');
        expect(result).toHaveProperty('success');
        expect(result.added).toBe(15);
        expect(result.success).toBe(true);
      });
    });

    describe('removeTracksFromPlaylist', () => {
      it('should remove tracks by position IDs', async () => {
        const mockResponse = { 
          ids: ['1', '3'],
          message: '2 tracks removed successfully',
          success: true
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        const result = await removeTracksFromPlaylist(mockClient, { 
          playlistId: 'playlist-123',
          trackIds: ['1', '3']
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.stringContaining('/playlist/playlist-123/tracks'),
          expect.objectContaining({
            method: 'DELETE'
          })
        );

        expect(result.ids).toEqual(['1', '3']);
      });
    });

    describe('reorderPlaylistTrack', () => {
      it('should move track to new position', async () => {
        const mockResponse = { 
          id: 5
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        const result = await reorderPlaylistTrack(mockClient, { 
          playlistId: 'playlist-123',
          trackId: '5',
          insert_before: 1
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123/tracks/5',
          expect.objectContaining({
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.stringContaining('1')
          })
        );

        expect(result.id).toBe(5);
      });
    });
  });

  describe('Error Handling', () => {
    let mockClient: MockNavidromeClient;

    beforeEach(() => {
      mockClient = createMockClient();
    });

    it('should handle network errors gracefully', async () => {
      mockClient.request.mockRejectedValue(new Error('Network connection failed'));
      
      await expect(
        createPlaylist(mockClient, { name: 'Test' })
      ).rejects.toThrow('Network connection failed');
    });

    it('should handle API errors for invalid playlist IDs', async () => {
      mockClient.request.mockRejectedValue(new Error('Playlist not found'));
      
      await expect(
        getPlaylist(mockClient, { id: 'non-existent-id' })
      ).rejects.toThrow('Playlist not found');
    });

    it('should handle permission errors for unauthorized operations', async () => {
      mockClient.request.mockRejectedValue(new Error('Insufficient permissions'));
      
      await expect(
        deletePlaylist(mockClient, { id: 'protected-playlist' })
      ).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('Input Validation', () => {
    let mockClient: MockNavidromeClient;

    beforeEach(() => {
      mockClient = createMockClient();
      mockClient.request.mockResolvedValue(mockPlaylist);
    });

    it('should validate required playlist name for creation', async () => {
      await expect(
        createPlaylist(mockClient, { name: '' })
      ).rejects.toThrow();
    });

    it('should validate playlist ID format', async () => {
      await expect(
        getPlaylist(mockClient, { id: '' })
      ).rejects.toThrow();
    });

    it('should validate track IDs array for removal', async () => {
      await expect(
        removeTracksFromPlaylist(mockClient, { 
          playlistId: 'playlist-123', 
          trackIds: [] 
        })
      ).rejects.toThrow();
    });

    it('should validate position parameters for reordering', async () => {
      await expect(
        reorderPlaylistTrack(mockClient, { 
          playlistId: 'playlist-123',
          trackId: '1',
          insert_before: -1 
        })
      ).rejects.toThrow();
    });
  });
});