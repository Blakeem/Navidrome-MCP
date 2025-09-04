/**
 * Navidrome MCP Server - Playlist Management Tools
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

import { z } from 'zod';
import type { NavidromeClient } from '../client/navidrome-client.js';
import {
  transformPlaylistsToDTO,
  transformToPlaylistDTO,
  formatDuration,
  type RawPlaylist,
} from '../transformers/song-transformer.js';
import type {
  PlaylistDTO,
  PlaylistTrackDTO,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  AddTracksToPlaylistRequest,
  AddTracksToPlaylistResponse,
  RemoveTracksFromPlaylistResponse,
  ReorderPlaylistTrackRequest,
  ReorderPlaylistTrackResponse,
} from '../types/index.js';
import { DEFAULT_VALUES } from '../constants/defaults.js';

// Common pagination schema
const PaginationSchema = z.object({
  limit: z.number().min(1).max(500).optional().default(DEFAULT_VALUES.PLAYLISTS_LIMIT),
  offset: z.number().min(0).optional().default(0),
  sort: z.string().optional().default('name'),
  order: z.enum(['ASC', 'DESC']).optional().default('ASC'),
});

const GetByIdSchema = z.object({
  id: z.string().min(1, 'Playlist ID is required'),
});

const CreatePlaylistSchema = z.object({
  name: z.string().min(1, 'Playlist name is required'),
  comment: z.string().optional(),
  public: z.boolean().optional().default(false),
});

const UpdatePlaylistSchema = z.object({
  id: z.string().min(1, 'Playlist ID is required'),
  name: z.string().min(1).optional(),
  comment: z.string().optional(),
  public: z.boolean().optional(),
});

const AddTracksSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  ids: z.array(z.string()).optional(),
  albumIds: z.array(z.string()).optional(),
  artistIds: z.array(z.string()).optional(),
  discs: z.array(z.object({
    albumId: z.string(),
    discNumber: z.number(),
  })).optional(),
});

const RemoveTracksSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  trackIds: z.array(z.string()).min(1, 'At least one track ID is required'),
});

const ReorderTrackSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  trackId: z.string().min(1, 'Track ID is required'),
  insert_before: z.number().min(0, 'Insert position must be non-negative'),
});

const GetPlaylistTracksSchema = z.object({
  playlistId: z.string().min(1, 'Playlist ID is required'),
  limit: z.number().min(1).max(500).optional().default(DEFAULT_VALUES.PLAYLIST_TRACKS_LIMIT),
  offset: z.number().min(0).optional().default(0),
  format: z.enum(['json', 'm3u']).optional().default('json'),
});

/**
 * Raw playlist track data from Navidrome API
 */
interface RawPlaylistTrack {
  id: number;
  mediaFileId?: string;
  playlistId: string;
  title?: string;
  album?: string;
  artist?: string;
  albumArtist?: string;
  duration?: number;
  bitRate?: number;
  path?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
  [key: string]: unknown;
}

/**
 * Transform raw playlist track data to DTO
 */
function transformToPlaylistTrackDTO(rawTrack: RawPlaylistTrack): PlaylistTrackDTO {
  const dto: PlaylistTrackDTO = {
    id: rawTrack.id,
    mediaFileId: rawTrack.mediaFileId || String(rawTrack.id),
    playlistId: rawTrack.playlistId,
    title: rawTrack.title || '',
    album: rawTrack.album || '',
    artist: rawTrack.artist || '',
    duration: rawTrack.duration || 0,
    durationFormatted: formatDuration(rawTrack.duration),
  };

  // Add optional fields only if they have values
  if (rawTrack.albumArtist) {
    dto.albumArtist = rawTrack.albumArtist;
  }

  if (rawTrack.bitRate !== undefined) {
    dto.bitRate = rawTrack.bitRate;
  }

  if (rawTrack.path) {
    dto.path = rawTrack.path;
  }

  if (rawTrack.trackNumber !== undefined) {
    dto.trackNumber = rawTrack.trackNumber;
  }

  if (rawTrack.year !== undefined) {
    dto.year = rawTrack.year;
  }

  if (rawTrack.genre) {
    dto.genre = rawTrack.genre;
  }

  return dto;
}

/**
 * List all playlists accessible to the user
 */
