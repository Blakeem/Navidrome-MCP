/**
 * Unit Tests for Playlist Operations
 * 
 * Following UNIT-TEST-STRATEGY.md - Tier 1 Critical Tests
 * Combines live read operations with mocked write operations for comprehensive coverage.
 * 
 * HIGHEST RISK: Playlist operations modify server data - extensive mocking required for safety.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { getSharedLiveClient, createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { mockPlaylist } from '../../factories/mock-data.js';
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
      console.warn(`Skipping live tests: ${getSkipReason()}`);
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

        // Validate response structure (not specific content). `offset`/
        // `limit` are no longer echoed — they are LLM input echoes.
        expect(result).toHaveProperty('playlists');
        expect(result).toHaveProperty('total');
        expect(result).not.toHaveProperty('offset');
        expect(result).not.toHaveProperty('limit');

        // Ensure correct types
        expect(Array.isArray(result.playlists)).toBe(true);
        expect(typeof result.total).toBe('number');

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

        // offset/limit are no longer echoed — assert just on the items count
        // and the server-derived total.
        expect(result.playlists.length).toBeLessThanOrEqual(5);

        // Pagination correctness: `total` is the server's full match count
        // (from X-Total-Count), never the page size. So total must be at
        // least as large as the items we got back.
        expect(result.total).toBeGreaterThanOrEqual(result.playlists.length);
      });
    });

    describe('getPlaylist', () => {
      it('should return detailed playlist info when playlist exists', async () => {
        // First get a playlist ID from list
        const listResult = await listPlaylists(liveClient, { limit: 1 });
        
        if (listResult.playlists.length > 0) {
          const playlistId = listResult.playlists[0].id;
          const result = await getPlaylist(liveClient, { playlistId });

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
      it('should return a compact track structure by default', async () => {
        // Get a playlist with tracks
        const listResult = await listPlaylists(liveClient, { limit: 10 });
        const playlistWithTracks = listResult.playlists.find(p => p.songCount > 0);

        if (playlistWithTracks) {
          // Default call — compact mode.
          const result = await getPlaylistTracks(liveClient, {
            playlistId: playlistWithTracks.id,
            limit: 1
          });

          expect(result).toHaveProperty('tracks');
          expect(result).toHaveProperty('total');
          expect(Array.isArray(result.tracks)).toBe(true);

          if (result.tracks.length > 0) {
            const track = result.tracks[0];

            // Compact identity fields are always present.
            expect(track).toHaveProperty('position');
            expect(track).toHaveProperty('songId');
            expect(track).toHaveProperty('title');
            expect(track).toHaveProperty('artist');
            expect(track).toHaveProperty('album');
            expect(track).toHaveProperty('durationFormatted');

            // Verbose-only fields are omitted in compact mode to save context.
            expect(track).not.toHaveProperty('playlistId');
            expect(track).not.toHaveProperty('path');
            expect(track).not.toHaveProperty('duration');
          }
        }
      });

      it('should return full track metadata when verbose is true', async () => {
        const listResult = await listPlaylists(liveClient, { limit: 10 });
        const playlistWithTracks = listResult.playlists.find(p => p.songCount > 0);

        if (playlistWithTracks) {
          const result = await getPlaylistTracks(liveClient, {
            playlistId: playlistWithTracks.id,
            limit: 1,
            verbose: true
          });

          expect(result).toHaveProperty('tracks');
          expect(Array.isArray(result.tracks)).toBe(true);

          if (result.tracks.length > 0) {
            const track = result.tracks[0];

            // Identity fields plus the verbose-only fields are present.
            expect(track).toHaveProperty('position');
            expect(track).toHaveProperty('songId');
            expect(track).toHaveProperty('title');
            expect(track).toHaveProperty('artist');
            expect(track).toHaveProperty('playlistId');
            expect(track).toHaveProperty('duration');

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
          playlistId: 'playlist-123',
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
        
        const result = await deletePlaylist(mockClient, { playlistId: 'playlist-to-delete' });

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
        // Acknowledged HTTP call → success true regardless of count; count > 0
        // gets the "Added N tracks" message.
        expect(result.success).toBe(true);
        expect(result.message).toBe('Added 2 tracks to playlist');
      });

      it('should report that nothing matched (not a failure) when no tracks were added', async () => {
        // Navidrome does not dedupe, so added=0 means no requested ID matched a track.
        mockClient.request.mockResolvedValue({ added: 0 });

        const result = await addTracksToPlaylist(mockClient, {
          playlistId: 'playlist-123',
          songIds: ['song-1'],
        });

        expect(result.added).toBe(0);
        expect(result.success).toBe(true);
        expect(result.message).toBe('No tracks added. None of the given song, album, artist or disc IDs matched a track. Artist IDs match album-artist credits only.');
      });

      it('should default a missing `added` field to 0 (nothing-matched message)', async () => {
        // The response type says `{ added: number }` but Navidrome may omit
        // it; the guard must not produce NaN or undefined.
        mockClient.request.mockResolvedValue({});

        const result = await addTracksToPlaylist(mockClient, {
          playlistId: 'playlist-123',
          songIds: ['song-1'],
        });

        expect(result.added).toBe(0);
        expect(result.success).toBe(true);
        expect(result.message).toBe('No tracks added. None of the given song, album, artist or disc IDs matched a track. Artist IDs match album-artist credits only.');
      });

      it('should use singular "track" for a single add', async () => {
        mockClient.request.mockResolvedValue({ added: 1 });

        const result = await addTracksToPlaylist(mockClient, {
          playlistId: 'playlist-123',
          songIds: ['song-1'],
        });

        expect(result.message).toBe('Added 1 track to playlist');
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

      it('should reject when no content IDs are supplied', async () => {
        await expect(
          addTracksToPlaylist(mockClient, {
            playlistId: 'playlist-123',
          })
        ).rejects.toThrow();

        expect(mockClient.request).not.toHaveBeenCalled();
      });

      it('should resolve each disc to its release dates before adding', async () => {
        // Navidrome matches a disc on album, release date and disc number together.
        mockClient.request
          .mockResolvedValueOnce([
            { id: 's1', discNumber: 1, releaseDate: '2001-01-01' },
            { id: 's2', discNumber: 2, releaseDate: '2001-01-01' },
            { id: 's3', discNumber: 2, releaseDate: '2005-06-01' },
            { id: 's4', discNumber: 3 },
          ])
          .mockResolvedValueOnce({ added: 8 });

        await addTracksToPlaylist(mockClient, {
          playlistId: 'playlist-123',
          discs: [
            { albumId: 'album-1', discNumber: 2 },
            { albumId: 'album-1', discNumber: 3 },
            { albumId: 'album-1', discNumber: 9 },
          ],
        });

        expect(mockClient.request).toHaveBeenCalledTimes(2);
        expect(mockClient.request.mock.calls[0]?.[0]).toBe('/song?album_id=album-1&_start=0&_end=1000');
        const [endpoint, options] = mockClient.request.mock.calls[1]!;
        expect(endpoint).toBe('/playlist/playlist-123/tracks');
        expect(JSON.parse((options as RequestInit).body as string)).toEqual({
          discs: [
            { albumId: 'album-1', discNumber: 2, releaseDate: '2001-01-01' },
            { albumId: 'album-1', discNumber: 2, releaseDate: '2005-06-01' },
            { albumId: 'album-1', discNumber: 3, releaseDate: '' },
          ],
        });
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

        // Single POST to /tracks; no before/after pagination
        expect(mockClient.request).toHaveBeenCalledTimes(1);
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
      it('should remove tracks by position', async () => {
        const mockResponse = { 
          ids: ['1', '3'],
          message: '2 tracks removed successfully',
          success: true
        };
        
        mockClient.request.mockResolvedValue(mockResponse);
        
        const result = await removeTracksFromPlaylist(mockClient, { 
          playlistId: 'playlist-123',
          positions: ['1', '3']
        });

        expect(mockClient.request).toHaveBeenCalledWith(
          expect.stringContaining('/playlist/playlist-123/tracks'),
          expect.objectContaining({
            method: 'DELETE'
          })
        );

        expect(result.positions).toEqual(['1', '3']);
        expect(result.success).toBe(true);
        expect(result.message).toBe('Removed 2 tracks from playlist');
      });

      it('should read the single-id `{ id }` echo Navidrome sends for one removal', async () => {
        mockClient.request.mockResolvedValue({ id: '9' });

        const result = await removeTracksFromPlaylist(mockClient, {
          playlistId: 'playlist-123',
          positions: ['9'],
        });

        expect(result.positions).toEqual(['9']);
        expect(result.success).toBe(true);
        expect(result.message).toBe('Removed 1 track from playlist');
      });

      it('should fall back to the requested positions when the 2xx body echoes neither field', async () => {
        // A miss answers 404/500, so a 2xx means the requested positions were removed.
        mockClient.request.mockResolvedValue({ ids: null });

        const result = await removeTracksFromPlaylist(mockClient, {
          playlistId: 'playlist-123',
          positions: ['4', '7'],
        });

        expect(result.positions).toEqual(['4', '7']);
        expect(result.message).toBe('Removed 2 tracks from playlist');
      });

      it('should use singular "track" for a single removal', async () => {
        mockClient.request.mockResolvedValue({ id: '2' });

        const result = await removeTracksFromPlaylist(mockClient, {
          playlistId: 'playlist-123',
          positions: ['2'],
        });

        expect(result.message).toBe('Removed 1 track from playlist');
      });

      it('should reject more than 500 positions per call (proxy URL-length cap)', async () => {
        const tooMany = Array.from({ length: 501 }, (_, i) => String(i + 1));

        await expect(
          removeTracksFromPlaylist(mockClient, {
            playlistId: 'playlist-123',
            positions: tooMany,
          }),
        ).rejects.toThrow(/500 tracks per call/);

        // Rejected at the schema before any DELETE is issued.
        expect(mockClient.request).not.toHaveBeenCalled();
      });

      it('should reject a song ID passed as a position before any DELETE', async () => {
        await expect(
          removeTracksFromPlaylist(mockClient, {
            playlistId: 'playlist-123',
            positions: ['song-abc'],
          }),
        ).rejects.toThrow(/Track position must be a 1-based positive integer/);
        expect(mockClient.request).not.toHaveBeenCalled();
      });
    });

    describe('getPlaylistTracks (M3U export)', () => {
      it('should return the M3U body verbatim when the server honors the Accept header', async () => {
        const m3u = '#EXTM3U\n#EXTINF:180,Artist - Title\nhttp://example/stream';
        mockClient.requestWithMeta.mockResolvedValue({ data: m3u, total: null });

        const result = await getPlaylistTracks(mockClient, {
          playlistId: 'playlist-123',
          format: 'm3u',
        });

        expect(result).toEqual({ format: 'm3u', m3uContent: m3u });
      });

      it('should throw (not report an empty export) when the server returns JSON for an M3U request', async () => {
        // Accept-header negotiation failed: the server ignored audio/x-mpegurl and
        // sent the JSON track array, which the client parses to a non-string body.
        mockClient.requestWithMeta.mockResolvedValue({ data: [{ id: '1' }], total: 1 });

        await expect(
          getPlaylistTracks(mockClient, {
            playlistId: 'playlist-123',
            format: 'm3u',
          }),
        ).rejects.toThrow(/did not honor the audio\/x-mpegurl Accept header/);
      });
    });

    describe('reorderPlaylistTrack', () => {
      const sentInsertBefore = (): string =>
        JSON.parse((mockClient.request.mock.calls[0]![1] as RequestInit).body as string).insert_before;

      beforeEach(() => {
        mockClient.requestWithMeta.mockResolvedValue({ data: [], total: 5 });
        mockClient.request.mockResolvedValue({ id: 'echo' });
      });

      it('should move a track up to the given slot', async () => {
        const result = await reorderPlaylistTrack(mockClient, {
          playlistId: 'playlist-123',
          position: '5',
          insertBefore: 1,
        });

        expect(mockClient.requestWithMeta).toHaveBeenCalledWith('/playlist/playlist-123/tracks?_start=0&_end=1');
        expect(mockClient.request).toHaveBeenCalledWith(
          '/playlist/playlist-123/tracks/5',
          expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'application/json' } }),
        );
        expect(sentInsertBefore()).toBe('1');
        expect(result).toEqual({
          previousPosition: 5,
          newPosition: 1,
          message: 'Moved track from position 5 to position 1',
          success: true,
        });
      });

      it('should send the final position for a downward move', async () => {
        const result = await reorderPlaylistTrack(mockClient, { playlistId: 'playlist-123', position: '1', insertBefore: 4 });

        expect(sentInsertBefore()).toBe('3');
        expect(result.newPosition).toBe(3);
      });

      it('should send the last position for an append (N+1)', async () => {
        await reorderPlaylistTrack(mockClient, { playlistId: 'playlist-123', position: '2', insertBefore: 6 });

        expect(sentInsertBefore()).toBe('5');
      });

      it('should reject an out-of-range position without moving anything', async () => {
        await expect(
          reorderPlaylistTrack(mockClient, { playlistId: 'playlist-123', position: '6', insertBefore: 1 }),
        ).rejects.toThrow(/out of range[\s\S]*get_playlist_tracks/);
        expect(mockClient.request).not.toHaveBeenCalled();
      });

      it('should reject an insertBefore past N+1 without moving anything', async () => {
        await expect(
          reorderPlaylistTrack(mockClient, { playlistId: 'playlist-123', position: '1', insertBefore: 7 }),
        ).rejects.toThrow(/out of range/);
        expect(mockClient.request).not.toHaveBeenCalled();
      });

      it('should reject position 0 before reading the playlist size', async () => {
        await expect(
          reorderPlaylistTrack(mockClient, { playlistId: 'playlist-123', position: '0', insertBefore: 1 }),
        ).rejects.toThrow(/Track position must be a 1-based positive integer/);
        expect(mockClient.requestWithMeta).not.toHaveBeenCalled();
      });

      it('should skip the PUT when the track already sits in the target slot', async () => {
        const result = await reorderPlaylistTrack(mockClient, { playlistId: 'playlist-123', position: '3', insertBefore: 4 });

        expect(mockClient.request).not.toHaveBeenCalled();
        expect(result).toMatchObject({ previousPosition: 3, newPosition: 3, success: true });
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
        getPlaylist(mockClient, { playlistId: 'non-existent-id' })
      ).rejects.toThrow('Playlist not found');
    });

    it('should handle permission errors for unauthorized operations', async () => {
      mockClient.request.mockRejectedValue(new Error('Insufficient permissions'));
      
      await expect(
        deletePlaylist(mockClient, { playlistId: 'protected-playlist' })
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
        getPlaylist(mockClient, { playlistId: '' })
      ).rejects.toThrow();
    });

    it('should validate the positions array for removal', async () => {
      await expect(
        removeTracksFromPlaylist(mockClient, { 
          playlistId: 'playlist-123', 
          positions: [] 
        })
      ).rejects.toThrow();
    });

    it('should validate position parameters for reordering', async () => {
      await expect(
        reorderPlaylistTrack(mockClient, { 
          playlistId: 'playlist-123',
          position: '1',
          insertBefore: -1 
        })
      ).rejects.toThrow();
    });
  });
});