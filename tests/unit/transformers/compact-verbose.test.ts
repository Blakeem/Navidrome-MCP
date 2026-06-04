/**
 * Navidrome MCP Server - compact/verbose projection tests
 * Copyright (C) 2025
 *
 * Verifies the verbose-opt-in projection added to the song/album/artist
 * transformers: compact (the default) emits only the identity fields to keep
 * large array responses under the tool-result token cap, verbose restores the
 * full set, and `keep` force-emits a single purpose field (e.g. playCount for
 * list_most_played) without pulling in everything else.
 */

import { describe, expect, it } from 'vitest';
import { transformToSongDTO } from '../../../src/transformers/song-transformer.js';
import { transformToAlbumDTO } from '../../../src/transformers/album-transformer.js';
import { transformToArtistDTO } from '../../../src/transformers/artist-transformer.js';
import { shouldEmit, type TransformOptions } from '../../../src/transformers/shared-transformers.js';

const rawSong = {
  id: 's1', title: 'Song', artist: 'Artist', artistId: 'a1',
  album: 'Album', albumId: 'al1', albumArtist: 'AA', albumArtistId: 'aa1',
  genre: 'Rock', genres: [{ id: 'g1', name: 'Rock' }], year: 2001, duration: 200,
  trackNumber: 4, playCount: 7, rating: 5, starred: true, starredAt: '2026-01-01T00:00:00Z',
  playDate: '2026-05-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
  path: '/music/song.flac',
};

const rawAlbum = {
  id: 'al1', name: 'Album', artist: 'Artist', artistId: 'a1',
  albumArtist: 'AA', albumArtistId: 'aa1', maxYear: 2001, genre: 'Rock',
  genres: [{ id: 'g1', name: 'Rock' }], songCount: 10, duration: 2000,
  compilation: false, playCount: 7, rating: 5, starred: true, starredAt: '2026-01-01T00:00:00Z',
};

const rawArtist = {
  id: 'a1', name: 'Artist', albumCount: 3, songCount: 30,
  genres: ['Rock'], biography: 'Bio', playCount: 7, rating: 5,
  starred: true, starredAt: '2026-01-01T00:00:00Z',
};

const SONG_IDENTITY = ['id', 'title', 'artist', 'artistId', 'album', 'albumId', 'durationFormatted'];
const SONG_SECONDARY = ['albumArtist', 'albumArtistId', 'genre', 'genres', 'year', 'addedDate', 'path', 'trackNumber', 'playCount', 'rating', 'starred', 'starredAt', 'playDate'];

describe('shouldEmit', () => {
  it('emits nothing extra in compact (default) mode', () => {
    expect(shouldEmit('playCount', undefined)).toBe(false);
    expect(shouldEmit('playCount', {})).toBe(false);
  });

  it('emits everything in verbose mode', () => {
    const opts: TransformOptions = { verbose: true };
    expect(shouldEmit('path', opts)).toBe(true);
    expect(shouldEmit('anything', opts)).toBe(true);
  });

  it('emits only the named fields via keep', () => {
    const opts: TransformOptions = { keep: ['playCount'] };
    expect(shouldEmit('playCount', opts)).toBe(true);
    expect(shouldEmit('path', opts)).toBe(false);
  });
});

describe('transformToSongDTO projection', () => {
  it('compact (default) emits only identity fields', () => {
    const dto = transformToSongDTO(rawSong);
    for (const f of SONG_IDENTITY) expect(dto).toHaveProperty(f);
    for (const f of SONG_SECONDARY) expect(dto).not.toHaveProperty(f);
  });

  it('verbose emits the full set', () => {
    const dto = transformToSongDTO(rawSong, { verbose: true });
    for (const f of [...SONG_IDENTITY, ...SONG_SECONDARY]) expect(dto).toHaveProperty(f);
    expect(dto.path).toBe('/music/song.flac');
  });

  it('keep force-emits one field while still dropping the rest', () => {
    const dto = transformToSongDTO(rawSong, { keep: ['playCount'] });
    expect(dto).toHaveProperty('playCount', 7);
    expect(dto).not.toHaveProperty('path');
    expect(dto).not.toHaveProperty('year');
  });
});

describe('transformToAlbumDTO projection', () => {
  it('compact emits identity, drops secondary', () => {
    const dto = transformToAlbumDTO(rawAlbum);
    for (const f of ['id', 'name', 'artist', 'artistId', 'songCount', 'durationFormatted']) {
      expect(dto).toHaveProperty(f);
    }
    for (const f of ['albumArtist', 'releaseYear', 'genre', 'genres', 'compilation', 'playCount', 'rating', 'starred']) {
      expect(dto).not.toHaveProperty(f);
    }
  });

  it('verbose emits secondary fields', () => {
    const dto = transformToAlbumDTO(rawAlbum, { verbose: true });
    expect(dto).toHaveProperty('releaseYear', 2001);
    expect(dto).toHaveProperty('genre', 'Rock');
    expect(dto).toHaveProperty('starred', true);
  });
});

describe('transformToArtistDTO projection', () => {
  it('compact emits identity, drops secondary (including playCount)', () => {
    const dto = transformToArtistDTO(rawArtist);
    for (const f of ['id', 'name', 'albumCount', 'songCount']) {
      expect(dto).toHaveProperty(f);
    }
    for (const f of ['playCount', 'genres', 'biography', 'rating', 'starred']) {
      expect(dto).not.toHaveProperty(f);
    }
  });

  it('keep playCount restores the explicit-zero-safe play count only', () => {
    const dto = transformToArtistDTO({ ...rawArtist, playCount: undefined }, { keep: ['playCount'] });
    expect(dto).toHaveProperty('playCount', 0);
    expect(dto).not.toHaveProperty('biography');
  });
});
