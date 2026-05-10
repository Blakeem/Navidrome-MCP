/**
 * Navidrome MCP Server - transformer starredAt propagation tests
 * Copyright (C) 2025
 *
 * Verifies that the starredAt field travels from the raw Navidrome API
 * response through the DTO transformers — previously stripped, causing
 * list_starred_items sorted by starredAt to return timestamp-less items.
 */

import { describe, expect, it } from 'vitest';
import { transformToSongDTO, type RawSong } from '../../../src/transformers/song-transformer.js';
import { transformToAlbumDTO, type RawAlbum } from '../../../src/transformers/album-transformer.js';
import { transformToArtistDTO, type RawArtist } from '../../../src/transformers/artist-transformer.js';

const ISO_TIMESTAMP = '2026-05-08T20:45:00.404Z';

describe('transformToSongDTO — starredAt', () => {
  it('propagates starredAt when the raw song includes it', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToSongDTO(raw);
    expect(dto.starredAt).toBe(ISO_TIMESTAMP);
  });

  it('omits starredAt when the raw song does not include it', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
    };
    const dto = transformToSongDTO(raw);
    expect(dto.starredAt).toBeUndefined();
  });
});

describe('transformToAlbumDTO — starredAt', () => {
  it('propagates starredAt when the raw album includes it', () => {
    const raw: RawAlbum = {
      id: 'album-1',
      name: 'Test Album',
      artist: 'A',
      artistId: 'a-1',
      songCount: 10,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToAlbumDTO(raw);
    expect(dto.starredAt).toBe(ISO_TIMESTAMP);
  });

  it('omits starredAt when the raw album does not include it', () => {
    const raw: RawAlbum = {
      id: 'album-1',
      name: 'Test Album',
      artist: 'A',
      artistId: 'a-1',
      songCount: 10,
    };
    const dto = transformToAlbumDTO(raw);
    expect(dto.starredAt).toBeUndefined();
  });
});

describe('transformToArtistDTO — starredAt', () => {
  it('propagates starredAt when the raw artist includes it', () => {
    const raw: RawArtist = {
      id: 'artist-1',
      name: 'Test Artist',
      albumCount: 5,
      songCount: 50,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToArtistDTO(raw);
    expect(dto.starredAt).toBe(ISO_TIMESTAMP);
  });

  it('omits starredAt when the raw artist does not include it', () => {
    const raw: RawArtist = {
      id: 'artist-1',
      name: 'Test Artist',
      albumCount: 5,
      songCount: 50,
    };
    const dto = transformToArtistDTO(raw);
    expect(dto.starredAt).toBeUndefined();
  });
});
