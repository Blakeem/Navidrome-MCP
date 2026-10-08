/**
 * Navidrome MCP Server - Cache Utility
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
    // Run cleanup every ttl period or at least once per hour
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
