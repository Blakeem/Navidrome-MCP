/**
 * Navidrome MCP Server - Admin login throttle
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { TokenBuckets } from './token-bucket.js';

const FIRST_FAILURE_DELAY_MS = 1000;
const MAX_FAILURE_DELAY_MS = 60 * 60 * 1000;
const BUCKET_CAPACITY = 10;
const BUCKET_WINDOW_MS = 15 * 60 * 1000;
// A second login waits for the one in progress, which ends within one Argon2 hash.
const IN_FLIGHT_RETRY_MS = 1000;

/**
 * The failure delay is shared by every network, so rotating network keys cannot dodge it. A login
 * from this computer neither waits for that delay nor adds to it, so a LAN or internet client cannot
 * lock the host out. The bucket caps each network key, the local one included.
 */
export class LoginThrottle {
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;
  private inFlight = false;
  private inFlightIsLocal = false;
  private readonly buckets: TokenBuckets;

  constructor(private readonly now: () => number = Date.now) {
    this.buckets = new TokenBuckets(BUCKET_CAPACITY, BUCKET_WINDOW_MS, now);
  }

  /** Returns 0 and starts an attempt, or the wait in milliseconds before the next one may start. */
  tryBegin(networkKey: string, isLocal: boolean): number {
    const now = this.now();
    if (this.inFlight) return IN_FLIGHT_RETRY_MS;
    const failureWaitMs = isLocal ? 0 : Math.max(0, this.nextAttemptAt - now);
    const waitMs = Math.max(failureWaitMs, this.buckets.waitMs(networkKey));
    if (waitMs > 0) return waitMs;

    this.buckets.take(networkKey);
    this.inFlight = true;
    this.inFlightIsLocal = isLocal;
    return 0;
  }

  finish(succeeded: boolean): void {
    this.inFlight = false;
    if (succeeded) {
      this.consecutiveFailures = 0;
      this.nextAttemptAt = 0;
      return;
    }
    if (this.inFlightIsLocal) return;
    this.consecutiveFailures += 1;
    const delayMs = Math.min(FIRST_FAILURE_DELAY_MS * 2 ** (this.consecutiveFailures - 1), MAX_FAILURE_DELAY_MS);
    this.nextAttemptAt = this.now() + delayMs;
  }

  prune(): void {
    this.buckets.prune();
  }
}
