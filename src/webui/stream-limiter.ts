/**
 * Navidrome MCP Server - Web UI stream limiter
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import { MAX_GUESTS_PER_CODE } from './auth/auth-service.js';
import { endSseStream } from './http-helpers.js';
import { sourceAddress } from './source-address.js';

export type StreamRoute = '/api/events' | '/api/guest/events' | '/api/visualizer';
export type StreamPool = 'guest' | 'host';

// A browser tab holds one stream per route, so a session may keep a few tabs before the oldest closes.
export const STREAMS_PER_SESSION_ROUTE = 3;
// Only mode `none` has no sessions, and it refuses `/api/guest/events`. The peer address therefore
// bounds the streams across `/api/events` and `/api/visualizer`.
export const STREAMS_PER_ADDRESS = 6;
// A guest flood must never refuse the host's streams, so guests draw from their own pool.
export const MAX_HOST_STREAMS = 200;
// A guest page holds one guest-events and one visualizer stream. The guest pool fits one page per guest,
// and a guest's extra tabs draw on the same pool, so many tabs can leave later guests refused.
export const STREAMS_PER_GUEST_PAGE = 2;
export const MAX_GUEST_STREAMS = MAX_GUESTS_PER_CODE * STREAMS_PER_GUEST_PAGE;
// A refused stream is answered with an empty 200 stream carrying this retry interval, since an
// EventSource gives up for good on a non-200 answer.
export const REFUSED_STREAM_RETRY_MS = 10_000;
// The events client stays closed until the page reloads. The visualizer client reopens when its tab shows again.
export const STREAM_EVICTED_EVENT = 'evicted';

interface OpenStream {
  route: StreamRoute;
  pool: StreamPool;
  sessionId: string | null;
  address: string;
}

/**
 * Caps the open SSE streams, since each one holds a socket and a write buffer for as long as the peer
 * stays. A stream over a per-session or per-address cap closes the oldest stream in its scope. A
 * stream over the cap of its pool, guest or host, is refused, so a flood never evicts a quiet client.
 * An evicted stream receives the evicted event before it closes.
 */
export class StreamLimiter {
  // Map order is open order, so the first match in a scope is its oldest stream.
  private readonly open = new Map<ServerResponse, OpenStream>();

  /** Returns false when the cap of the stream's pool refuses it, and leaves `res` untouched. */
  admit(
    res: ServerResponse,
    route: StreamRoute,
    pool: StreamPool,
    sessionId: string | null,
    remoteAddress: string | undefined,
  ): boolean {
    const stream: OpenStream = { route, pool, sessionId, address: sourceAddress(remoteAddress) };
    const cap = sessionId === null ? STREAMS_PER_ADDRESS : STREAMS_PER_SESSION_ROUTE;
    const sameScope = [...this.open].filter(([, other]) => isSameScope(other, stream));
    const evicted = sameScope.slice(0, Math.max(0, sameScope.length - cap + 1));
    // A scope is one session or one session-less address, so its evicted streams share the new stream's pool.
    const poolOpen = [...this.open.values()].filter((other) => other.pool === pool).length;

    if (poolOpen - evicted.length >= POOL_CAPS[pool]) return false;

    for (const [old] of evicted) {
      // 'close' fires after the frames flush, so the entry leaves now to keep the scope counts right.
      this.open.delete(old);
      endSseStream(old, STREAM_EVICTED_EVENT, {});
    }
    this.open.set(res, stream);
    res.once('close', () => { this.open.delete(res); });
    return true;
  }
}

const POOL_CAPS: Readonly<Record<StreamPool, number>> = { guest: MAX_GUEST_STREAMS, host: MAX_HOST_STREAMS };

function isSameScope(other: OpenStream, stream: OpenStream): boolean {
  if (stream.sessionId === null) return other.sessionId === null && other.address === stream.address;
  return other.sessionId === stream.sessionId && other.route === stream.route;
}
