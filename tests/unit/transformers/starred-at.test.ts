/**
 * Navidrome MCP Server - transformer starredAt propagation tests
 * Copyright (C) 2025
 *
 * Verifies that the `starred` boolean is authoritative and that
 * `starredAt` is only echoed when `starred === true`. Navidrome retains
 * a leftover `starredAt` after unstarring, so a populated timestamp
 * alone must NOT mark the item as starred in our DTOs.
 */

import { describe, expect, it } from 'vitest';
import { transformToSongDTO, type RawSong } from '../../../src/transformers/song-transformer.js';
import { transformToAlbumDTO, type RawAlbum } from '../../../src/transformers/album-transformer.js';
import { transformToArtistDTO, type RawArtist } from '../../../src/transformers/artist-transformer.js';

const ISO_TIMESTAMP = '2026-05-08T20:45:00.404Z';

describe('transformToSongDTO — starred state', () => {
  it('propagates starred=true and starredAt when both are set', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
      starred: true,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToSongDTO(raw);
    expect(dto.starred).toBe(true);
    expect(dto.starredAt).toBe(ISO_TIMESTAMP);
  });

  it('omits starredAt and marks starred=false when starred is null with leftover timestamp', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
      starred: null,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToSongDTO(raw);
    expect(dto.starred).toBeUndefined();
    expect(dto.starredAt).toBeUndefined();
  });

  it('emits starred=false when the API explicitly returns false', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
      starred: false,
    };
    const dto = transformToSongDTO(raw);
    expect(dto.starred).toBe(false);
    expect(dto.starredAt).toBeUndefined();
  });

  it('omits both fields when the raw song has neither', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
    };
    const dto = transformToSongDTO(raw);
    expect(dto.starred).toBeUndefined();
    expect(dto.starredAt).toBeUndefined();
  });
});

describe('transformToSongDTO — addedDate', () => {
  it('echoes createdAt as addedDate when present', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
      createdAt: ISO_TIMESTAMP,
    };
    const dto = transformToSongDTO(raw);
    expect(dto.addedDate).toBe(ISO_TIMESTAMP);
  });

  it('omits addedDate (never fabricates "now") when createdAt is absent', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
    };
    const dto = transformToSongDTO(raw);
    expect(dto.addedDate).toBeUndefined();
  });

  it('omits addedDate when createdAt is an empty string', () => {
    const raw: RawSong = {
      id: 'song-1',
      title: 'Test',
      artist: 'A',
      artistId: 'a-1',
      album: 'B',
      albumId: 'b-1',
      createdAt: '',
    };
    const dto = transformToSongDTO(raw);
    expect(dto.addedDate).toBeUndefined();
  });
});

describe('transformToAlbumDTO — starred state', () => {
  it('propagates starred=true and starredAt when both are set', () => {
    const raw: RawAlbum = {
      id: 'album-1',
      name: 'Test Album',
      artist: 'A',
      artistId: 'a-1',
      songCount: 10,
      starred: true,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToAlbumDTO(raw);
    expect(dto.starred).toBe(true);
    expect(dto.starredAt).toBe(ISO_TIMESTAMP);
  });

  it('omits starredAt and starred when starred is null with leftover timestamp', () => {
    const raw: RawAlbum = {
      id: 'album-1',
      name: 'Test Album',
      artist: 'A',
      artistId: 'a-1',
      songCount: 10,
      starred: null,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToAlbumDTO(raw);
    expect(dto.starred).toBeUndefined();
    expect(dto.starredAt).toBeUndefined();
  });

  it('omits both fields when neither is set', () => {
    const raw: RawAlbum = {
      id: 'album-1',
      name: 'Test Album',
      artist: 'A',
      artistId: 'a-1',
      songCount: 10,
    };
    const dto = transformToAlbumDTO(raw);
    expect(dto.starred).toBeUndefined();
    expect(dto.starredAt).toBeUndefined();
  });
});

describe('transformToArtistDTO — starred state', () => {
  it('propagates starred=true and starredAt when both are set', () => {
    const raw: RawArtist = {
      id: 'artist-1',
      name: 'Test Artist',
      albumCount: 5,
      songCount: 50,
      starred: true,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToArtistDTO(raw);
    expect(dto.starred).toBe(true);
    expect(dto.starredAt).toBe(ISO_TIMESTAMP);
  });

  it('omits starredAt and starred when starred is null with leftover timestamp', () => {
    const raw: RawArtist = {
      id: 'artist-1',
      name: 'Test Artist',
      albumCount: 5,
      songCount: 50,
      starred: null,
      starredAt: ISO_TIMESTAMP,
    };
    const dto = transformToArtistDTO(raw);
    expect(dto.starred).toBeUndefined();
    expect(dto.starredAt).toBeUndefined();
  });

  it('omits both fields when neither is set', () => {
    const raw: RawArtist = {
      id: 'artist-1',
      name: 'Test Artist',
      albumCount: 5,
      songCount: 50,
    };
    const dto = transformToArtistDTO(raw);
    expect(dto.starred).toBeUndefined();
    expect(dto.starredAt).toBeUndefined();
  });
});
