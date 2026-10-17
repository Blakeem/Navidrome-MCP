/**
 * Navidrome MCP Server - playlist track transformer tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Playlist tracks follow the song transformer's rules, so an unknown year (0) is omitted and a
 * malformed row is dropped instead of failing the entire page.
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

  it('omits duration in verbose mode when the row lacks one', () => {
    const [dto] = transformPlaylistTracksToDTO([{ ...rawTrack, duration: undefined }], { verbose: true });
    expect(dto).not.toHaveProperty('duration');
  });

  it('falls back to the playlist position id when mediaFileId is empty', () => {
    expect(transformToPlaylistTrackDTO({ ...rawTrack, mediaFileId: '' }).songId).toBe('3');
  });
});

describe('transformPlaylistTracksToDTO', () => {
  it('drops non-object rows and returns [] for a non-array body', () => {
    expect(transformPlaylistTracksToDTO([rawTrack, null, 'bad'])).toHaveLength(1);
    expect(transformPlaylistTracksToDTO({ error: 'x' })).toEqual([]);
  });
});
