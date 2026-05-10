/**
 * Navidrome MCP Server - common schema tests
 * Copyright (C) 2025
 *
 * Verifies B2 ID-pattern enforcement: malicious or path-injecting IDs
 * MUST be rejected at the schema layer, before any URL builder sees them.
 */

import { describe, expect, it } from 'vitest';
import { IdSchema, createIdSchema } from '../../../src/schemas/common.js';

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