export async function listPlaylists(client: NavidromeClient, args: unknown): Promise<{
  playlists: PlaylistDTO[];
  total: number;
  offset: number;
  limit: number;
}> {
  const params = PaginationSchema.parse(args);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
      _sort: params.sort,
      _order: params.order,
    });

    const rawPlaylists = await client.request<unknown>(`/playlist?${queryParams.toString()}`);
    const playlists = transformPlaylistsToDTO(rawPlaylists);

    return {
      playlists,
      total: playlists.length,
      offset: params.offset,
      limit: params.limit,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch playlists: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get a specific playlist by ID
 */
export async function getPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = GetByIdSchema.parse(args);

  try {
    const rawPlaylist = await client.request<unknown>(`/playlist/${params.id}`);
    return transformToPlaylistDTO(rawPlaylist as RawPlaylist);
  } catch (error) {
    throw new Error(
      `Failed to fetch playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Create a new playlist
 */
export async function createPlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = CreatePlaylistSchema.parse(args);

  try {
    const requestBody: CreatePlaylistRequest = {
      name: params.name,
      public: params.public,
    };
    
    if (params.comment !== undefined) {
      requestBody.comment = params.comment;
    }

    const rawPlaylist = await client.request<unknown>('/playlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const playlist = transformToPlaylistDTO(rawPlaylist as RawPlaylist);
    
    // Fix the name if it's not properly returned from API
    if (!playlist.name || playlist.name === 'Unknown Playlist') {
      playlist.name = params.name;
    }
    
    // Fix the comment if it's not properly returned from API
    if (params.comment && (!playlist.comment || playlist.comment === '')) {
      playlist.comment = params.comment;
    }
    
    return playlist;
  } catch (error) {
    throw new Error(
      `Failed to create playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Update a playlist's metadata
 */
export async function updatePlaylist(client: NavidromeClient, args: unknown): Promise<PlaylistDTO> {
  const params = UpdatePlaylistSchema.parse(args);

  try {
    const requestBody: UpdatePlaylistRequest = {};
    
    if (params.name !== undefined) {
      requestBody.name = params.name;
    }
    
    if (params.comment !== undefined) {
      requestBody.comment = params.comment;
    }
    
    if (params.public !== undefined) {
      requestBody.public = params.public;
    }

    const rawPlaylist = await client.request<unknown>(`/playlist/${params.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const playlist = transformToPlaylistDTO(rawPlaylist as RawPlaylist);
    
    // Fix the name if it was updated but not properly returned from API
    if (params.name && (!playlist.name || playlist.name === 'Unknown Playlist')) {
      playlist.name = params.name;
    }
    
    // Fix the comment if it was updated but not properly returned from API
    if (params.comment !== undefined && (!playlist.comment || playlist.comment === '')) {
      playlist.comment = params.comment;
    }
    
    return playlist;
  } catch (error) {
    throw new Error(
      `Failed to update playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Delete a playlist (owner or admin only)
 */
export async function deletePlaylist(client: NavidromeClient, args: unknown): Promise<{ success: boolean; id: string; message: string }> {
  const params = GetByIdSchema.parse(args);

  try {
    await client.request<unknown>(`/playlist/${params.id}`, {
      method: 'DELETE',
    });

    return {
      success: true,
      id: params.id,
      message: `Successfully deleted playlist with ID: ${params.id}`,
    };
  } catch (error) {
    throw new Error(
      `Failed to delete playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get all tracks in a playlist
 */
export async function getPlaylistTracks(client: NavidromeClient, args: unknown): Promise<{
  tracks: PlaylistTrackDTO[];
  total: number;
  offset: number;
  limit: number;
  playlistId: string;
  format: string;
  m3uContent?: string;
}> {
  const params = GetPlaylistTracksSchema.parse(args);

  try {
    const queryParams = new URLSearchParams({
      _start: params.offset.toString(),
      _end: (params.offset + params.limit).toString(),
    });

    const headers: Record<string, string> = {};
    if (params.format === 'm3u') {
      headers['Accept'] = 'audio/x-mpegurl';
    }

    const response = await client.request<unknown>(`/playlist/${params.playlistId}/tracks?${queryParams.toString()}`, {
      method: 'GET',
      headers,
    });

    if (params.format === 'm3u') {
      return {
        tracks: [],
        total: 0,
        offset: params.offset,
        limit: params.limit,
        playlistId: params.playlistId,
        format: 'm3u',
        m3uContent: response as string,
      };
    }

    const tracks = Array.isArray(response) 
      ? response.map((track: unknown) => transformToPlaylistTrackDTO(track as RawPlaylistTrack))
      : [];

    return {
      tracks,
      total: tracks.length,
      offset: params.offset,
      limit: params.limit,
      playlistId: params.playlistId,
      format: 'json',
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch playlist tracks: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Add tracks to a playlist
 */
export async function addTracksToPlaylist(client: NavidromeClient, args: unknown): Promise<AddTracksToPlaylistResponse> {
  const params = AddTracksSchema.parse(args);

  try {
    // Get track count before adding
    const tracksBefore = await getPlaylistTracks(client, { 
      playlistId: params.playlistId, 
      limit: 500, 
      offset: 0 
    });
    const countBefore = tracksBefore.tracks.length;

    const requestBody: AddTracksToPlaylistRequest = {};
    
    if (params.ids !== undefined) {
      requestBody.ids = params.ids;
    }
    
    if (params.albumIds !== undefined) {
      requestBody.albumIds = params.albumIds;
    }
    
    if (params.artistIds !== undefined) {
      requestBody.artistIds = params.artistIds;
    }
    
    if (params.discs !== undefined) {
      requestBody.discs = params.discs;
    }

    const response = await client.request<{ added: number }>(`/playlist/${params.playlistId}/tracks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Get track count after adding
    const tracksAfter = await getPlaylistTracks(client, { 
      playlistId: params.playlistId, 
      limit: 500, 
      offset: 0 
    });
    const countAfter = tracksAfter.tracks.length;

    // Use actual count difference as fallback if API response is incorrect
    const apiCount = response.added || 0;
    const actualCount = countAfter - countBefore;
    const addedCount = Math.max(apiCount, actualCount);
    const success = addedCount > 0;
    
    return {
      added: addedCount,
      message: `Successfully added ${addedCount} track${addedCount !== 1 ? 's' : ''} to playlist`,
      success,
    };
  } catch (error) {
    throw new Error(
      `Failed to add tracks to playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Batch add multiple sets of tracks to a playlist
 */
export async function batchAddTracksToPlaylist(
  client: NavidromeClient, 
  args: unknown
): Promise<{ results: AddTracksToPlaylistResponse[]; summary: string }> {
  const params = args as {
    playlistId: string;
    trackSets: Array<{
      ids?: string[];
      albumIds?: string[];
      artistIds?: string[];
      discs?: Array<{ albumId: string; discNumber: number }>;
    }>;
  };
  
  if (!params.playlistId) {
    throw new Error('Playlist ID is required');
  }
  
  if (!params.trackSets || !Array.isArray(params.trackSets)) {
    throw new Error('Track sets array is required');
  }
  
  if (params.trackSets.length === 0) {
    throw new Error('At least one track set must be provided');
  }
  
  const results: AddTracksToPlaylistResponse[] = [];
  let totalAdded = 0;
  let successCount = 0;
  let failedCount = 0;
  
  for (const trackSet of params.trackSets) {
    try {
      const result = await addTracksToPlaylist(client, {
        playlistId: params.playlistId,
        ...trackSet
      });
      
      results.push(result);
      
      if (result.success) {
        successCount++;
        totalAdded += result.added;
      } else {
        failedCount++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({
        added: 0,
        message: `Failed to add tracks: ${errorMessage}`,
        success: false
      });
      failedCount++;
    }
  }
  
  let summary = `Successfully processed ${successCount} of ${params.trackSets.length} track sets. `;
  summary += `Total tracks added: ${totalAdded}.`;
  if (failedCount > 0) {
    summary += ` ${failedCount} sets failed.`;
  }
  
  return {
    results,
    summary
  };
}

/**
 * Remove tracks from a playlist
 */
export async function removeTracksFromPlaylist(client: NavidromeClient, args: unknown): Promise<RemoveTracksFromPlaylistResponse> {
  const params = RemoveTracksSchema.parse(args);

  try {
    const queryParams = new URLSearchParams();
    params.trackIds.forEach(id => queryParams.append('id', id));

    const response = await client.request<{ ids: string[] }>(`/playlist/${params.playlistId}/tracks?${queryParams.toString()}`, {
      method: 'DELETE',
    });

    const removedIds = response.ids || params.trackIds;
    return {
      ids: removedIds,
      message: `Successfully removed ${removedIds.length} track${removedIds.length !== 1 ? 's' : ''} from playlist`,
      success: removedIds.length > 0,
    };
  } catch (error) {
    throw new Error(
      `Failed to remove tracks from playlist: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Reorder a track in the playlist
 */
export async function reorderPlaylistTrack(client: NavidromeClient, args: unknown): Promise<ReorderPlaylistTrackResponse> {
  const params = ReorderTrackSchema.parse(args);

  try {
    const requestBody: ReorderPlaylistTrackRequest = {
      insert_before: params.insert_before.toString(),
    };

    const response = await client.request<{ id: number }>(`/playlist/${params.playlistId}/tracks/${params.trackId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    return {
      id: response.id || parseInt(params.trackId, 10),
    };
  } catch (error) {
    throw new Error(
      `Failed to reorder playlist track: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}