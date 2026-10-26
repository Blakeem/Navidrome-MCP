/**
 * Navidrome MCP Server - Per-key token buckets
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Each key holds up to `capacity` tokens, which refill evenly across `windowMs`. */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 when the key holds a token, or the wait in milliseconds until it does. */
  waitMs(key: string): number {
    const bucket = this.refill(key, this.now());
    return bucket.tokens >= 1 ? 0 : Math.ceil(((1 - bucket.tokens) * this.windowMs) / this.capacity);
  }

  /** Call only after `waitMs` returned 0. */
  take(key: string): void {
    const bucket = this.refill(key, this.now());
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
  }

  /** Spends a token when the key holds one. Returns 0 then, or the wait in milliseconds. */
  tryTake(key: string): number {
    const waitMs = this.waitMs(key);
    if (waitMs === 0) this.take(key);
    return waitMs;
  }

  /** A full bucket holds no state worth keeping, so dropping it bounds the map. */
  prune(): void {
    const now = this.now();
    for (const key of [...this.buckets.keys()]) {
      if (this.refill(key, now).tokens >= this.capacity) this.buckets.delete(key);
    }
  }

  private refill(key: string, now: number): Bucket {
    const stored = this.buckets.get(key);
    if (stored === undefined) return { tokens: this.capacity, updatedAt: now };
    const elapsedMs = Math.max(0, now - stored.updatedAt);
    const refilled = { tokens: Math.min(this.capacity, stored.tokens + (elapsedMs * this.capacity) / this.windowMs), updatedAt: now };
    this.buckets.set(key, refilled);
    return refilled;
  }
}
