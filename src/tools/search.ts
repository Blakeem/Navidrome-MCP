/**
 * Navidrome MCP Server - Search Tools
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

import type { Config } from '../config.js';
import { transformSongsToDTO, transformAlbumsToDTO, transformArtistsToDTO } from '../transformers/song-transformer.js';
import type { SongDTO, AlbumDTO, ArtistDTO } from '../types/index.js';
import crypto from 'crypto';
import { ErrorFormatter } from '../utils/error-formatter.js';
import {
  SearchAllSchema,
  SearchSongsSchema,
  SearchAlbumsSchema,
  SearchArtistsSchema,
} from '../schemas/index.js';

interface SubsonicSearchResult {
  'subsonic-response': {
    status: string;
    version: string;
    searchResult3?: {
      artist?: unknown[];
      album?: unknown[];
      song?: unknown[];
    };
  };
}

/**
 * Create Subsonic API authentication parameters
 */
function createSubsonicAuth(config: Config): URLSearchParams {
  const salt = crypto.randomBytes(16).toString('hex');
  const token = crypto.createHash('md5').update(config.navidromePassword + salt).digest('hex');
  
  return new URLSearchParams({
    u: config.navidromeUsername,
    t: token,
    s: salt,
    v: '1.16.1',
    c: 'NavidromeMCP',
    f: 'json',
  });
}

/**
 * Search across all content types (artists, albums, songs)
 */
export async function searchAll(config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  albums: AlbumDTO[];
  songs: SongDTO[];
  query: string;
  totalResults: number;
}> {
  const params = SearchAllSchema.parse(args);

  try {
    const searchParams = createSubsonicAuth(config);
    searchParams.set('query', params.query);
    searchParams.set('artistCount', params.artistCount.toString());
    searchParams.set('albumCount', params.albumCount.toString());
    searchParams.set('songCount', params.songCount.toString());

    const response = await fetch(`${config.navidromeUrl}/rest/search3?${searchParams.toString()}`);
    
    if (!response.ok) {
      throw new Error(ErrorFormatter.apiRequest('search', response));
    }

    const data = await response.json() as SubsonicSearchResult;
    
    if (data['subsonic-response'].status !== 'ok') {
      throw new Error(ErrorFormatter.apiResponse('search'));
    }

    const searchResult = data['subsonic-response'].searchResult3 || {};
    
    const artists = transformArtistsToDTO(searchResult.artist || []);
    const albums = transformAlbumsToDTO(searchResult.album || []);
    const songs = transformSongsToDTO(searchResult.song || []);

    return {
      artists,
      albums,
      songs,
      query: params.query,
      totalResults: artists.length + albums.length + songs.length,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.operationFailed('search', error));
  }
}

/**
 * Search for songs only
 */
export async function searchSongs(config: Config, args: unknown): Promise<{
  songs: SongDTO[];
  query: string;
  total: number;
}> {
  const params = SearchSongsSchema.parse(args);

  try {
    const searchParams = createSubsonicAuth(config);
    searchParams.set('query', params.query);
    searchParams.set('artistCount', '0');
    searchParams.set('albumCount', '0');
    searchParams.set('songCount', params.limit.toString());

    const response = await fetch(`${config.navidromeUrl}/rest/search3?${searchParams.toString()}`);
    
    if (!response.ok) {
      throw new Error(ErrorFormatter.apiRequest('search', response));
    }

    const data = await response.json() as SubsonicSearchResult;
    
    if (data['subsonic-response'].status !== 'ok') {
      throw new Error(ErrorFormatter.apiResponse('search'));
    }

    const searchResult = data['subsonic-response'].searchResult3 || {};
    const songs = transformSongsToDTO(searchResult.song || []);

    return {
      songs,
      query: params.query,
      total: songs.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to search songs: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Search for albums only
 */
export async function searchAlbums(config: Config, args: unknown): Promise<{
  albums: AlbumDTO[];
  query: string;
  total: number;
}> {
  const params = SearchAlbumsSchema.parse(args);

  try {
    const searchParams = createSubsonicAuth(config);
    searchParams.set('query', params.query);
    searchParams.set('artistCount', '0');
    searchParams.set('albumCount', params.limit.toString());
    searchParams.set('songCount', '0');

    const response = await fetch(`${config.navidromeUrl}/rest/search3?${searchParams.toString()}`);
    
    if (!response.ok) {
      throw new Error(ErrorFormatter.apiRequest('search', response));
    }

    const data = await response.json() as SubsonicSearchResult;
    
    if (data['subsonic-response'].status !== 'ok') {
      throw new Error(ErrorFormatter.apiResponse('search'));
    }

    const searchResult = data['subsonic-response'].searchResult3 || {};
    const albums = transformAlbumsToDTO(searchResult.album || []);

    return {
      albums,
      query: params.query,
      total: albums.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to search albums: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Search for artists only
 */
export async function searchArtists(config: Config, args: unknown): Promise<{
  artists: ArtistDTO[];
  query: string;
  total: number;
}> {
  const params = SearchArtistsSchema.parse(args);

  try {
    const searchParams = createSubsonicAuth(config);
    searchParams.set('query', params.query);
    searchParams.set('artistCount', params.limit.toString());
    searchParams.set('albumCount', '0');
    searchParams.set('songCount', '0');

    const response = await fetch(`${config.navidromeUrl}/rest/search3?${searchParams.toString()}`);
    
    if (!response.ok) {
      throw new Error(ErrorFormatter.apiRequest('search', response));
    }

    const data = await response.json() as SubsonicSearchResult;
    
    if (data['subsonic-response'].status !== 'ok') {
      throw new Error(ErrorFormatter.apiResponse('search'));
    }

    const searchResult = data['subsonic-response'].searchResult3 || {};
    const artists = transformArtistsToDTO(searchResult.artist || []);

    return {
      artists,
      query: params.query,
      total: artists.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to search artists: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}