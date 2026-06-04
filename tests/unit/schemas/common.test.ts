/**
 * Navidrome MCP Server - common schema tests
 * Copyright (C) 2025
 *
 * Verifies B2 ID-pattern enforcement: malicious or path-injecting IDs
 * MUST be rejected at the schema layer, before any URL builder sees them.
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

  it('rejects empty IDs with the original min(1) message', () => {
    expect(() => IdSchema.parse({ id: '' })).toThrow(/required/);
  });
});

describe('createIdSchema', () => {
  it('uses the resource type in error messages', () => {
    const schema = createIdSchema('Playlist');
    expect(() => schema.parse({ id: '../bad' })).toThrow(/Playlist ID contains invalid characters/);
    expect(() => schema.parse({ id: '' })).toThrow(/Playlist ID is required/);
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
  // A non-integer limit/offset becomes `_start`/`_end` in the Navidrome REST
  // URL; Navidrome silently drops a fractional pagination param and returns
  // the ENTIRE unpaginated result set. These must be rejected at validation.
  it('accepts integer limits within range', () => {
    const schema = createLimitSchema(1, 500, 100);
    expect(schema.parse(50)).toBe(50);
    expect(schema.parse(undefined)).toBe(100); // default applied
  });

  it('rejects fractional limits', () => {
    const schema = createLimitSchema(1, 500, 100);
    expect(() => schema.parse(50.5)).toThrow();
  });

  it('rejects fractional limits on the no-default variant', () => {
    const schema = createLimitSchema(1, 500);
    expect(() => schema.parse(50.5)).toThrow();
  });

  it('still enforces min/max bounds', () => {
    const schema = createLimitSchema(1, 500, 100);
    expect(() => schema.parse(0)).toThrow();
    expect(() => schema.parse(501)).toThrow();
  });

  it('accepts integer offsets and rejects fractional ones', () => {
    expect(OffsetSchema.parse(20)).toBe(20);
    expect(OffsetSchema.parse(undefined)).toBe(0); // default applied
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

  it('rejects the obsolete yearFrom/yearTo via passthrough strip (params silently dropped)', () => {
    // EnhancedSearchSchema is not strict, so unknown fields are silently
    // dropped by Zod default. The important guarantee: yearFrom/yearTo do NOT
    // appear in the parsed output, so downstream callers can't accidentally
    // pass them through to Navidrome.
    const result = EnhancedSearchSchema.parse({
      query: 'test',
      yearFrom: 2010,
      yearTo: 2015,
    } as unknown as { query: string });
    expect(result).not.toHaveProperty('yearFrom');
    expect(result).not.toHaveProperty('yearTo');
  });
});
