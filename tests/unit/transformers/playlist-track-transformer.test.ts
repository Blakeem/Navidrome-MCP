/**
 * Navidrome MCP Server - playlist track transformer tests
 * Copyright (C) 2025
 *
 * Pins the playlist track projection to the song transformer's rules: an
 * unknown year (0) is omitted, the genre comes from the `genres` array, and
 * malformed batch rows are dropped instead of failing the whole page.
 */

import { describe, expect, it } from 'vitest';
import {
  transformPlaylistTracksToDTO,
  transformToPlaylistTrackDTO,
} from '../../../src/transformers/index.js';

const rawTrack = {
  id: '3',
  mediaFileId: 'song-1',
  playlistId: 'pl-1',
  title: 'Song',
  album: 'Album',
  artist: 'Artist',
  albumArtist: 'Album Artist',
  duration: 245,
  bitRate: 320,
  path: 'Artist/Album/03.flac',
  trackNumber: 3,
  year: 0,
  genres: [{ name: 'Rock' }, { name: 'Pop' }],
};

describe('transformToPlaylistTrackDTO', () => {
  it('emits only identity fields in compact mode', () => {
    expect(transformToPlaylistTrackDTO(rawTrack)).toEqual({
      position: '3',
      songId: 'song-1',
      title: 'Song',
      album: 'Album',
      artist: 'Artist',
      durationFormatted: '4:05',
    });
  });

  it('omits an unknown year and takes the genre from the genres array in verbose mode', () => {
    const dto = transformToPlaylistTrackDTO(rawTrack, { verbose: true });
    expect(dto).not.toHaveProperty('year');
    expect(dto.genre).toBe('Rock');
    expect(dto).toMatchObject({ playlistId: 'pl-1', duration: 245, bitRate: 320, trackNumber: 3 });
  });

  it('emits a known year in verbose mode', () => {
    expect(transformToPlaylistTrackDTO({ ...rawTrack, year: 1999 }, { verbose: true }).year).toBe(1999);
  });
});

describe('transformPlaylistTracksToDTO', () => {
  it('drops non-object rows and returns [] for a non-array body', () => {
    expect(transformPlaylistTracksToDTO([rawTrack, null, 'bad'])).toHaveLength(1);
    expect(transformPlaylistTracksToDTO({ error: 'x' })).toEqual([]);
  });
});
