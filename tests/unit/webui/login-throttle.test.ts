import { describe, expect, it } from 'vitest';
import { LoginThrottle } from '../../../src/webui/auth/login-throttle.js';

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

describe('LoginThrottle', () => {
  it('admits a first attempt and holds every other attempt until it finishes', () => {
    const time = clock();
    const throttle = new LoginThrottle(time.now);

    expect(throttle.tryBegin('192.168.1.5', false)).toBe(0);
    expect(throttle.tryBegin('192.168.1.6', false)).toBe(1000);
    throttle.finish(true);
    expect(throttle.tryBegin('192.168.1.6', false)).toBe(0);
  });

  it('doubles the wait after each consecutive failure, from 1 s up to 1 h', () => {
    const time = clock();
    const throttle = new LoginThrottle(time.now);
    const waits: number[] = [];

    for (let failure = 0; failure < 14; failure += 1) {
      time.advance(60 * 60 * 1000);
      expect(throttle.tryBegin(`10.0.0.${String(failure)}`, false)).toBe(0);
      throttle.finish(false);
      waits.push(throttle.tryBegin('10.0.1.1', false));
    }

    expect(waits.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(waits.at(-1)).toBe(60 * 60 * 1000);
  });

  it('resets the failure wait on a success', () => {
    const time = clock();
    const throttle = new LoginThrottle(time.now);
    throttle.tryBegin('a', false);
    throttle.finish(false);
    time.advance(1000);
    throttle.tryBegin('a', false);
    throttle.finish(true);

    expect(throttle.tryBegin('a', false)).toBe(0);
  });

  it('lets a local login skip the shared failure wait without adding to it', () => {
    const time = clock();
    const throttle = new LoginThrottle(time.now);
    throttle.tryBegin('192.168.1.5', false);
    throttle.finish(false);

    expect(throttle.tryBegin('192.168.1.6', false)).toBe(1000);
    expect(throttle.tryBegin('127.0.0.1', true)).toBe(0);
    throttle.finish(false);
    time.advance(1000);
    expect(throttle.tryBegin('192.168.1.6', false)).toBe(0);
  });

  it('allows 10 attempts per network key in 15 minutes and refills over time', () => {
    const time = clock();
    const throttle = new LoginThrottle(time.now);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(throttle.tryBegin('203.0.113.9', false)).toBe(0);
      throttle.finish(true);
    }

    expect(throttle.tryBegin('203.0.113.9', false)).toBe(90_000);
    expect(throttle.tryBegin('203.0.113.10', false)).toBe(0);
    throttle.finish(true);
    time.advance(90_000);
    expect(throttle.tryBegin('203.0.113.9', false)).toBe(0);
  });

  it('prunes a bucket once it refills', () => {
    const time = clock();
    const throttle = new LoginThrottle(time.now);
    throttle.tryBegin('a', false);
    throttle.finish(true);
    const buckets = (throttle as unknown as { buckets: { buckets: Map<string, unknown> } }).buckets.buckets;

    throttle.prune();
    expect(buckets.size).toBe(1);
    time.advance(15 * 60 * 1000);
    throttle.prune();
    expect(buckets.size).toBe(0);
  });
});
