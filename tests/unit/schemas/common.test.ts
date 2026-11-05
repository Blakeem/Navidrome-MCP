/**
 * Navidrome MCP Server - common schema tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A path-injecting ID must fail at the schema layer, before any URL builder interpolates it.
 */

import { describe, expect, it } from 'vitest';
import {
  EnhancedSearchSchema,
  IdSchema,
  ItemListTypeSchema,
  ItemTypeSchema,
  OffsetSchema,
  createIdSchema,
  createLimitSchema,
} from '../../../src/schemas/common.js';

describe('IdSchema', () => {
  it('accepts UUID-shaped IDs (alphanumeric, hyphen, underscore)', () => {
    expect(() => IdSchema.parse({ id: 'abc-123_DEF' })).not.toThrow();
    expect(() => IdSchema.parse({ id: 'aBcDeF0123456789' })).not.toThrow();
  });

  it('rejects IDs containing path-traversal segments', () => {
    expect(() => IdSchema.parse({ id: '../etc/passwd' })).toThrow(/invalid characters/);
    expect(() => IdSchema.parse({ id: 'abc/../def' })).toThrow(/invalid characters/);
  });

  it('rejects IDs containing query-string injection characters', () => {
    expect(() => IdSchema.parse({ id: 'abc?evil=1' })).toThrow(/invalid characters/);
    expect(() => IdSchema.parse({ id: 'abc&library_id=2' })).toThrow(/invalid characters/);
    expect(() => IdSchema.parse({ id: 'abc=def' })).toThrow(/invalid characters/);
  });

  it('rejects IDs with whitespace or path separators', () => {
    expect(() => IdSchema.parse({ id: 'has space' })).toThrow(/invalid characters/);
    expect(() => IdSchema.parse({ id: 'has/slash' })).toThrow(/invalid characters/);
  });

  it('rejects empty IDs with the required message', () => {
    expect(() => IdSchema.parse({ id: '' })).toThrow(/required/);
  });
});

describe('createIdSchema', () => {
  it('uses the resource type in error messages', () => {
    const schema = createIdSchema('Playlist', 'id');
    expect(() => schema.parse({ id: '../bad' })).toThrow(/Playlist ID contains invalid characters/);
    expect(() => schema.parse({ id: '' })).toThrow(/Playlist ID is required/);
  });

  it('reports an empty ID once, not also as invalid characters', () => {
    const result = createIdSchema('Artist', 'artistId').safeParse({ artistId: '' });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['Artist ID is required']);
  });
});

describe('ItemTypeSchema (singular normalization)', () => {
  it('passes singular forms through unchanged', () => {
    expect(ItemTypeSchema.parse('song')).toBe('song');
    expect(ItemTypeSchema.parse('album')).toBe('album');
    expect(ItemTypeSchema.parse('artist')).toBe('artist');
  });

  it('normalizes plural forms to singular', () => {
    expect(ItemTypeSchema.parse('songs')).toBe('song');
    expect(ItemTypeSchema.parse('albums')).toBe('album');
    expect(ItemTypeSchema.parse('artists')).toBe('artist');
  });

  it('rejects unknown values', () => {
    expect(() => ItemTypeSchema.parse('playlist')).toThrow();
    expect(() => ItemTypeSchema.parse('SONG')).toThrow();
    expect(() => ItemTypeSchema.parse('')).toThrow();
  });
});

describe('ItemListTypeSchema (plural normalization)', () => {
  it('passes plural forms through unchanged', () => {
    expect(ItemListTypeSchema.parse('songs')).toBe('songs');
    expect(ItemListTypeSchema.parse('albums')).toBe('albums');
    expect(ItemListTypeSchema.parse('artists')).toBe('artists');
  });

  it('normalizes singular forms to plural', () => {
    expect(ItemListTypeSchema.parse('song')).toBe('songs');
    expect(ItemListTypeSchema.parse('album')).toBe('albums');
    expect(ItemListTypeSchema.parse('artist')).toBe('artists');
  });

  it('rejects unknown values', () => {
    expect(() => ItemListTypeSchema.parse('playlist')).toThrow();
    expect(() => ItemListTypeSchema.parse('genres')).toThrow();
  });
});

describe('createLimitSchema / OffsetSchema integer enforcement', () => {
  // Navidrome ignores a fractional `_end` and returns the entire result set. It also ignores a
  // fractional `_start` and serves the first page.
  it('accepts integer limits within range', () => {
    const schema = createLimitSchema(1, 500, 100);
    expect(schema.parse(50)).toBe(50);
    expect(schema.parse(undefined)).toBe(100);
  });

  it('rejects fractional limits', () => {
    const schema = createLimitSchema(1, 500, 100);
    expect(() => schema.parse(50.5)).toThrow();
  });

  it('still enforces min/max bounds', () => {
    const schema = createLimitSchema(1, 500, 100);
    expect(() => schema.parse(0)).toThrow();
    expect(() => schema.parse(501)).toThrow();
  });

  it('accepts integer offsets and rejects fractional ones', () => {
    expect(OffsetSchema.parse(20)).toBe(20);
    expect(OffsetSchema.parse(undefined)).toBe(0);
    expect(() => OffsetSchema.parse(20.5)).toThrow();
    expect(() => OffsetSchema.parse(-1)).toThrow();
  });
});

describe('EnhancedSearchSchema year filter', () => {
  it('accepts a single integer year', () => {
    const result = EnhancedSearchSchema.parse({ query: 'test', year: 2012 });
    expect(result.year).toBe(2012);
  });

  it('accepts no year at all', () => {
    const result = EnhancedSearchSchema.parse({ query: 'test' });
    expect(result.year).toBeUndefined();
  });

  it('rejects fractional years', () => {
    expect(() => EnhancedSearchSchema.parse({ query: 't', year: 2012.5 })).toThrow();
  });

  it('rejects pre-1900 years', () => {
    expect(() => EnhancedSearchSchema.parse({ query: 't', year: 1899 })).toThrow();
  });

  it('rejects years more than one year in the future', () => {
    const farFuture = new Date().getFullYear() + 5;
    expect(() => EnhancedSearchSchema.parse({ query: 't', year: farFuture }))
      .toThrow(/more than one year in the future/);
  });

  it('strips unknown yearFrom/yearTo keys', () => {
    // A non-strict Zod object strips unknown keys, so yearFrom and yearTo never reach Navidrome.
    const result = EnhancedSearchSchema.parse({
      query: 'test',
      yearFrom: 2010,
      yearTo: 2015,
    } as unknown as { query: string });
    expect(result).not.toHaveProperty('yearFrom');
    expect(result).not.toHaveProperty('yearTo');
  });
});
