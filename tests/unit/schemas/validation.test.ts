/**
 * Navidrome MCP Server - validation schema tests
 * Copyright (C) 2025
 */

import { describe, expect, it } from 'vitest';
import { SetActiveLibrariesSchema } from '../../../src/schemas/validation.js';

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
