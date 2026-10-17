import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cache } from '../../../src/utils/cache.js';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new Cache<string>(1); // TTL in seconds
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should store and retrieve values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for non-existent keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should delete values', () => {
    cache.set('key1', 'value1');
    expect(cache.delete('key1')).toBe(true);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should clear all values', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });

  it('should expire values after TTL', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    vi.advanceTimersByTime(1100);

    expect(cache.get('key1')).toBeUndefined();
  });
});