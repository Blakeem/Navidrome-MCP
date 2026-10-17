/**
 * Navidrome MCP Server - Cache Utility
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

interface CacheEntry<T> {
  value: T;
  expiry: Date;
}

export class Cache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly ttl: number;
  private cleanupInterval: NodeJS.Timeout | undefined = undefined;
  private readonly cleanupIntervalMs: number;

  constructor(ttlSeconds = 300, enableAutoCleanup = true) {
    this.ttl = ttlSeconds * 1000;
    this.cleanupIntervalMs = Math.min(this.ttl, 3600000); 
    
    if (enableAutoCleanup) {
      this.startAutoCleanup();
    }
  }

  private startAutoCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    // The cleanup timer must not keep the MCP process alive.
    this.cleanupInterval.unref();
  }

  private cleanup(): void {
    const now = new Date();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiry < now) {
        this.store.delete(key);
      }
    }
  }

  set(key: string, value: T): void {
    this.store.set(key, {
      value,
      expiry: new Date(Date.now() + this.ttl),
    });
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiry < new Date()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  clear(): void {
    this.store.clear();
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.store.clear();
  }
}
