/**
 * Navidrome MCP Server - song transformer lyrics-flag tests
 * Copyright (C) 2025
 *
 * Verifies the `lyrics` availability flag derived from a Navidrome song row's
 * own `lyrics` tag. The flag lives in the always-emitted identity block, so
 * absence means "no local lyrics" rather than "not in this projection", and the
 * raw lyric text must never reach the DTO.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Config } from '../../../src/config.js';
import { loadConfig } from '../../../src/config.js';
import { shouldSkipLiveTests, getSkipReason, describeLive } from '../../helpers/env-detection.js';
import { getSharedLiveClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import {
  transformToSongDTO,
  transformSongsToDTO,
  type RawSong,
} from '../../../src/transformers/song-transformer.js';
import { searchSongs } from '../../../src/tools/search.js';

const SYNCED_TEXT = 'timed line that is definitely long enough here';
const PLAIN_TEXT = 'plain line that is definitely long enough here';

const SYNCED_TAG = JSON.stringify([
  {
    lang: 'eng',
    synced: true,
    line: [
      { start: 0, value: SYNCED_TEXT },
      { start: 4000, value: 'second timed line' },
    ],
  },
]);

const PLAIN_TAG = JSON.stringify([
  { lang: 'eng', synced: false, line: [{ value: PLAIN_TEXT }, { value: 'second plain line' }] },
]);

function rawSong(lyrics?: unknown): RawSong {
  return {
    id: 'song-1',
    title: 'Test',
    artist: 'A',
    artistId: 'a-1',
    album: 'B',
    albumId: 'b-1',
    duration: 240,
    ...(lyrics === undefined ? {} : { lyrics }),
  } as RawSong;
}

describe('transformToSongDTO - local lyrics flag', () => {
  it('reports synced for a timed local entry', () => {
    expect(transformToSongDTO(rawSong(SYNCED_TAG)).lyrics).toBe('synced');
  });

  it('reports plain for an untimed local entry', () => {
    expect(transformToSongDTO(rawSong(PLAIN_TAG)).lyrics).toBe('plain');
  });

  it('omits the flag for an empty lyrics array', () => {
    expect(transformToSongDTO(rawSong('[]')).lyrics).toBeUndefined();
  });

  it('omits the flag for malformed JSON without throwing', () => {
    expect(() => transformToSongDTO(rawSong('{not json at all'))).not.toThrow();
    expect(transformToSongDTO(rawSong('{not json at all')).lyrics).toBeUndefined();
  });

  it('omits the flag when the tag is null or absent', () => {
    expect(transformToSongDTO(rawSong(null)).lyrics).toBeUndefined();
    expect(transformToSongDTO(rawSong()).lyrics).toBeUndefined();
  });

  it('omits the flag for a single-line under-40-character tagger watermark', () => {
    const watermark = JSON.stringify([
      { lang: 'eng', synced: false, line: [{ value: 'Lyrics by SomeTagger' }] },
    ]);

    expect(transformToSongDTO(rawSong(watermark)).lyrics).toBeUndefined();
  });

  it('emits the flag in compact mode with no options passed', () => {
    const dto = transformToSongDTO(rawSong(SYNCED_TAG));

    expect(dto).toHaveProperty('lyrics');
    expect(dto.year).toBeUndefined();
  });

  it('keeps the raw lyric text out of the DTO in compact and verbose mode', () => {
    const compact = JSON.stringify(transformToSongDTO(rawSong(SYNCED_TAG)));
    const verbose = JSON.stringify(transformToSongDTO(rawSong(SYNCED_TAG), { verbose: true }));

    expect(compact).not.toContain(SYNCED_TEXT);
    expect(verbose).not.toContain(SYNCED_TEXT);
    expect(verbose).toContain('"lyrics":"synced"');
  });
});

describe('transformSongsToDTO - local lyrics flag', () => {
  it('keeps every good row when one row in a large listing carries a malformed tag', () => {
    const rows: RawSong[] = Array.from({ length: 100 }, (_unused, index) =>
      index === 50 ? rawSong('{not json at all') : rawSong(PLAIN_TAG),
    );

    const dtos = transformSongsToDTO(rows);

    expect(dtos).toHaveLength(100);
    expect(dtos[50]?.lyrics).toBeUndefined();
    expect(dtos.filter((dto) => dto.lyrics === 'plain')).toHaveLength(99);
  });
});

describe('Song lyrics flag - live listing', () => {
  let config: Config;
  let liveClient: NavidromeClient;

  beforeAll(async () => {
    if (shouldSkipLiveTests()) {
      console.warn(`Skipping live tests: ${getSkipReason()}`);
      return;
    }
    config = await loadConfig();
    liveClient = await getSharedLiveClient();
  });

  describeLive('Live song listing - structure only', () => {
    it('returns either no lyrics flag or one of the two literals on every row', async () => {
      const result = await searchSongs(liveClient, config, { limit: 5 });

      expect(Array.isArray(result.songs)).toBe(true);
      for (const song of result.songs) {
        if (song.lyrics !== undefined) {
          expect(['synced', 'plain']).toContain(song.lyrics);
        }
      }
    });
  });
});
