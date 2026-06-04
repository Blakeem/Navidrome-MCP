/**
 * Navidrome MCP Server - transformer rating filtering tests
 * Copyright (C) 2025
 *
 * Covers the contract that a rating of 0 means "unrated" in Navidrome and must
 * NOT be propagated to the DTO, while a positive rating is preserved. `rating`
 * is a verbose-gated field, so these tests transform with `{ verbose: true }`
 * to exercise the derivation logic (compact mode drops it regardless).
 */

import { describe, expect, it } from 'vitest';
import { transformToSongDTO, type RawSong } from '../../../src/transformers/song-transformer.js';
import { transformToAlbumDTO, type RawAlbum } from '../../../src/transformers/album-transformer.js';
import { transformToArtistDTO, type RawArtist } from '../../../src/transformers/artist-transformer.js';

const baseSong: RawSong = {
  id: 's1',
  title: 'Song',
  artist: 'Artist',
  artistId: 'a1',
  album: 'Album',
  albumId: 'al1',
};

const baseAlbum: RawAlbum = {
  id: 'al1',
  name: 'Album',
  songCount: 1,
};

const baseArtist: RawArtist = {
  id: 'a1',
  name: 'Artist',
  albumCount: 1,
  songCount: 1,
};

const VERBOSE = { verbose: true } as const;

describe('transformToSongDTO rating filtering', () => {
  it('omits rating when 0 (unrated)', () => {
    expect(transformToSongDTO({ ...baseSong, rating: 0 }, VERBOSE).rating).toBeUndefined();
  });

  it('preserves a positive rating', () => {
    expect(transformToSongDTO({ ...baseSong, rating: 3 }, VERBOSE).rating).toBe(3);
  });
});

describe('transformToAlbumDTO rating filtering', () => {
  it('omits rating when 0 (unrated)', () => {
    expect(transformToAlbumDTO({ ...baseAlbum, rating: 0 }, VERBOSE).rating).toBeUndefined();
  });

  it('preserves a positive rating', () => {
    expect(transformToAlbumDTO({ ...baseAlbum, rating: 3 }, VERBOSE).rating).toBe(3);
  });
});

describe('transformToArtistDTO rating filtering', () => {
  it('omits rating when 0 (unrated)', () => {
    expect(transformToArtistDTO({ ...baseArtist, rating: 0 }, VERBOSE).rating).toBeUndefined();
  });

  it('preserves a positive rating', () => {
    expect(transformToArtistDTO({ ...baseArtist, rating: 3 }, VERBOSE).rating).toBe(3);
  });
});
