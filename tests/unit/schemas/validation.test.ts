/**
 * Navidrome MCP Server - validation schema tests
 * Copyright (C) 2025
 */

import { describe, expect, it } from 'vitest';
import {
  CreatePlaylistSchema,
  SeekSchema,
  SetActiveLibrariesSchema,
  TopTracksByArtistSchema,
  UpdatePlaylistSchema,
} from '../../../src/schemas/validation.js';

describe('SetActiveLibrariesSchema', () => {
  it('accepts a normal positive-integer libraryIds array', () => {
    const result = SetActiveLibrariesSchema.parse({ libraryIds: [1, 2, 3] });
    expect(result.libraryIds).toEqual([1, 2, 3]);
  });

  it('dedupes duplicate IDs silently', () => {
    const result = SetActiveLibrariesSchema.parse({ libraryIds: [1, 1, 2, 2, 3] });
    expect(result.libraryIds).toEqual([1, 2, 3]);
  });

  it('rejects empty libraryIds array', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [] }))
      .toThrow(/At least one library ID/);
  });

  it('rejects non-integer floats', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [1.5] })).toThrow();
  });

  it('rejects negative IDs', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [-1] })).toThrow();
  });

  it('rejects zero (libraries are 1-indexed positive integers)', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [0] })).toThrow();
  });

  it('rejects Infinity and -Infinity', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [Infinity] })).toThrow();
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [-Infinity] })).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [NaN] })).toThrow();
  });

  it('rejects unknown top-level fields under .strict()', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [1], extraneous: 'x' })).toThrow();
  });

  it('rejects null, undefined, and non-object inputs without crashing', () => {
    expect(() => SetActiveLibrariesSchema.parse(null)).toThrow();
    expect(() => SetActiveLibrariesSchema.parse(undefined)).toThrow();
    expect(() => SetActiveLibrariesSchema.parse('string')).toThrow();
    expect(() => SetActiveLibrariesSchema.parse([1, 2, 3])).toThrow();
  });

  it('rejects when libraryIds itself is missing', () => {
    expect(() => SetActiveLibrariesSchema.parse({})).toThrow();
  });

  it('rejects mixed valid/invalid IDs', () => {
    expect(() => SetActiveLibrariesSchema.parse({ libraryIds: [1, 'two' as unknown as number, 3] })).toThrow();
  });
});

describe('TopTracksByArtistSchema limit contract', () => {
  // Regression: the default must sit within the declared max. zod's `.default()`
  // substitutes its value WITHOUT re-running `.max()`, so a default above the max
  // (previously 100 vs a max of 50) silently returns an out-of-contract value on
  // the omitted-limit path while the same explicit value would be rejected.
  it('applies a default of 10 when limit is omitted, within the max', () => {
    const result = TopTracksByArtistSchema.parse({ artist: 'Radiohead' });
    expect(result.limit).toBe(10);
    expect(result.limit).toBeLessThanOrEqual(50);
  });

  it('accepts a limit at the max boundary (50)', () => {
    expect(TopTracksByArtistSchema.parse({ artist: 'Radiohead', limit: 50 }).limit).toBe(50);
  });

  it('rejects a limit above the max (51)', () => {
    expect(() => TopTracksByArtistSchema.parse({ artist: 'Radiohead', limit: 51 })).toThrow();
  });
});

describe('playlist name', () => {
  it('rejects a whitespace-only name on create and update with one message', () => {
    expect(CreatePlaylistSchema.safeParse({ name: '   ' }).error?.issues.map((issue) => issue.message)).toEqual(['Playlist name is required']);
    expect(UpdatePlaylistSchema.safeParse({ playlistId: 'p1', name: '' }).error?.issues.map((issue) => issue.message)).toEqual(['Playlist name is required']);
  });

  it('stores the name without surrounding whitespace', () => {
    expect(CreatePlaylistSchema.parse({ name: '  Road Trip ' }).name).toBe('Road Trip');
  });
});

describe('SeekSchema', () => {
  it('rejects a negative absolute target and accepts a negative relative offset', () => {
    expect(SeekSchema.safeParse({ seconds: -5, mode: 'absolute' }).success).toBe(false);
    expect(SeekSchema.parse({ seconds: -5 })).toEqual({ seconds: -5, mode: 'relative' });
    expect(SeekSchema.parse({ seconds: 0, mode: 'absolute' })).toEqual({ seconds: 0, mode: 'absolute' });
  });
});
